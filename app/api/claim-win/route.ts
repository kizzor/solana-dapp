import { NextResponse } from 'next/server';
import { createWalletClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { evmPublicClient } from '@/lib/evm-client';
import { ROBINHOOD_CHAIN, RANSOME_GAME_ADDRESS, RANSOME_VAULT_ADDRESS, USDG_ADDRESS } from '@/lib/robinhood-config';
import { RANSOME_GAME_ABI, ERC20_ABI } from '@/lib/game-abi';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sessionId, winner, winType, minXOut = '0' } = body;

    if (!sessionId || !winner || !winType) {
      return NextResponse.json({ ok: false, error: 'Missing required parameters' }, { status: 400 });
    }

    if (!RANSOME_GAME_ADDRESS || RANSOME_GAME_ADDRESS === '0x0000000000000000000000000000000000000000') {
      return NextResponse.json({ ok: false, error: 'Contracts not configured' }, { status: 400 });
    }

    const authorityKey = process.env.AUTHORITY_PRIVATE_KEY;
    if (!authorityKey) {
      return NextResponse.json({ ok: false, error: 'Authority key not set' }, { status: 500 });
    }

    // Read current vault USDG balance
    const vaultBalance = await (evmPublicClient as any).readContract({
      address: USDG_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [RANSOME_VAULT_ADDRESS],
    });

    if (vaultBalance === 0n) {
      return NextResponse.json({ ok: false, error: 'Vault is empty' }, { status: 400 });
    }

    // Calculate prize share: winType 1 = Line Win (15%), winType 2 = Full House (70%)
    let prizeShare = 0n;
    if (winType === 1) {
      prizeShare = (vaultBalance * 15n) / 100n;
    } else if (winType === 2) {
      prizeShare = (vaultBalance * 70n) / 100n;
    } else {
      return NextResponse.json({ ok: false, error: 'Invalid winType (1: Line, 2: FH)' }, { status: 400 });
    }

    if (prizeShare === 0n) {
      return NextResponse.json({ ok: false, error: 'Prize share calculated as 0' }, { status: 400 });
    }

    const minXOutBigInt = BigInt(minXOut);

    const account = privateKeyToAccount((authorityKey.startsWith('0x') ? authorityKey : `0x${authorityKey}`) as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: ROBINHOOD_CHAIN as any,
      transport: http(process.env.ROBINHOOD_RPC_URL || 'https://rpc.robinhood.com'),
    });

    const txHash = await (walletClient as any).writeContract({
      address: RANSOME_GAME_ADDRESS,
      abi: RANSOME_GAME_ABI,
      functionName: 'claimWin',
      args: [BigInt(sessionId), winner as `0x${string}`, Number(winType), prizeShare, minXOutBigInt],
      chain: ROBINHOOD_CHAIN,
    });

    return NextResponse.json({
      ok: true,
      sessionId,
      winner,
      winType,
      prizeUsdgShare: prizeShare.toString(),
      txHash,
    });
  } catch (error: any) {
    console.error('Claim Win API error:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to settle claim' },
      { status: 500 }
    );
  }
}
