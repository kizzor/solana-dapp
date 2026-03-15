/**
 * draw-cron.ts  —  Ransome backend number draw authority
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs on your server/Vercel Edge every 60 seconds.
 * Signs draw_number transactions with the AUTHORITY keypair.
 * Players CANNOT draw numbers — only this backend can.
 *
 * Deploy options:
 *   A) Vercel Cron  — add to vercel.json: { "crons": [{ "path": "/api/draw", "schedule": "* * * * *" }] }
 *   B) GitHub Actions scheduled workflow (every minute)
 *   C) Your own VPS with node-cron
 *
 * Setup:
 *   1. Set AUTHORITY_KEYPAIR env var = JSON array of your authority secret key bytes
 *   2. Set RPC_URL env var = your RPC endpoint (Helius/QuickNode recommended)
 *   3. Set SESSION_AUTHORITY env var = public key of session authority
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// ─── Environment ──────────────────────────────────────────────────────────────
const RPC_URL        = process.env.RPC_URL        || "https://api.devnet.solana.com";
const AUTHORITY_KEY  = process.env.AUTHORITY_KEYPAIR; // JSON array of secret key bytes
const SESSION_AUTH   = process.env.SESSION_AUTHORITY;
const PROGRAM_ID_STR = "5ZFVc4h5Z6ccuxCRNM1Ubr1LC5cv6bvPugYFMJMgRU31";
const SESSION_MAX    = 58 * 60; // seconds

if (!AUTHORITY_KEY) throw new Error("AUTHORITY_KEYPAIR env not set");
if (!SESSION_AUTH)  throw new Error("SESSION_AUTHORITY env not set");

const authority     = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(AUTHORITY_KEY)));
const programId     = new PublicKey(PROGRAM_ID_STR);
const sessionAuth   = new PublicKey(SESSION_AUTH);
const connection    = new Connection(RPC_URL, "confirmed");

// ─── PDAs ────────────────────────────────────────────────────────────────────
function getSessionPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("session"), sessionAuth.toBuffer()],
    programId
  )[0];
}

// ─── Read session state ───────────────────────────────────────────────────────
async function readSession(sessionKey: PublicKey) {
  const info = await connection.getAccountInfo(sessionKey);
  if (!info) return null;
  const data = info.data.slice(8); // skip discriminator
  let offset = 32 + 32 + 1 + 1; // authority, treasury, vault_bump, bump

  const readU64 = () => {
    let v = 0n;
    for (let i = 0; i < 8; i++) v += BigInt(data[offset + i]) << BigInt(i * 8);
    offset += 8;
    return v;
  };
  const readBool = () => { const v = data[offset] !== 0; offset++; return v; };
  const readU8 = () => data[offset++];
  const readI64 = () => { const v = readU64(); return v > 2n**63n ? Number(v - 2n**64n) : Number(v); };

  const vaultTotal     = readU64();
  const vaultPaid      = readU64();
  const treasuryTaken  = readBool();
  const drawn          = Array.from({length: 90}, () => readU8());
  const drawCount      = readU8();
  const lastNumber     = readU8();
  const startedAt      = readI64();
  const pregameAt      = readI64();
  // skip wins (7 bools + 7*32 pubkeys + 7 u8s)
  offset += 7 + 7*32 + 7;
  const active         = readBool();
  const bankruptCount  = readU8();

  return { vaultTotal, vaultPaid, drawn, drawCount, lastNumber, startedAt, active, bankruptCount };
}

// ─── Draw number instruction ──────────────────────────────────────────────────
async function drawNumber(sessionKey: PublicKey): Promise<string> {
  // Anchor discriminator for draw_number
  const disc = Buffer.from([144, 134, 159, 234, 135, 217, 134, 239]);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority.publicKey, isSigner: true,  isWritable: false },
      { pubkey: sessionKey,          isSigner: false, isWritable: true  },
      { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: disc,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: authority.publicKey });
  tx.add(ix);
  tx.sign(authority);

  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

// ─── Force end ───────────────────────────────────────────────────────────────
async function forceEnd(sessionKey: PublicKey): Promise<string> {
  const disc = Buffer.from([207, 60, 5, 248, 127, 206, 37, 33]);
  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority.publicKey, isSigner: true,  isWritable: false },
      { pubkey: sessionKey,          isSigner: false, isWritable: true  },
    ],
    data: disc,
  });

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: authority.publicKey });
  tx.add(ix);
  tx.sign(authority);

  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

// ─── Main draw loop ───────────────────────────────────────────────────────────
export async function runDrawCron(): Promise<void> {
  const sessionKey = getSessionPda();
  const session = await readSession(sessionKey);

  if (!session) {
    console.log("[cron] No session found");
    return;
  }
  if (!session.active) {
    console.log("[cron] Session inactive — skipping");
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  // Check 58-min hard limit
  if (session.startedAt > 0 && (now - session.startedAt) >= SESSION_MAX) {
    console.log("[cron] ⚠️ 58-min limit hit — forcing end");
    try {
      const sig = await forceEnd(sessionKey);
      console.log(`[cron] Session ended: ${sig}`);
    } catch (e) {
      console.error("[cron] Force-end failed:", e);
    }
    return;
  }

  // Draw next number
  try {
    const sig = await drawNumber(sessionKey);
    // Re-read to get the new number
    const updated = await readSession(sessionKey);
    console.log(
      `[cron] ✓ Drew #${updated?.lastNumber} (${updated?.drawCount}/90) — sig: ${sig.slice(0,8)}...`
    );
  } catch (e) {
    console.error("[cron] Draw failed:", e);
  }
}

// Run if called directly
if (require.main === module) {
  runDrawCron().then(() => process.exit(0)).catch(console.error);
}
