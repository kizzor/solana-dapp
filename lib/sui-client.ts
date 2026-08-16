import { SuiGrpcClient } from '@mysten/sui/grpc'
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport'

export type SuiNetwork = 'mainnet' | 'testnet' | 'devnet'

// Shared SUI gRPC client factory for all server routes.
//
// Endpoint resolution:
//   SUI_RPC_URL  → dedicated provider gRPC endpoint (default: public fullnode
//                  for the network). A dedicated provider avoids the stale-read
//                  problem seen on the shared public fullnode from Vercel
//                  egress (txs broadcast fine, but reads can lag behind).
//
// Optional auth (keyed providers such as Inodra / BlockPI / Ankr Premium):
//   SUI_RPC_TOKEN        → API key / token sent on every request.
//   SUI_RPC_TOKEN_HEADER → header name (default 'x-api-key'; Ankr Premium uses
//                          'x-token').
//
// ⚠️ GrpcWebFetchTransport ignores `fetchInit.headers` (it overwrites them with
// headers built from its `meta` option), so the token MUST be passed via
// `meta` — hence the custom transport below.
export function createSuiClient(network: SuiNetwork): SuiGrpcClient {
  const baseUrl = process.env.SUI_RPC_URL || `https://fullnode.${network}.sui.io:443`
  // Trim defensively — trailing newlines/spaces in pasted env values (a recurring
  // gotcha in this project) would otherwise make the provider reject the key.
  const token = (process.env.SUI_RPC_TOKEN || '').trim()
  if (token) {
    const headerName = (process.env.SUI_RPC_TOKEN_HEADER || 'x-api-key').trim()
    const transport = new GrpcWebFetchTransport({
      baseUrl,
      meta: { [headerName]: token },
    })
    return new SuiGrpcClient({ network, transport })
  }
  return new SuiGrpcClient({ network, baseUrl })
}
