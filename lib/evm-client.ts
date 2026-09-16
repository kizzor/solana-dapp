import { createPublicClient, http } from 'viem';
import { ROBINHOOD_CHAIN } from './robinhood-config';

export const evmPublicClient = createPublicClient({
  chain: ROBINHOOD_CHAIN as any,
  transport: http(process.env.ROBINHOOD_RPC_URL || 'https://rpc.robinhood.com'),
});
