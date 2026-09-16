import { NextResponse } from 'next/server';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { evmPublicClient } from '@/lib/evm-client';
import { ROBINHOOD_CHAIN, RANSOME_GAME_ADDRESS, MAX_DRAWS } from '@/lib/robinhood-config';
import { RANSOME_GAME_ABI } from '@/lib/game-abi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
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
    const drawnList = Array.from(sessionData[4]) as number[];

    if (!active || drawCount >= MAX_DRAWS) {
      return NextResponse.json({ ok: true, message: 'Session completed or inactive' });
    }

    // 3. Pick a new random number from 1..90 not yet drawn
    const drawnSet = new Set(drawnList);
    const availableNumbers: number[] = [];
    for (let i = 1; i <= 90; i++) {
      if (!drawnSet.has(i)) {
        availableNumbers.push(i);
      }
    }

    if (availableNumbers.length === 0) {
      return NextResponse.json({ ok: true, message: 'All numbers drawn' });
    }

    const randomIndex = Math.floor(Math.random() * availableNumbers.length);
    const nextNumber = availableNumbers[randomIndex];

    // 4. Send transaction via authority account
    const account = privateKeyToAccount((authorityKey.startsWith('0x') ? authorityKey : `0x${authorityKey}`) as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: ROBINHOOD_CHAIN as any,
      transport: http(process.env.ROBINHOOD_RPC_URL || 'https://rpc.robinhood.com'),
    });

    const hash = await (walletClient as any).writeContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'drawNumber',
      args: [nextNumber],
      chain: ROBINHOOD_CHAIN,
    });

    return NextResponse.json({
      ok: true,
      sessionId: Number(currentSessionId),
      drawIndex: drawCount + 1,
      drawnNumber: nextNumber,
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
