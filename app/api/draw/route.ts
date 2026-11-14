import { NextResponse } from 'next/server';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { evmPublicClient } from '@/lib/evm-client';
import { ROBINHOOD_CHAIN, RANSOME_GAME_ADDRESS, MAX_DRAWS } from '@/lib/robinhood-config';
import { RANSOME_GAME_ABI } from '@/lib/game-abi';

export const dynamic = 'force-dynamic';

type Completion = { deviceId: bigint; winType: number };

/**
 * The draw reserves every tier it completes, so the tier list has to ride in
 * the SAME transaction as the number — there is no separate "declare wins"
 * call, and no window in which a completion can be added after the fact.
 * `winType` 4 = full house; the contract derives FH1/2/3 itself.
 *
 * GET  — cron keeper: draws a number, declares nothing.
 * POST — indexer: draws a number and declares the tier completions in it.
 *        Body: { completions: [{ deviceId, winType }] }
 *        Same Bearer CRON_SECRET as GET — this route signs with the authority
 *        key, so it must never be callable without it.
 */
export async function GET(request: Request) {
  return runDraw(request, []);
}

export async function POST(request: Request) {
  let completions: Completion[] = [];
  try {
    const body = await request.json();
    if (Array.isArray(body?.completions)) {
      completions = body.completions.map((c: any) => {
        const deviceId = BigInt(c?.deviceId);
        const winType = Number(c?.winType);
        if (deviceId < 0n || !Number.isInteger(winType) || winType < 0 || winType > 4) {
          throw new Error('Invalid completion');
        }
        return { deviceId, winType };
      });
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid completions payload' }, { status: 400 });
  }
  return runDraw(request, completions);
}

async function runDraw(request: Request, completions: Completion[]) {
  try {
    // 1. Authenticate cron trigger
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!RANSOME_GAME_ADDRESS || RANSOME_GAME_ADDRESS === '0x0000000000000000000000000000000000000000') {
      return NextResponse.json({ ok: false, error: 'RANSOME_GAME_ADDRESS not configured' }, { status: 400 });
    }

    const authorityKey = process.env.AUTHORITY_PRIVATE_KEY;
    if (!authorityKey) {
      return NextResponse.json({ ok: false, error: 'Authority key not set' }, { status: 500 });
    }

    // 2. Fetch active session state
    const currentSessionId = await (evmPublicClient as any).readContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'currentSessionId',
    });

    const sessionData = await (evmPublicClient as any).readContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'getSession',
      args: [currentSessionId],
    });

    const drawCount = Number(sessionData[1]);
    const active = sessionData[2];

    if (!active || drawCount >= MAX_DRAWS) {
      return NextResponse.json({ ok: true, message: 'Session completed or inactive' });
    }

    // 3. Send the draw. The ball is derived on-chain from block.prevrandao
    //    inside the transaction, so this keeper sends the tier declarations
    //    only — there is no number to pass and no off-chain pick to trust.
    //    (It used to pick here and upload its choice, which let the drawer
    //    decide the outcome.)
    const account = privateKeyToAccount((authorityKey.startsWith('0x') ? authorityKey : `0x${authorityKey}`) as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: ROBINHOOD_CHAIN as any,
      transport: http(process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'),
    });

    const hash = await (walletClient as any).writeContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'drawNumber',
      args: [completions],
      chain: ROBINHOOD_CHAIN,
    });

    // 4. Report what the chain actually drew. The session we drew into keeps
    //    its number list even after draw 59 rolls the round, so this read is
    //    valid either way.
    await (evmPublicClient as any).waitForTransactionReceipt({ hash });
    const afterDraw = await (evmPublicClient as any).readContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'getSession',
      args: [currentSessionId],
    });
    const drawnNumbers = Array.from(afterDraw[4]) as number[];

    return NextResponse.json({
      ok: true,
      sessionId: Number(currentSessionId),
      drawIndex: drawCount + 1,
      drawnNumber: drawnNumbers[drawnNumbers.length - 1],
      txHash: hash,
    });
  } catch (error: any) {
    console.error('Draw API error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to execute draw' },
      { status: 500 }
    );
  }
}
