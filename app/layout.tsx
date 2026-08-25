import type { Metadata, Viewport } from 'next'
import './globals.css'
import '@solana/wallet-adapter-react-ui/styles.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Ransome | SUI DApp',
  description: 'Ransome — blockchain bingo/hacking game on SUI',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
