import { NextResponse } from 'next/server';
import { evmPublicClient } from '@/lib/evm-client';
import { ROBINHOOD_CHAIN, RANSOME_GAME_ADDRESS } from '@/lib/robinhood-config';
import { RANSOME_GAME_ABI } from '@/lib/game-abi';

export const dynamic = 'force-dynamic';

/**
 * Quotes a reserved win so the cabinet can show "claim <amount>" and sign it.
 *
 * ⚠️ This route does NOT pay anyone and holds no key. Since 2026-11-04 the
 * claim is player-callable and amount-free: the contract reserved the cut at
 * the winning draw and `claimWin(sessionId, deviceId, winType, grid)` pays
 * exactly that number to the allocation owner — after recomputing the tier
 * from the revealed board, so this server's word is worth nothing.
 *
 * The board is the player's own ticket and this route does not know it. Pass
 * it in the request body to get a complete transaction; without it the quote
 * still returns (the amount is public) but `tx` is null and the wallet has to
 * add the board at signing.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = BigInt(body?.sessionId);
    const deviceId = BigInt(body?.deviceId);
    const winType = Number(body?.winType);

    if (sessionId < 0n || deviceId < 0n || !Number.isInteger(winType) || winType < 0 || winType > 6) {
      return NextResponse.json({ ok: false, error: 'Invalid sessionId / deviceId / winType' }, { status: 400 });
    }

    // Optional 27-cell board (row-major, 0 = empty). Echoed into the call so a
    // wallet that has it does not have to rebuild the transaction.
    let grid: number[] | null = null;
    if (Array.isArray(body?.grid)) {
      grid = body.grid.map((n: any) => Number(n));
      if (grid.length !== 27 || grid.some(n => !Number.isInteger(n) || n < 0 || n > 90)) {
        return NextResponse.json({ ok: false, error: 'Invalid grid (27 cells, 0-90)' }, { status: 400 });
      }
    }

    if (!RANSOME_GAME_ADDRESS || RANSOME_GAME_ADDRESS === '0x0000000000000000000000000000000000000000') {
      return NextResponse.json({ ok: false, error: 'Contracts not configured' }, { status: 400 });
    }

    const [amount, claimed, expired] = (await (evmPublicClient as any).readContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'claimableOf',
      args: [sessionId, deviceId, winType],
    })) as [bigint, boolean, boolean];

    if (amount === 0n) {
      return NextResponse.json(
        { ok: false, error: expired ? 'No win reserved for this tier' : 'Nothing to claim' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      sessionId: sessionId.toString(),
      deviceId: deviceId.toString(),
      winType,
      amount: amount.toString(),
      claimed,
      expired,
      claimable: !claimed && !expired,
      // The wallet — not this server — signs this. It carries no amount, so a
      // client cannot ask for more than the contract reserved, and the board is
      // the player's own commitment, so this server cannot invent a win.
      tx: grid
        ? {
            chainId: ROBINHOOD_CHAIN.id,
            to: RANSOME_GAME_ADDRESS,
            functionName: 'claimWin',
            args: [sessionId.toString(), deviceId.toString(), winType, grid],
          }
        : null,
    });
  } catch (error: any) {
    console.error('Claim Win quote error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to read the reserved win' },
      { status: 500 }
    );
  }
}
