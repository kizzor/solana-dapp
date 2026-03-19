import { NextResponse } from 'next/server'
import {
  Connection, Keypair, PublicKey, Transaction,
  TransactionInstruction, SYSVAR_SLOT_HASHES_PUBKEY
} from '@solana/web3.js'

const PROGRAM_ID = new PublicKey('5ZFVc4h5Z6ccuxCRNM1Ubr1LC5cv6bvPugYFMJMgRU31')

function getSessionPda(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('session'), authority.toBuffer()],
    PROGRAM_ID
  )[0]
}

export async function GET(req: Request) {
  // Auth check
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Load authority keypair from env
    const keyArr = JSON.parse(process.env.AUTHORITY_KEYPAIR || '[]')
    if (!keyArr.length) throw new Error('AUTHORITY_KEYPAIR not set')
    const authority = Keypair.fromSecretKey(Uint8Array.from(keyArr))

    // Connect to Solana
    const rpc = process.env.RPC_URL || 'https://api.devnet.solana.com'
    const connection = new Connection(rpc, 'confirmed')

    // Get session PDA
    const sessionKey = getSessionPda(authority.publicKey)

    // Check session exists and is active
    const sessionInfo = await connection.getAccountInfo(sessionKey)
    if (!sessionInfo) {
      return NextResponse.json({ ok: false, msg: 'No session found — initialize first' })
    }

    // Read active flag (offset: 8 discriminator + 32+32+1+1+8+8+1+90+1+1+8+8+7+224+7 = 439)
    // active is at byte 439 in the account data
    const data = sessionInfo.data
    const active = data[439] === 1
    if (!active) {
      return NextResponse.json({ ok: false, msg: 'Session not active' })
    }

    // Anchor discriminator for draw_number instruction
    // sha256("global:draw_number")[0..8]
    const disc = Buffer.from([144, 134, 159, 234, 135, 217, 134, 239])

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey,       isSigner: true,  isWritable: false },
        { pubkey: sessionKey,                isSigner: false, isWritable: true  },
        { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: disc,
    })

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash('confirmed')
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: authority.publicKey })
    tx.add(ix)
    tx.sign(authority)

    const sig = await connection.sendRawTransaction(tx.serialize())
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

    // Read new last_number from session (offset 8+32+32+1+1+8+8+1+90+1 = 183, last_number at 184)
    const updated = await connection.getAccountInfo(sessionKey)
    const drawCount = updated?.data[183] ?? 0
    const lastNum   = updated?.data[184] ?? 0

    return NextResponse.json({
      ok: true,
      sig: sig.slice(0, 16) + '...',
      number: lastNum,
      drawCount,
      ts: Date.now()
    })

  } catch (e: any) {
    console.error('[draw] error:', e.message)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
