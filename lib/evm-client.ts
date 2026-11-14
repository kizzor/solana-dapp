import { createPublicClient, http } from 'viem';
import { ROBINHOOD_CHAIN } from './robinhood-config';

// Read from the chain config so the browser bundle follows the same RPC as the
// rest of the app. A non-public env var is not inlined into the client, which
// previously left local mode reading the production RPC.
export const evmPublicClient = createPublicClient({
  chain: ROBINHOOD_CHAIN as any,
  transport: http(ROBINHOOD_CHAIN.rpcUrls.default.http[0]),
});
