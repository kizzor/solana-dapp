import type { Metadata } from 'next'
import JackpotConsole from '@/components/JackpotConsole'
import './jackpot.css'

export const metadata: Metadata = {
  title: 'Jackpot Console — Heist Casino',
  description:
    'Watch the launchpad fee fund the slot jackpot: 100% of the platform fee, swapped once per threshold, injected into the vault.',
}

export default function CasinoPage() {
  return <JackpotConsole />
}
