'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider, createNetworkConfig } from '@mysten/dapp-kit'
import '@mysten/dapp-kit/dist/index.css'

// dapp-kit v1.1.9 internally uses SuiJsonRpcClient — the JSON-RPC fullnode URL
// helper lives in @mysten/sui/jsonRpc (v2.22.x removed getFullnodeUrl from client).
// We just pass the mainnet URL string directly to keep it simple and deprecation-free.
const MAINNET_URL = 'https://fullnode.mainnet.sui.io:443'

const queryClient = new QueryClient()

const { networkConfig } = createNetworkConfig({
  mainnet: { network: 'mainnet', url: MAINNET_URL },
})

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="mainnet">
        <WalletProvider>
          {children}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  )
}
