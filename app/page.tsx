'use client'

import { useState } from 'react'
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null)

  const connectWallet = async () => {
    const provider = (window as any).solana
    if (!provider) {
      alert('Phantom wallet not found')
      return
    }
    const resp = await provider.connect()
    setWalletAddress(resp.publicKey.toString())
  }

  const callProgram = async (instructionIndex: number, accounts: any[]) => {
    if (!walletAddress) return

    const provider = (window as any).solana
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed')

    const programId = new PublicKey('CZmrXHfMXuP3uUPGApinsKH9dfQZVdNehAmsnpLqTw6d')
    const userPubkey = new PublicKey(walletAddress)

    const data = Buffer.from(Uint8Array.of(instructionIndex))

    const instruction = new TransactionInstruction({
      keys: accounts,
      programId,
      data,
    })

    const transaction = new Transaction().add(instruction)
    transaction.feePayer = userPubkey
    const { blockhash } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash

    const signed = await provider.signTransaction(transaction)
    const signature = await connection.sendRawTransaction(signed.serialize())
    await connection.confirmTransaction(signature)

    alert(`Instruction ${instructionIndex} successful! Signature: ${signature}`)
  }

  return (
    <main>
      <h1>Ransome dApp</h1>
      {walletAddress ? (
        <>
          <p>Connected: {walletAddress}</p>

          {/* Validate Clickables */}
          <button
            onClick={async () => {
              const programId = new PublicKey('CZmrXHfMXuP3uUPGApinsKH9dfQZVdNehAmsnpLqTw6d')
              const userPubkey = new PublicKey(walletAddress)
              const [devicePda] = await PublicKey.findProgramAddress(
                [Buffer.from("device"), userPubkey.toBuffer()],
                programId
              )
              callProgram(0, [
                { pubkey: devicePda, isSigner: false, isWritable: true },
                { pubkey: userPubkey, isSigner: true, isWritable: false },
              ])
            }}
          >
            Validate Clickables
          </button>

          {/* Trigger Claim Window */}
          <button
            onClick={async () => {
              const programId = new PublicKey('CZmrXHfMXuP3uUPGApinsKH9dfQZVdNehAmsnpLqTw6d')
              const [claimQueuePda] = await PublicKey.findProgramAddress(
                [Buffer.from("claim_queue")],
                programId
              )
              callProgram(1, [
                { pubkey: claimQueuePda, isSigner: false, isWritable: true },
                { pubkey: new PublicKey(walletAddress), isSigner: true, isWritable: false },
              ])
            }}
          >
            Trigger Claim Window
          </button>

          {/* Distribute Payouts */}
          <button
            onClick={async () => {
              const programId = new PublicKey('CZmrXHfMXuP3uUPGApinsKH9dfQZVdNehAmsnpLqTw6d')
              const [distributionPda] = await PublicKey.findProgramAddress(
                [Buffer.from("distribution")],
                programId
              )
              const [bankPda] = await PublicKey.findProgramAddress(
                [Buffer.from("bank")],
                programId
              )
              callProgram(2, [
                { pubkey: distributionPda, isSigner: false, isWritable: true },
                { pubkey: bankPda, isSigner: false, isWritable: false },
                { pubkey: new PublicKey(walletAddress), isSigner: true, isWritable: false },
              ])
            }}
          >
            Distribute Payouts
          </button>

          {/* Trigger Bankrupt Sequence */}
          <button
            onClick={async () => {
              const programId = new PublicKey('CZmrXHfMXuP3uUPGApinsKH9dfQZVdNehAmsnpLqTw6d')
              const [bankPda] = await PublicKey.findProgramAddress(
                [Buffer.from("bank")],
                programId
              )
              callProgram(3, [
                { pubkey: bankPda, isSigner: false, isWritable: true },
                { pubkey: new PublicKey(walletAddress), isSigner: true, isWritable: false },
              ])
            }}
          >
            Trigger Bankrupt Sequence
          </button>

          {/* Trash Devices */}
          <button
            onClick={async () => {
              const programId = new PublicKey('CZmrXHfMXuP3uUPGApinsKH9dfQZVdNehAmsnpLqTw6d')
              const userPubkey = new PublicKey(walletAddress)
              const [devicePda] = await PublicKey.findProgramAddress(
                [Buffer.from("device"), userPubkey.toBuffer()],
                programId
              )
              callProgram(4, [
                { pubkey: devicePda, isSigner: false, isWritable: true },
                { pubkey: userPubkey, isSigner: true, isWritable: false },
              ])
            }}
          >
            Trash Devices
          </button>
        </>
      ) : (
        <button onClick={connectWallet}>Connect Phantom Wallet</button>
      )}
    </main>
  )
}
