'use client'

import { useEffect, useState } from 'react'
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null)

  // Connect Phantom
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

  // Send 0.01 SOL to a test address
  const sendTransaction = async () => {
    try {
      const provider = (window as any).solana
      if (!provider || !walletAddress) {
        alert('Connect your wallet first!')
        return
      }

      const connection = new Connection('https://api.devnet.solana.com', 'confirmed')

      // Replace with your own test recipient address
      const recipient = new PublicKey('7krVZgg69yQBCiHunnsDERCP1hJ9gpds8fTESzc66CgH')

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(walletAddress),
          toPubkey: recipient,
          lamports: 0.01 * 1e9, // 0.01 SOL in lamports
        })
      )

      transaction.feePayer = new PublicKey(walletAddress)
      const { blockhash } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash

      const signed = await provider.signTransaction(transaction)
      const signature = await connection.sendRawTransaction(signed.serialize())
      await connection.confirmTransaction(signature)

      alert(`Transaction successful! Signature: ${signature}`)
    } catch (err) {
      console.error(err)
      alert('Transaction failed. Check console for details.')
    }
  }

  return (
    <main>
      <h1>Solana dApp</h1>
      {walletAddress ? (
        <>
          <p>Connected: {walletAddress}</p>
          <button onClick={sendTransaction}>Send 0.01 SOL</button>
        </>
      ) : (
        <button onClick={connectWallet}>Connect Phantom Wallet</button>
      )}
    </main>
  )
}
