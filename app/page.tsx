'use client'

import { useEffect, useState } from 'react'

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null)

  // Check if Phantom is installed
  useEffect(() => {
    const provider = (window as any).solana
    if (provider?.isPhantom) {
      provider.on('connect', () => setWalletAddress(provider.publicKey.toString()))
      provider.on('disconnect', () => setWalletAddress(null))
    }
  }, [])

  const connectWallet = async () => {
    try {
      const provider = (window as any).solana
      if (provider) {
        const resp = await provider.connect()
        setWalletAddress(resp.publicKey.toString())
      } else {
        alert('Phantom wallet not found. Please install it.')
      }
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <main>
      <h1>Solana dApp</h1>
      {walletAddress ? (
        <p>Connected: {walletAddress}</p>
      ) : (
        <button onClick={connectWallet}>Connect Phantom Wallet</button>
      )}
    </main>
  )
}
