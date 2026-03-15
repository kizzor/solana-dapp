/**
 * ransome-client.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Frontend client for the Ransome Anchor program.
 * Drop this file into: app/lib/ransome-client.ts
 *
 * Usage in page.tsx:
 *   import { RansomeClient } from '@/lib/ransome-client'
 *   const client = new RansomeClient(connection, wallet)
 *   await client.initializeSession(1_000_000_000n)
 *   await client.mintDevice(grid, deviceIndex)
 *   await client.drawNumber()           // called by backend/cron, not player
 *   await client.clickCell(row, col)
 *   await client.claimWin('EARLY_FIVE')
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  SYSVAR_SLOT_HASHES_PUBKEY,
} from "@solana/web3.js";

// ─── Constants ────────────────────────────────────────────────────────────────
export const PROGRAM_ID = new PublicKey(
  "5ZFVc4h5Z6ccuxCRNM1Ubr1LC5cv6bvPugYFMJMgRU31"
);

export const TREASURY = new PublicKey(
  "F6bbR6ro9W4nS6uBMmSLhsknhQ6NJR523DZXkRQnkFcx"
);

export const WIN_TYPES = [
  "EarlyFive",
  "TopLine",
  "MiddleLine",
  "BottomLine",
  "FullHouse1",
  "FullHouse2",
  "FullHouse3",
] as const;
export type WinType = (typeof WIN_TYPES)[number];

// Map frontend WinType string → on-chain enum index
export const WIN_TYPE_INDEX: Record<string, number> = {
  EARLY_FIVE:   0,
  TOP_LINE:     1,
  MIDDLE_LINE:  2,
  BOTTOM_LINE:  3,
  FULL_HOUSE_1: 4,
  FULL_HOUSE_2: 5,
  FULL_HOUSE_3: 6,
};

// Payout basis points matching the program
export const PAYOUT_BPS: Record<string, number> = {
  EARLY_FIVE:   1000,
  TOP_LINE:     1000,
  MIDDLE_LINE:  1000,
  BOTTOM_LINE:  1000,
  FULL_HOUSE_1: 1500,
  FULL_HOUSE_2: 1500,
  FULL_HOUSE_3: 3000,
};

// ─── PDA Helpers ──────────────────────────────────────────────────────────────
export function getSessionPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("session"), authority.toBuffer()],
    PROGRAM_ID
  );
}

export function getVaultPda(sessionKey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), sessionKey.toBuffer()],
    PROGRAM_ID
  );
}

export function getDevicePda(
  sessionKey: PublicKey,
  owner: PublicKey,
  deviceIndex: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("device"),
      sessionKey.toBuffer(),
      owner.toBuffer(),
      Buffer.from([deviceIndex]),
    ],
    PROGRAM_ID
  );
}

// ─── Session State Reader ─────────────────────────────────────────────────────
export interface SessionState {
  authority: PublicKey;
  vaultTotal: bigint;
  vaultPaid: bigint;
  drawn: number[];
  drawCount: number;
  lastNumber: number;
  startedAt: number;
  pregameAt: number;
  winsClaimed: boolean[];
  winClaimers: PublicKey[];
  active: boolean;
  bankruptCount: number;
}

/** Reads and decodes session account data. */
export async function fetchSession(
  connection: Connection,
  authority: PublicKey
): Promise<SessionState | null> {
  const [sessionKey] = getSessionPda(authority);
  const info = await connection.getAccountInfo(sessionKey);
  if (!info) return null;

  // Skip 8-byte discriminator
  const data = info.data.slice(8);
  let offset = 0;

  const readPubkey = () => {
    const pk = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    return pk;
  };
  const readU8 = () => data[offset++];
  const readU64 = () => {
    const val = BigInt(
      data.slice(offset, offset + 8).reduce(
        (acc, b, i) => acc + BigInt(b) * (1n << BigInt(i * 8)),
        0n
      )
    );
    offset += 8;
    return val;
  };
  const readBool = () => data[offset++] !== 0;
  const readI64 = () => {
    const val = Number(readU64());
    return val > 2 ** 63 ? val - 2 ** 64 : val;
  };

  const authority_pk = readPubkey();
  const treasury     = readPubkey();
  const vaultBump    = readU8();
  const bump         = readU8();
  const vaultTotal   = readU64();
  const vaultPaid    = readU64();
  const treasuryTaken = readBool();

  // drawn: 90 bytes
  const drawn: number[] = [];
  for (let i = 0; i < 90; i++) drawn.push(readU8());

  const drawCount  = readU8();
  const lastNumber = readU8();
  const startedAt  = readI64();
  const pregameAt  = readI64();

  // wins_claimed: 7 bools
  const winsClaimed: boolean[] = [];
  for (let i = 0; i < 7; i++) winsClaimed.push(readBool());

  // win_claimers: 7 pubkeys
  const winClaimers: PublicKey[] = [];
  for (let i = 0; i < 7; i++) winClaimers.push(readPubkey());

  const winClaimerCount: number[] = [];
  for (let i = 0; i < 7; i++) winClaimerCount.push(readU8());

  const active        = readBool();
  const bankruptCount = readU8();

  return {
    authority: authority_pk,
    vaultTotal,
    vaultPaid,
    drawn: drawn.filter((n) => n > 0),
    drawCount,
    lastNumber,
    startedAt,
    pregameAt,
    winsClaimed,
    winClaimers,
    active,
    bankruptCount,
  };
}

// ─── RansomeClient ────────────────────────────────────────────────────────────
/**
 * High-level client. Wallet adapter is passed as an object with
 * { publicKey, sendTransaction } — compatible with @solana/wallet-adapter-react.
 */
export class RansomeClient {
  constructor(
    public connection: Connection,
    public wallet: { publicKey: PublicKey; sendTransaction: Function }
  ) {}

  // ── initialize session ──────────────────────────────────────────────────────
  async initializeSession(vaultLamports: bigint): Promise<string> {
    const authority = this.wallet.publicKey;
    const [sessionKey] = getSessionPda(authority);
    const [vaultKey]   = getVaultPda(sessionKey);

    // Build instruction data:
    // discriminator (8 bytes) + u64 vault_amount (8 bytes)
    const disc = Buffer.from([37, 61, 104, 175, 186, 149, 136, 98]); // anchor hash
    const amtBuf = Buffer.alloc(8);
    amtBuf.writeBigUInt64LE(vaultLamports);
    const data = Buffer.concat([disc, amtBuf]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority,          isSigner: true,  isWritable: true  },
        { pubkey: sessionKey,         isSigner: false, isWritable: true  },
        { pubkey: vaultKey,           isSigner: false, isWritable: true  },
        { pubkey: TREASURY,           isSigner: false, isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    return this._send([ix]);
  }

  // ── mint device ─────────────────────────────────────────────────────────────
  async mintDevice(grid: number[], deviceIndex: number): Promise<string> {
    const owner = this.wallet.publicKey;
    const [sessionKey] = getSessionPda(this.wallet.publicKey); // operator session
    const [deviceKey]  = getDevicePda(sessionKey, owner, deviceIndex);

    const disc = Buffer.from([233, 146, 209, 142, 207, 104, 64, 188]);
    const idxBuf = Buffer.from([deviceIndex]);
    const gridBuf = Buffer.from(grid.map((n) => n & 0xff));
    const data = Buffer.concat([disc, idxBuf, gridBuf]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: owner,      isSigner: true,  isWritable: true  },
        { pubkey: sessionKey, isSigner: false, isWritable: false },
        { pubkey: deviceKey,  isSigner: false, isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    return this._send([ix]);
  }

  // ── draw number (called by operator backend, not players) ───────────────────
  async drawNumber(authoritySession: PublicKey): Promise<string> {
    const [sessionKey] = getSessionPda(authoritySession);

    const disc = Buffer.from([144, 134, 159, 234, 135, 217, 134, 239]);
    const data = Buffer.concat([disc]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: this.wallet.publicKey, isSigner: true,  isWritable: false },
        { pubkey: sessionKey,            isSigner: false, isWritable: true  },
        { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    });

    return this._send([ix]);
  }

  // ── click cell ──────────────────────────────────────────────────────────────
  async clickCell(
    row: number,
    col: number,
    sessionAuthority: PublicKey,
    deviceIndex: number
  ): Promise<string> {
    const owner = this.wallet.publicKey;
    const [sessionKey] = getSessionPda(sessionAuthority);
    const [deviceKey]  = getDevicePda(sessionKey, owner, deviceIndex);

    const disc = Buffer.from([145, 248, 203, 35, 218, 152, 164, 195]);
    const data = Buffer.concat([disc, Buffer.from([row, col])]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: owner,      isSigner: true,  isWritable: false },
        { pubkey: sessionKey, isSigner: false, isWritable: false },
        { pubkey: deviceKey,  isSigner: false, isWritable: true  },
      ],
      data,
    });

    return this._send([ix]);
  }

  // ── claim win ───────────────────────────────────────────────────────────────
  async claimWin(
    frontendWinType: string,   // e.g. 'EARLY_FIVE'
    sessionAuthority: PublicKey,
    deviceIndex: number
  ): Promise<string> {
    const winner = this.wallet.publicKey;
    const [sessionKey] = getSessionPda(sessionAuthority);
    const [vaultKey]   = getVaultPda(sessionKey);
    const [deviceKey]  = getDevicePda(sessionKey, winner, deviceIndex);
    const wtIdx = WIN_TYPE_INDEX[frontendWinType];

    const disc = Buffer.from([149, 233, 37, 50, 6, 32, 191, 87]);
    const data = Buffer.concat([disc, Buffer.from([wtIdx])]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: winner,     isSigner: true,  isWritable: true  },
        { pubkey: sessionKey, isSigner: false, isWritable: true  },
        { pubkey: vaultKey,   isSigner: false, isWritable: true  },
        { pubkey: deviceKey,  isSigner: false, isWritable: false },
        { pubkey: winner,     isSigner: false, isWritable: false }, // owner
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    return this._send([ix]);
  }

  // ── force end ───────────────────────────────────────────────────────────────
  async forceEnd(): Promise<string> {
    const authority = this.wallet.publicKey;
    const [sessionKey] = getSessionPda(authority);

    const disc = Buffer.from([207, 60, 5, 248, 127, 206, 37, 33]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority,  isSigner: true,  isWritable: false },
        { pubkey: sessionKey, isSigner: false, isWritable: true  },
      ],
      data: Buffer.concat([disc]),
    });

    return this._send([ix]);
  }

  // ── sweep to treasury ───────────────────────────────────────────────────────
  async sweepToTreasury(): Promise<string> {
    const authority = this.wallet.publicKey;
    const [sessionKey] = getSessionPda(authority);
    const [vaultKey]   = getVaultPda(sessionKey);

    const disc = Buffer.from([205, 59, 96, 194, 91, 231, 27, 218]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority,  isSigner: true,  isWritable: false },
        { pubkey: sessionKey, isSigner: false, isWritable: true  },
        { pubkey: vaultKey,   isSigner: false, isWritable: true  },
        { pubkey: TREASURY,   isSigner: false, isWritable: true  },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc]),
    });

    return this._send([ix]);
  }

  // ── helper: send transaction ────────────────────────────────────────────────
  private async _send(instructions: TransactionInstruction[]): Promise<string> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("confirmed");

    const tx = new Transaction({
      feePayer: this.wallet.publicKey,
      blockhash,
      lastValidBlockHeight,
    });
    tx.add(...instructions);

    const sig = await this.wallet.sendTransaction(tx, this.connection);
    await this.connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    return sig;
  }

  // ── utility: calculate payout for a win type ────────────────────────────────
  static calculatePayout(vaultTotal: bigint, winType: string): bigint {
    const bps = BigInt(PAYOUT_BPS[winType] ?? 0);
    return (vaultTotal * bps) / 10_000n;
  }

  // ── utility: format lamports → SOL string ──────────────────────────────────
  static formatSol(lamports: bigint): string {
    return (Number(lamports) / LAMPORTS_PER_SOL).toFixed(4) + " SOL";
  }
}
