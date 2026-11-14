import type { Metadata } from 'next';
import RaffleApp from '@/components/raffle/RaffleApp';
import './raffle.css';

export const metadata: Metadata = {
  title: 'raffle.fun — trade the coin, play the draw',
  description:
    'A launchpad where 0.20% of every trade funds a 59-draw raffle jackpot. One shell: the board, and the cabinet as a toggle.',
};

export default function RafflePage() {
  return <RaffleApp />;
}
