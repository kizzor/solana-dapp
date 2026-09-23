'use client'
import './globals.css'
import '@solana/wallet-adapter-react-ui/styles.css'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ConnectionProvider, WalletProvider, useWallet, useConnection } from '@solana/wallet-adapter-react'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useEvmWallet } from '@/lib/use-evm-wallet'
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_CHAIN, SUPPORTED_EVM_CHAINS } from '@/lib/robinhood-config'
// SUI imports
// dapp-kit hooks — wallet state, connect/disconnect, and tx signing
// EVM wallet hook imported below

// ─── Types ────────────────────────────────────────────────────────────────────
type Cell = { num: number | null; matched: boolean; clicked: boolean; missed: boolean }
type Device = {
  walletAddr: string | null; id: number; nftId: string; grid: Cell[][]; claimed: Set<string>; active: boolean; corrupted: boolean
}
type WinType = 'EARLY_FIVE' | 'TOP_LINE' | 'MIDDLE_LINE' | 'BOTTOM_LINE' | 'FULL_HOUSE_1' | 'FULL_HOUSE_2' | 'FULL_HOUSE_3'
type WinState = { claimed: boolean; claimable: boolean; flickering: boolean; broken: boolean; claimers: string[]; expired: boolean; bursting: boolean }
type ChatLine = { t: 'sys' | 'user' | 'cmd' | 'img'; m: string; src?: string; vSrc?: string }
type WinRecord = { wt: WinType; claimers: string[]; round: number; split: number; heistEach: number }
type MediaItem = { src: string; type: 'image' | 'video'; name: string }

const STORAGE_KEY = 'ransome_state_v1'
function saveState(data: object) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { } }
function loadState(): any { try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null } catch { return null } }

// ─── Constants ────────────────────────────────────────────────────────────────
// ⚠️ DEV MODE — Set to false for production
const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === 'true'
// ──────────────────────────────────────────────────────────────────────────────
const WIN_LABELS: Record<WinType, string> = {
  EARLY_FIVE: '5 Digit Accounts Hacked', TOP_LINE: 'Top Accounts Hacked',
  MIDDLE_LINE: 'Central System Hacked', BOTTOM_LINE: 'Basement Hacked',
  FULL_HOUSE_1: 'Bankrupt Ransome I', FULL_HOUSE_2: 'Bankrupt Ransome II', FULL_HOUSE_3: 'Bankrupt Ransome III',
}
const LED_COLORS: Record<WinType, string> = {
  EARLY_FIVE: '#f59e0b', TOP_LINE: '#c084fc', MIDDLE_LINE: '#a78bfa', BOTTOM_LINE: '#a16207',
  FULL_HOUSE_1: '#f472b6', FULL_HOUSE_2: '#ec4899', FULL_HOUSE_3: '#db2777',
}
// Win type payouts in basis points — FULL_HOUSE_3 is the 40% jackpot
// All other wins split their % equally among same-round claimers
const WIN_BPS: Record<WinType, number> = {
  EARLY_FIVE: 500, TOP_LINE: 500, MIDDLE_LINE: 500, BOTTOM_LINE: 500,   //  5% each = 20%
  FULL_HOUSE_1: 1950, FULL_HOUSE_2: 1950,                            // 19.5% each = 39%
  FULL_HOUSE_3: 4000,                                                // 40%     = 40%
}                                                                   // Total:   99%
// Treasury fee: 1% of vault (deducted upfront)
// Remaining 99% = game vault — fully allocated to the 7 win positions above
// Unclaimed positions at game end → treasury. No other distribution.

// ─── HEIST Token Economics ──────────────────────────────────────────────────
// ╔══ HEIST PRICING RULES (placeholder until a real market exists) ═══════════╗
// ║ 1. Price resolution: live feed → HEIST_PRICE_USD env → placeholder        ║
// ║    $0.0001. The placeholder keeps HEIST mintable out of the box; once     ║
// ║    HEIST_COINGECKO_ID / HEIST_PRICE_API_URL is configured, the real       ║
// ║    market price flows in automatically (draw cron syncs it on-chain).     ║
// ║ 2. Mint cost in HEIST = $0.50 / price (e.g. 250 HEIST at $0.002, or       ║
// ║    5,000 HEIST at the $0.0001 placeholder), shown live in the             ║
// ║    MINT_TERMINAL from /api/session-state (`prices` + `rates`).            ║
// ║ 3. Any coin (SUI/USDC/USDT/HEIST) pays $0.50 ($0.25 MTRX); the vault       ║
// ║    ALWAYS holds HEIST only (99% of payment → vault, 1% treasury).         ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const DEVICE_PRICE_USDC = 0.5   // Device price in USDC

// v5: ANY-COIN mint — the console costs $0.50 USD in any registered coin
// ($0.25 with MTRX delegation). Exact raw amounts come from the server's
// /api/session-state `prices` map (live SUI price). Coin types:
const SUI_COIN_TYPE = '0x2::sui::SUI'
const USDC_COIN_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' // Circle native
const USDT_COIN_TYPE = (process.env.NEXT_PUBLIC_USDT_COIN_TYPE || '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN').trim() // Wormhole USDT, confirmed 2026-08-15
const HEIST_ADMIN_ID = process.env.NEXT_PUBLIC_HEIST_ADMIN_ID || 'SET_AFTER_SETUP'

// ─── MTRX Governance Token (Solana) ───────────────────────────────────────
// Placeholder addresses — user provides actual after deployment
const MTRX_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_MTRX_CONTRACT_ADDRESS || 'MTRX_PLACEHOLDER_ADDRESS'
const MTRX_DELEGATION_VAULT = process.env.NEXT_PUBLIC_MTRX_DELEGATION_VAULT || 'VAULT_PLACEHOLDER_ADDRESS'
const MTRX_DECIMALS = 9
const MTRX_DELEGATION_THRESHOLD = 1000

// v5: MTRX holders pay 50% off ($0.25) — applied via the prices map + `discounted` flag

// Fallback vault estimate when session-state isn't available
const VAULT_ESTIMATE = 0

const COL_HEADERS = ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81-90']
const COL_RANGES: [number, number][] = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 70], [71, 80], [81, 90]]
// ─── SUI Treasury Wallet ───────────────────────────────────────────────
// Where unclaimed vault funds go at session end.
// Should match the treasury_address passed to initialize_session in the HEIST contract.
const CLAIM_WALLET = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '0x01d4a72efddaa35d8196b2d07f32b619a1e237e74200d5331f565a925bb8ace1'
const HACK_CMDS = ['INIT PAYLOAD', 'BYPASS FIREWALL', 'SCAN PORT 8443', 'BRUTE SHA-256', 'DECRYPT TLS', 'EXPLOIT CVE-2024', 'INJECT SQL', 'PIVOT SUBNET', 'EXFIL DECENTERILZIED VAULT', 'SPOOF MAC', 'ARP POISON', 'DUMP LSASS', 'ESCALATE PRIV', 'DEPLOY ROOTKIT', 'TUNNEL SSH', 'SNIFF ETH0', 'CRACK WPA2', 'OVERFLOW STACK', 'COVER TRACKS', 'FORGE JWT', 'EXFIL DB', 'PIVOT VPN', 'DEPLOY METERP', 'RCE SHELL', 'WIPE LOGS']
const HACK_STATUSES = ['[OK]', '[ACK]', '[ERR]', '[WARN]', '[DONE]', '[LIVE]']

const BANKS = [
  { id: 0, name: 'Pacific Reserve', city: 'Auckland', tz: 12, x: 87, y: 72, region: 'APAC', vault: '$1.2B' },
  { id: 1, name: 'Sakura Central', city: 'Tokyo', tz: 9, x: 80, y: 31, region: 'APAC', vault: '$2.1B' },
  { id: 2, name: 'Dragon Vault', city: 'Shanghai', tz: 8, x: 76, y: 35, region: 'APAC', vault: '$3.8B' },
  { id: 3, name: 'Tiger Bank', city: 'Singapore', tz: 8, x: 74, y: 54, region: 'APAC', vault: '$1.9B' },
  { id: 4, name: 'Indus Capital', city: 'Mumbai', tz: 5.5, x: 64, y: 41, region: 'ASIA', vault: '$2.4B' },
  { id: 5, name: 'Gulf Reserve', city: 'Dubai', tz: 4, x: 61, y: 40, region: 'MENA', vault: '$4.1B' },
  { id: 6, name: 'Nile Treasury', city: 'Cairo', tz: 2, x: 53, y: 37, region: 'MENA', vault: '$0.9B' },
  { id: 7, name: 'Savanna Vault', city: 'Nairobi', tz: 3, x: 56, y: 58, region: 'AFR', vault: '$0.6B' },
  { id: 8, name: 'Cape Reserve', city: 'Cape Town', tz: 2, x: 52, y: 75, region: 'AFR', vault: '$0.8B' },
  { id: 9, name: 'Colosseum Bank', city: 'Rome', tz: 1, x: 50, y: 29, region: 'EUR', vault: '$1.7B' },
  { id: 10, name: 'Rhine Vault', city: 'Frankfurt', tz: 1, x: 50, y: 23, region: 'EUR', vault: '$3.2B' },
  { id: 11, name: 'Thames Capital', city: 'London', tz: 0, x: 46, y: 23, region: 'EUR', vault: '$5.1B' },
  { id: 12, name: 'Nordic Reserve', city: 'Oslo', tz: 1, x: 49, y: 16, region: 'EUR', vault: '$1.1B' },
  { id: 13, name: 'Kremlin Bank', city: 'Moscow', tz: 3, x: 58, y: 20, region: 'EUR', vault: '$2.8B' },
  { id: 14, name: 'Atlas Treasury', city: 'Casablanca', tz: 1, x: 44, y: 35, region: 'AFR', vault: '$0.7B' },
  { id: 15, name: 'Amazon Reserve', city: 'São Paulo', tz: -3, x: 32, y: 67, region: 'AMER', vault: '$1.6B' },
  { id: 16, name: 'Andes Vault', city: 'Bogotá', tz: -5, x: 24, y: 54, region: 'AMER', vault: '$0.8B' },
  { id: 17, name: 'Manhattan Capital', city: 'New York', tz: -5, x: 21, y: 28, region: 'AMER', vault: '$6.7B' },
  { id: 18, name: 'Silicon Reserve', city: 'San Francisco', tz: -8, x: 10, y: 32, region: 'AMER', vault: '$4.3B' },
  { id: 19, name: 'Maple Treasury', city: 'Toronto', tz: -5, x: 20, y: 24, region: 'AMER', vault: '$2.2B' },
  { id: 20, name: 'Red Sea Bank', city: 'Riyadh', tz: 3, x: 59, y: 40, region: 'MENA', vault: '$3.5B' },
  { id: 21, name: 'Carnival Bank', city: 'Rio', tz: -3, x: 33, y: 68, region: 'AMER', vault: '$1.0B' },
  { id: 22, name: 'Azores Vault', city: 'Lisbon', tz: 0, x: 43, y: 29, region: 'EUR', vault: '$1.4B' },
]
const REGION_COLORS: { [k: string]: string } = { APAC: '#c084fc', EUR: '#a78bfa', AMER: '#f59e0b', MENA: '#f97316', AFR: '#a855f7', ASIA: '#ec4899' }

const defaultWinStates = (): Record<WinType, WinState> => ({
  EARLY_FIVE: { claimed: false, claimable: false, flickering: false, broken: false, claimers: [], expired: false, bursting: false },
  TOP_LINE: { claimed: false, claimable: false, flickering: false, broken: false, claimers: [], expired: false, bursting: false },
  MIDDLE_LINE: { claimed: false, claimable: false, flickering: false, broken: false, claimers: [], expired: false, bursting: false },
  BOTTOM_LINE: { claimed: false, claimable: false, flickering: false, broken: false, claimers: [], expired: false, bursting: false },
  FULL_HOUSE_1: { claimed: false, claimable: false, flickering: false, broken: false, claimers: [], expired: false, bursting: false },
  FULL_HOUSE_2: { claimed: false, claimable: false, flickering: false, broken: false, claimers: [], expired: false, bursting: false },
  FULL_HOUSE_3: { claimed: false, claimable: false, flickering: false, broken: false, claimers: [], expired: false, bursting: false },
})

function getLiveBank(h: number) { return h % 23 }

// ─── Ticket Generator ─────────────────────────────────────────────────────────
function generateDevice(id: number): Device {
  const nftId = `HEIST-${String(id).padStart(4, '0')}`
  const colCounts = Array(9).fill(1)
  Array.from({ length: 9 }, (_, i) => i).sort(() => Math.random() - 0.5).slice(0, 6).forEach(i => colCounts[i]++)
  const colRows: number[][] = colCounts.map(cnt => [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, cnt))
  const rowCounts = [0, 0, 0]; colRows.forEach(rows => rows.forEach(r => rowCounts[r]++))
  let att = 0
  while ((rowCounts[0] !== 5 || rowCounts[1] !== 5 || rowCounts[2] !== 5) && att < 200) {
    att++; colCounts.fill(1)
    Array.from({ length: 9 }, (_, i) => i).sort(() => Math.random() - 0.5).slice(0, 6).forEach(i => colCounts[i]++)
    colRows.splice(0, 9, ...colCounts.map(cnt => [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, cnt)))
    rowCounts.fill(0); colRows.forEach(rows => rows.forEach(r => rowCounts[r]++))
  }
  const used = new Set<number>()
  const grid: Cell[][] = Array.from({ length: 3 }, () => Array(9).fill(null).map(() => ({ num: null, matched: false, clicked: false, missed: false })))
  for (let ci = 0; ci < 9; ci++) {
    const [lo, hi] = COL_RANGES[ci]; const rows = colRows[ci].sort((a, b) => a - b)
    const avail: number[] = []; for (let n = lo; n <= hi; n++)if (!used.has(n)) avail.push(n)
    const picked = avail.sort(() => Math.random() - 0.5).slice(0, rows.length).sort((a, b) => a - b)
    picked.forEach(n => used.add(n)); rows.forEach((r, i) => { grid[r][ci] = { num: picked[i], matched: false, clicked: false, missed: false } })
  }
  return { id, nftId, walletAddr: null, grid, claimed: new Set(), active: false, corrupted: false }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function useHourCountdown() {
  const get = () => { const now = new Date(); const s = now.getUTCMinutes() * 60 + now.getUTCSeconds(); const l = 3600 - s - 300; return l > 0 ? l : 0 }
  const [s, setS] = useState(get)
  useEffect(() => { const t = setInterval(() => setS(get()), 1000); return () => clearInterval(t) }, [])
  return s
}
// 59-minute lobby cycle — resets every 59 minutes from UTC epoch
// Fill pct rises 0→1 as countdown falls 59min→0
const LOBBY_CYCLE = 59 * 60
function useLobbyCountdown(devOffset = 0) {
  const get = () => {
    if (DEV_MODE && devOffset === 0) return 0 // Skip countdown in dev mode
    const now = new Date()
    const elapsed = now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()
    // Dev time-travel: shift the UTC cycle so the lobby clock can be jumped
    return Math.max(0, LOBBY_CYCLE - ((elapsed + devOffset) % LOBBY_CYCLE))
  }
  const [s, setS] = useState(get)
  useEffect(() => { const t = setInterval(() => setS(get()), 1000); return () => clearInterval(t) }, [devOffset])
  return s
}
function fmtTime(s: number) { const m = Math.floor(s / 60), ss = s % 60; return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` }


// ─── On-chain session polling ──────────────────────────────────────────────
// Polls /api/session-state every 2s during game to get live on-chain numbers
function useOnChainSession(active: boolean) {
  const [onChain, setOnChain] = useState<{
    lastNumber: number; drawCount: number; drawn: number[];
    active: boolean; bankruptCount: number; winsClaimed: boolean[];
    vaultTotal: number;
    prices?: Record<string, { full: string; mtrx: string }>;
    rates?: Record<string, string>;
    registryPaused?: boolean; registryPauseEndMs?: number;
    maxDraws?: number;
  } | null>(null)
  useEffect(() => {
    if (!active) return
    const poll = async () => {
      try {
        const r = await fetch('/api/session-state')
        if (r.ok) { const d = await r.json(); if (d.ok) setOnChain(d) }
      } catch { }
    }
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [active])
  return onChain
}

// ─── MiniStopwatch ────────────────────────────────────────────────────────────
function MiniStopwatch({ seconds, total }: { seconds: number; total: number }) {
  const danger = seconds <= 10, r = 12, circ = 2 * Math.PI * r, dash = circ * (seconds / Math.max(total, 1))
  return (
    <div style={{ position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
      <svg width="34" height="34" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="17" cy="17" r={r} fill="none" stroke="#150d24" strokeWidth="2.5" />
        <circle cx="17" cy="17" r={r} fill="none" stroke={danger ? '#ff5c8a' : '#b26bff'} strokeWidth="2.5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.9s linear,stroke 0.3s' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700, color: danger ? '#ff5c8a' : '#b26bff' }}>{String(seconds % 60).padStart(2, '0')}</span>
      </div>
    </div>
  )
}

// ─── Outline World Map with bank sketches ────────────────────────────────────
function WorldMapSketch({ currentHour, onSelectBank, style, className }: { currentHour: number; onSelectBank?: (id: number) => void; style?: React.CSSProperties; className?: string }) {
  const live = getLiveBank(currentHour)
  const hourCd = useHourCountdown()
  const [hov, setHov] = useState<number | null>(null)
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0612', overflow: 'hidden', minHeight: 200, ...style }}>
      <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuB-qpHYdNrYszBgUEZK-XDwmoipoMY4fuwa6ooHcfdmGgOMR5hPsRnliaYv7UJIzsxEbBsoczbGp6nMjFaXT_Rwg2-zWBrnyEkuAKxW9KAc96MFqIKwxhSHGFXRMNEgYKENqjtU0LSdGC7Rj88SfAUFBK0_gcGjXckGkgXuEZySbIs4zWwpI6knvocSlgQdEYGheuw7Zanu5xobKhkWNSKh8okeX4k4QU0KSuxu-CD85KNnOYUlO0lEYScZM-1_wi7E_IAnX1gr460x"
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', position: 'absolute', inset: 0, opacity: 0.45, filter: 'saturate(0.35) brightness(0.7) contrast(1.2)', pointerEvents: 'none' }} alt="" />
      <svg viewBox="0 0 400 210" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block', position: 'relative', zIndex: 2 }}>
        {Array.from({ length: 41 }, (_, i) => <line key={"vg" + i} x1={i * 10} y1="0" x2={i * 10} y2="210" stroke="#170f2b" strokeWidth="0.15" />)}
        {Array.from({ length: 22 }, (_, i) => <line key={"hg" + i} x1="0" y1={i * 10} x2="400" y2={i * 10} stroke="#170f2b" strokeWidth="0.15" />)}
        <line x1="0" y1="105" x2="400" y2="105" stroke="#150d24" strokeWidth="0.6" strokeDasharray="4,4" />
        <text x="4" y="103" fontSize="3.5" fill="#150d24">EQ</text>
        {BANKS.filter(b => b.id !== live).map(b => (
          <line key={"cl" + b.id} x1={BANKS[live].x * 4} y1={BANKS[live].y * 2} x2={b.x * 4} y2={b.y * 2} stroke="#b26bff08" strokeWidth="0.5" strokeDasharray="2,5" />
        ))}
        {BANKS.map(b => {
          const isLive = b.id === live, isHov = b.id === hov
          const rc = REGION_COLORS[b.region] || '#241538'
          const bx = b.x * 4, by = b.y * 2
          return (
            <g key={b.id} onClick={() => onSelectBank?.(b.id)} onMouseEnter={() => setHov(b.id)} onMouseLeave={() => setHov(null)} style={{ cursor: 'pointer' }}>
              {isLive && <>
                <rect x={bx - 10} y={by - 10} width="20" height="20" fill={rc + "08"} stroke="none"><animate attributeName="width" values="10;28;10" dur="2.5s" repeatCount="indefinite" /><animate attributeName="height" values="10;28;10" dur="2.5s" repeatCount="indefinite" /><animate attributeName="x" values={`${bx - 5};${bx - 14};${bx - 5}`} dur="2.5s" repeatCount="indefinite" /><animate attributeName="y" values={`${by - 5};${by - 14};${by - 5}`} dur="2.5s" repeatCount="indefinite" /></rect>
                <rect x={bx - 5} y={by - 5} width="10" height="10" fill={rc + "15"} stroke={rc} strokeWidth="0.5"><animate attributeName="width" values="6;14;6" dur="2s" repeatCount="indefinite" /><animate attributeName="height" values="6;14;6" dur="2s" repeatCount="indefinite" /><animate attributeName="x" values={`${bx - 3};${bx - 7};${bx - 3}`} dur="2s" repeatCount="indefinite" /><animate attributeName="y" values={`${by - 3};${by - 7};${by - 3}`} dur="2s" repeatCount="indefinite" /></rect>
              </>}
              <rect x={bx - 2.5} y={by - 2.5} width="5" height="5" rx="0.5"
                fill={isLive ? rc + "60" : isHov ? '#b26bff40' : 'transparent'}
                stroke={isLive ? rc : isHov ? '#b26bff' : '#453071'} strokeWidth={isLive ? 1.5 : 0.8} />
              <circle cx={bx} cy={by} r="1" fill={isLive ? rc : isHov ? '#b26bff' : '#2d1f4a'} />
              {(isHov || isLive) && <>
                <rect x={bx - 14} y={by - 20} width="28" height="14" rx="1.5" fill="#010c18ee" stroke={isLive ? rc : '#b26bff'} strokeWidth="0.7" />
                <text x={bx} y={by - 13} textAnchor="middle" fontSize="5" fill={isLive ? rc : '#b26bff'} fontWeight="bold">{b.city}</text>
                <text x={bx} y={by - 7} textAnchor="middle" fontSize="3.5" fill="#a99bc4">{isLive ? '⏱ ' + fmtTime(hourCd) : b.vault}</text>
              </>}
            </g>
          )
        })}
        <text x="4" y="206" fontSize="3.5" fill="#241538">■ LIVE  □ SCHEDULED  — DECENTERILZIED VAULT LINK</text>
      </svg>
    </div>
  )
}

function DeviceSkeleton({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div style={{ background: 'linear-gradient(180deg,#1a1029,#0b0614)', border: '2px solid #241538', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
      {/* Device top bar */}
      <div style={{ background: 'linear-gradient(90deg,#150d24,#1a1029)', padding: '7px 10px', borderBottom: '1px solid #1a1029', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 14, background: 'linear-gradient(to bottom,#b26bff 0%,#7c3aed 100%)', clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)' }} />
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 9, fontWeight: 700, color: '#b26bff', letterSpacing: '0.1em' }}>{title}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['#ff5c8a', '#f97316', '#a78bfa'].map((c, i) => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: c, boxShadow: `0 0 5px ${c}` }} />)}
        </div>
      </div>
      {/* LED strip top */}
      <div style={{ background: '#150d24', height: 5, display: 'flex', gap: 3, alignItems: 'center', padding: '0 8px', borderBottom: '1px solid #0b0614' }}>
        {Array.from({ length: 18 }, (_, i) => <div key={i} style={{ width: 4, height: 3, borderRadius: 1, background: i % 5 === 0 ? '#b26bff20' : '#170f2b' }} />)}
      </div>
      {/* Content */}
      <div style={{ padding: '12px 10px 10px' }}>{children}</div>
      {/* LED strip bottom */}
      <div style={{ background: '#150d24', height: 5, display: 'flex', gap: 3, alignItems: 'center', padding: '0 8px', borderTop: '1px solid #0b0614' }}>
        {Array.from({ length: 18 }, (_, i) => <div key={i} style={{ width: 4, height: 3, borderRadius: 1, background: i % 4 === 0 ? '#b26bff15' : '#170f2b' }} />)}
      </div>
      {/* Device bottom bar */}
      <div style={{ background: '#080f1c', padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #1a1029' }}>
        <div style={{ display: 'flex', gap: 3 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 6, borderRadius: 1, background: '#150d24', border: '1px solid #241538' }} />)}
        </div>
        <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#241538', letterSpacing: '0.1em' }}>NFT HACKING DEVICE</div>
        <div style={{ display: 'flex', gap: 3 }}>
          {[0, 1].map(i => <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%,#1a2a3a,#0e0819)', border: '1px solid #241538' }} />)}
        </div>
      </div>
    </div>
  )
}

// ─── Demo Panel (inside DeviceSkeleton) ──────────────────────────────────────
function DemoPanel() {
  const [step, setStep] = useState(0)
  const [demoNum, setDemoNum] = useState<number | null>(null)
  const [localDev, setLocalDev] = useState(() => { const d = generateDevice(999); d.active = true; return d })
  const [demoWinStates, setDemoWinStates] = useState<Record<WinType, WinState>>(defaultWinStates)
  const [msgs, setMsgs] = useState<string[]>(['▶ Demo starting...'])
  const [called, setCalled] = useState<number[]>([])
  const [running, setRunning] = useState(false)

  const startDemo = () => {
    setStep(0); setDemoNum(null)
    setLocalDev(() => { const d = generateDevice(999); d.active = true; return d })
    setDemoWinStates(defaultWinStates())
    setMsgs(['▶ Demo started — watching live hack...'])
    setCalled([]); setRunning(true)
  }

  useEffect(() => {
    if (!running) return
    // Build a sequence that guarantees hitting each win: use fixed numbers that match the device grid
    // We'll just auto-draw random numbers slowly until wins trigger
    const iv = setInterval(() => {
      setStep(s => {
        if (s >= 50) { setRunning(false); clearInterval(iv); return s }
        const nextStep = s + 1
        setLocalDev(prev => {
          const allNums = prev.grid.flat().filter(c => c.num).map(c => c.num as number)
          // First 15 draws: use ticket numbers; after: random
          const pool = nextStep <= allNums.length ? allNums : Array.from({ length: 90 }, (_, i) => i + 1)
          const notCalled = pool.filter(n => !called.includes(n))
          if (!notCalled.length) { setRunning(false); clearInterval(iv); return prev }
          const num = notCalled[Math.floor(Math.random() * notCalled.length)]
          setDemoNum(num); setCalled(c => [...c, num])
          const nd = { ...prev, grid: prev.grid.map(row => row.map(c => c.num === num ? { ...c, matched: true, clicked: true } : c)) }
          const flat = nd.grid.flat()
          const nc = flat.filter(c => c.clicked).length
          setDemoWinStates(ws => {
            const nw = { ...ws }
            if (nc >= 5 && !nw.EARLY_FIVE.claimable) { nw.EARLY_FIVE = { ...nw.EARLY_FIVE, claimable: true }; setMsgs(m => [...m, '⚡ EARLY FIVE READY!']) }
            if (nd.grid[0].filter(c => c.num).every(c => c.clicked) && !nw.TOP_LINE.claimable) { nw.TOP_LINE = { ...nw.TOP_LINE, claimable: true }; setMsgs(m => [...m, '🔵 TOP LINE READY!']) }
            if (nd.grid[1].filter(c => c.num).every(c => c.clicked) && !nw.MIDDLE_LINE.claimable) { nw.MIDDLE_LINE = { ...nw.MIDDLE_LINE, claimable: true }; setMsgs(m => [...m, '🟢 MIDDLE LINE READY!']) }
            if (nd.grid[2].filter(c => c.num).every(c => c.clicked) && !nw.BOTTOM_LINE.claimable) { nw.BOTTOM_LINE = { ...nw.BOTTOM_LINE, claimable: true }; setMsgs(m => [...m, '🟡 BOTTOM LINE READY!']) }
            if (flat.filter(c => c.num).every(c => c.clicked)) {
              if (!nw.FULL_HOUSE_1.claimable) {
                nw.FULL_HOUSE_1 = { ...nw.FULL_HOUSE_1, claimable: true, claimed: false }
                setMsgs(m => [...m, '🔥 FULL HOUSE! ALL 15 MATCHED!'])
              }
              // Simulate claim → flicker
              setTimeout(() => {
                setDemoWinStates(wss => ({ ...wss, FULL_HOUSE_1: { ...wss.FULL_HOUSE_1, claimed: true, flickering: true } }))
                setMsgs(m => [...m, '✅ RANSOM CLAIMED! Others flickering...'])
                setTimeout(() => {
                  setDemoWinStates(wss => ({ ...wss, FULL_HOUSE_1: { ...wss.FULL_HOUSE_1, flickering: false, broken: true } }))
                  setMsgs(m => [...m, '💀 LED BROKEN — win no longer claimable'])
                  setRunning(false)
                }, 3000)
              }, 1200)
            }
            return nw
          })
          return nd
        })
        return nextStep
      })
    }, 700)
    return () => clearInterval(iv)
  }, [running])

  const LED_TYPES: WinType[] = ['EARLY_FIVE', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE_1']

  return (
    <div>
      {/* Mini ticket */}
      <div style={{ background: '#0a0612', border: '1px solid #150d24', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', borderBottom: '1px solid #150d24' }}>
          {COL_HEADERS.map((h, i) => <div key={i} style={{ padding: '1px 0', textAlign: 'center', fontFamily: 'DM Mono,monospace', fontSize: 5, color: '#241538', borderRight: i < 8 ? '1px solid #150d24' : 'none', background: '#070310' }}>{h}</div>)}
        </div>
        {localDev.grid.map((row, ri) => (
          <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', borderBottom: ri < 2 ? '1px solid #150d24' : 'none' }}>
            {row.map((cell, ci) => (
              <div key={ci} style={{
                height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: ci < 8 ? '1px solid #150d24' : 'none',
                background: cell.clicked ? 'rgba(255,255,255,0.1)' : 'transparent',
                fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700,
                color: !cell.num ? 'transparent' : '#fff',
                textShadow: cell.clicked ? '0 0 6px #fff,0 0 12px rgba(255,255,255,0.8)' : '0 0 2px rgba(255,255,255,0.3)',
                opacity: !cell.num ? 0 : cell.clicked ? 1 : 0.4,
                transition: 'all 0.3s'
              }}>{cell.num ?? ''}</div>
            ))}
          </div>
        ))}
      </div>

      {/* Current broadcast number + LEDs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ background: '#070310', border: '1px solid #150d24', borderRadius: 6, padding: '4px 10px', textAlign: 'center', minWidth: 50 }}>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>BROADCAST</div>
          <div style={{
            fontFamily: 'Syne,sans-serif', fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1,
            textShadow: '0 0 12px #fff,0 0 24px rgba(255,255,255,0.6)'
          }}>{demoNum ?? '—'}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', marginBottom: 4 }}>WIN STATUS</div>
          {LED_TYPES.map((type, i) => {
            const ws = demoWinStates[type]
            const color = LED_COLORS[type]
            return (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                <div style={{
                  width: 8, height: 6, borderRadius: 1, flexShrink: 0,
                  background: ws.broken ? 'transparent' : ws.claimed || ws.claimable ? color : '#150d24',
                  border: `1px solid ${ws.broken ? color + '40' : ws.claimed || ws.claimable ? color : '#1a1029'}`,
                  boxShadow: ws.broken ? 'none' : ws.claimable || ws.claimed ? `0 0 5px ${color}` : 'none',
                  animation: ws.broken ? 'none' : ws.flickering ? 'rapidFlicker 0.08s infinite' : ws.claimable && !ws.claimed ? 'ledBlink 0.5s infinite' : 'none',
                  position: 'relative', overflow: 'hidden'
                }}>
                  {ws.broken && <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle,${color}50 20%,transparent 70%)`, animation: 'filamentGlow 2s infinite' }} />}
                </div>
                <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: ws.claimed ? '#a78bfa' : ws.claimable ? color : '#2d1f4a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {WIN_LABELS[type]}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Messages */}
      <div style={{ background: '#070310', border: '1px solid #150d24', borderRadius: 5, padding: '5px 8px', maxHeight: 60, overflowY: 'auto', marginBottom: 8 }}>
        {msgs.slice(-5).map((m, i) => (
          <div key={i} style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b26bff', marginBottom: 1 }}>{m}</div>
        ))}
      </div>

      <button className="keyboard-key keyboard-key-accent" onClick={startDemo} style={{ width: '100%', background: running ? '#150d24' : 'linear-gradient(to bottom,#b26bff 0%,#7c3aed 100%)', color: running ? '#453071' : '#000', border: running ? '1px solid #241538' : 'none', borderRadius: 8, padding: '10px', fontFamily: 'DM Mono,monospace', fontSize: 10, fontWeight: 700, cursor: running ? 'default' : 'pointer' }}>
        {running ? '⏳ DEMO RUNNING...' : '▶ RUN DEMO HACK'}
      </button>
    </div>
  )
}

// ─── Rules Panel ─────────────────────────────────────────────────────────────
function RulesPanel() {
  return (
    <div style={{ background: '#070310', border: '1px solid #150d24', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b26bff', marginBottom: 8, letterSpacing: '0.1em' }}>◉ HOW TO PLAY — ROBHIN HEIST RULES</div>
      {[
        ['1', 'MINT', 'Buy NFT hacking devices (1 token each). Each device is a unique 3×9 housie ticket.'],
        ['2', 'ACTIVATE', 'Connect your devices to the live bank. Only active devices participate.'],
        ['3', 'HACK', 'Numbers are broadcast every 60-90s. Click matching numbers on your ticket during the open window.'],
        ['4', 'WIN', 'Hit 5 numbers for Early Five, complete a row for Line wins, all 15 for Full House.'],
        ['5', 'RANSOM', 'Press RANSOM when your win is ready. Multiple claimers in the same round split the prize equally.'],
        ['6', 'FLICKER', 'After a win is claimed, all other devices see rapid LED flicker for 60s, then a broken LED — win is gone.'],
        ['7', 'BANK HACK', 'When all 90 numbers are drawn, unclaimed winnings go to the treasury wallet. Game resets.'],
      ].map(([n, title, desc]) => (
        <div key={n} style={{ display: 'flex', gap: 8, marginBottom: 7, alignItems: 'flex-start' }}>
          <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#150d24', border: '1px solid #b26bff40', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
            <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b26bff', fontWeight: 700 }}>{n}</span>
          </div>
          <div>
            <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#a99bc4', fontWeight: 700, marginBottom: 1 }}>{title}</div>
            <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#453071', lineHeight: 1.5 }}>{desc}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Mint Panel (inside device skeleton) ─────────────────────────────────────
function MintPanel({ wallet, devices, mintCount, mintToken, setMintCount, setMintToken, onMint, onEnterGame, onConnectWallet }: {
  wallet: string | null; devices: Device[]; mintCount: number; mintToken: string;
  setMintCount: (n: number) => void; setMintToken: (t: string) => void;
  onMint: () => void; onEnterGame: () => void; onConnectWallet: () => void
}) {
  const [tab, setTab] = useState<'mint' | 'demo' | 'rules'>('mint')
  const btnBase: React.CSSProperties = { fontFamily: 'DM Mono,monospace', fontSize: 11, cursor: 'pointer', borderRadius: 8, padding: '8px 14px', fontWeight: 600, border: 'none' }
  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {([['mint', '◈ MINT'], ['demo', '▶ DEMO'], ['rules', 'ⓘ RULES']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            ...btnBase, flex: 1, padding: '9px 6px', fontSize: 9,
            background: tab === k ? '#0a2a4a' : 'transparent',
            color: tab === k ? '#b26bff' : '#453071',
            border: `1px solid ${tab === k ? '#b26bff40' : '#150d24'}`
          }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'demo' && <DemoPanel />}
      {tab === 'rules' && <RulesPanel />}

      {tab === 'mint' && (
        <div>
          {!wallet ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '20px 0' }}>
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', textAlign: 'center', lineHeight: 1.7 }}>Connect your wallet to mint<br />NFT hacking devices</div>
              <button className="keyboard-key keyboard-key-accent" onClick={onConnectWallet} style={{ ...btnBase, padding: '14px 28px', fontSize: 12, fontWeight: 700, borderRadius: 10, boxShadow: '0 4px 20px rgba(178,107,255,0.3)' }}>CONNECT WALLET →</button>
            </div>
          ) : (
            <>
              {/* Price display */}
              <div style={{ background: 'linear-gradient(90deg,rgba(178,107,255,0.06),transparent)', border: '1px solid rgba(178,107,255,0.12)', borderRadius: 6, padding: '7px 10px', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>PRICE PER DEVICE</span>
                  <span style={{ fontFamily: 'Syne,sans-serif', fontSize: 16, fontWeight: 800, color: '#b26bff', textShadow: '0 0 8px rgba(178,107,255,0.4)' }}>${DEVICE_PRICE_USDC.toFixed(2)}<span style={{ fontSize: 9, fontWeight: 400, color: '#a99bc4', marginLeft: 3 }}>USD</span></span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>ANY COIN: ETH · USDG · USDC · USDT · X<span style={{ color: '#453071' }}> | </span>1000 X LOCK 50% OFF</span>
                  <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#f59e0b' }}>1 HEIST = live from /api/session-state</span>
                </div>
              </div>
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#453071', marginBottom: 6 }}>SELECT TOKEN</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 6, marginBottom: 12 }}>
                {['ETH', 'USDG', 'USDC', 'USDT', 'X'].map(t => (
                  <button key={t} onClick={() => setMintToken(t)} style={{
                    ...btnBase, padding: '10px 6px', fontSize: 10,
                    background: mintToken === t ? '#2e1065' : 'transparent',
                    color: mintToken === t ? '#b26bff' : '#453071',
                    border: `1px solid ${mintToken === t ? '#b26bff40' : '#150d24'}`
                  }}>{t}</button>
                ))}
              </div>
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#453071', marginBottom: 6 }}>QUANTITY</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
                {[1, 3, 5, 10].map(n => (
                  <button key={n} onClick={() => setMintCount(n)} style={{
                    ...btnBase, padding: '10px 6px', fontSize: 12,
                    background: mintCount === n ? '#2e1065' : 'transparent',
                    color: mintCount === n ? '#b26bff' : '#453071',
                    border: `1px solid ${mintCount === n ? '#b26bff40' : '#150d24'}`
                  }}>{n}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <input type="number" value={mintCount} onChange={e => setMintCount(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{ flex: 1, background: '#150d24', border: '1px solid #150d24', borderRadius: 8, padding: '10px 12px', fontFamily: 'DM Mono,monospace', fontSize: 12, color: '#b26bff', outline: 'none' }} />
                <button className="keyboard-key keyboard-key-accent" onClick={onMint} style={{ ...btnBase, padding: '12px 20px', fontSize: 12, fontWeight: 700, borderRadius: 10, boxShadow: '0 0 16px rgba(178,107,255,0.3)', whiteSpace: 'nowrap' }}>MINT →</button>
              </div>
              {devices.length > 0 && (
                <div style={{ background: 'rgba(178,107,255,0.04)', border: '1px solid rgba(178,107,255,0.12)', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
                  <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b26bff', marginBottom: 4 }}>YOUR DEVICES ({devices.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {devices.slice(0, 6).map(d => (
                      <div key={d.id} style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: d.active ? '#a78bfa' : '#2d1f4a', background: '#150d24', border: `1px solid ${d.active ? '#a78bfa30' : '#150d24'}`, borderRadius: 4, padding: '2px 6px' }}>{d.nftId}</div>
                    ))}
                    {devices.length > 6 && <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>+{devices.length - 6}</div>}
                  </div>
                </div>
              )}
              {/* Initiate hack button inside mint panel */}
              {devices.length > 0 && (
                <button onClick={onEnterGame} style={{ ...btnBase, width: '100%', background: 'linear-gradient(135deg,#ff5c8a,#be185d)', color: '#fff', padding: '14px', fontSize: 13, fontWeight: 800, borderRadius: 10, boxShadow: '0 4px 24px rgba(255,92,138,0.4)', letterSpacing: '0.05em' }}>
                  🔴 INITIATE HACK — {devices.length} DEVICE{devices.length > 1 ? 'S' : ''} READY
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── LED with progress bar ────────────────────────────────────────────────────
function LedProgress({ type, ws, devices }: { type: WinType; ws: WinState; devices: Device[] }) {
  const color = LED_COLORS[type]
  let prog = 0
  devices.filter(d => d.active).forEach(d => {
    const flat = d.grid.flat(), nc = flat.filter(c => c.clicked).length
    let p = 0
    if (type === 'EARLY_FIVE') p = Math.min(nc / 5, 1)
    else if (type === 'TOP_LINE') p = d.grid[0].filter(c => c.num && c.clicked).length / Math.max(d.grid[0].filter(c => c.num).length, 1)
    else if (type === 'MIDDLE_LINE') p = d.grid[1].filter(c => c.num && c.clicked).length / Math.max(d.grid[1].filter(c => c.num).length, 1)
    else if (type === 'BOTTOM_LINE') p = d.grid[2].filter(c => c.num && c.clicked).length / Math.max(d.grid[2].filter(c => c.num).length, 1)
    else p = Math.min(nc / 15, 1)
    if (p > prog) prog = p
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
      <div style={{
        width: 10, height: 8, borderRadius: 2, flexShrink: 0, position: 'relative', overflow: 'hidden',
        background: ws.broken ? 'transparent' : ws.claimed || ws.claimable ? color : '#150d24',
        border: `1px solid ${ws.broken ? color + '30' : ws.claimed || ws.claimable ? color : '#1a1029'}`,
        boxShadow: ws.broken ? 'none' : ws.claimable || ws.claimed ? `0 0 5px ${color},0 0 10px ${color}60` : 'none',
        animation: ws.broken ? 'none' : ws.flickering ? 'rapidFlicker 0.08s infinite' : ws.claimable && !ws.claimed ? 'ledBlink 0.5s infinite' : 'none',
      }}>
        {ws.broken && <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle,${color}50 20%,transparent 70%)`, animation: 'filamentGlow 2s infinite' }} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: ws.claimed ? '#a78bfa' : ws.claimable ? color : ws.broken ? color + '60' : '#453071', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{WIN_LABELS[type]}</span>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>{Math.round(prog * 100)}%</span>
        </div>
        <div style={{ height: 3, background: '#150d24', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${prog * 100}%`, background: prog >= 1 ? color : `linear-gradient(90deg,${color}60,${color})`, borderRadius: 2, boxShadow: prog >= 1 ? `0 0 5px ${color}` : 'none', transition: 'width 0.4s ease' }} />
        </div>
      </div>
    </div>
  )
}

// ─── Hacking Device ───────────────────────────────────────────────────────────
function HackingDevice({ device, currentNum, clickWindowOpen, calledNums, onCellClick, onClaim, onActivate, winStates, bankruptCount, timer, totalTimer, liveBank, onOpenVault }: {
  device: Device; currentNum: number | null; clickWindowOpen: boolean; calledNums: Set<number>;
  onCellClick: (id: number, r: number, c: number) => void; onClaim: (id: number, w: WinType) => void;
  onActivate: (id: number) => void; winStates: Record<WinType, WinState>; bankruptCount: number;
  timer: number; totalTimer: number; liveBank: number; onOpenVault?: () => void
}) {
  const flat = device.grid.flat()
  const nc = flat.filter(c => c.clicked).length
  const r0 = device.grid[0].filter(c => c.num).every(c => c.clicked)
  const r1 = device.grid[1].filter(c => c.num).every(c => c.clicked)
  const r2 = device.grid[2].filter(c => c.num).every(c => c.clicked)
  const all = flat.filter(c => c.num).every(c => c.clicked)
  const fhk = `FULL_HOUSE_${Math.min(bankruptCount + 1, 3)}` as WinType
  const canClaim = (
    (nc >= 5 && !device.claimed.has('EARLY_FIVE') && winStates.EARLY_FIVE.claimable && !winStates.EARLY_FIVE.claimed) ||
    (r0 && !device.claimed.has('TOP_LINE') && winStates.TOP_LINE.claimable && !winStates.TOP_LINE.claimed) ||
    (r1 && !device.claimed.has('MIDDLE_LINE') && winStates.MIDDLE_LINE.claimable && !winStates.MIDDLE_LINE.claimed) ||
    (r2 && !device.claimed.has('BOTTOM_LINE') && winStates.BOTTOM_LINE.claimable && !winStates.BOTTOM_LINE.claimed) ||
    (all && winStates[fhk]?.claimable && !winStates[fhk]?.claimed && !device.claimed.has(fhk))
  )
  const doClaim = () => {
    if (nc >= 5 && !device.claimed.has('EARLY_FIVE') && winStates.EARLY_FIVE.claimable && !winStates.EARLY_FIVE.claimed) { onClaim(device.id, 'EARLY_FIVE'); return }
    if (r0 && !device.claimed.has('TOP_LINE') && winStates.TOP_LINE.claimable && !winStates.TOP_LINE.claimed) { onClaim(device.id, 'TOP_LINE'); return }
    if (r1 && !device.claimed.has('MIDDLE_LINE') && winStates.MIDDLE_LINE.claimable && !winStates.MIDDLE_LINE.claimed) { onClaim(device.id, 'MIDDLE_LINE'); return }
    if (r2 && !device.claimed.has('BOTTOM_LINE') && winStates.BOTTOM_LINE.claimable && !winStates.BOTTOM_LINE.claimed) { onClaim(device.id, 'BOTTOM_LINE'); return }
    if (all && winStates[fhk]?.claimable) onClaim(device.id, fhk)
  }
  const LED_TYPES: WinType[] = ['EARLY_FIVE', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE_1', 'FULL_HOUSE_2', 'FULL_HOUSE_3']
  // Proximity glow: compute best % toward each win condition for this device
  const ef5p = Math.min(nc / 5, 1)
  const t0p = device.grid[0].filter(c => c.num && c.clicked).length / Math.max(device.grid[0].filter(c => c.num).length, 1)
  const m1p = device.grid[1].filter(c => c.num && c.clicked).length / Math.max(device.grid[1].filter(c => c.num).length, 1)
  const b2p = device.grid[2].filter(c => c.num && c.clicked).length / Math.max(device.grid[2].filter(c => c.num).length, 1)
  const fhp = Math.min(nc / 15, 1)
  const bestPct = Math.max(ef5p, t0p, m1p, b2p, fhp)
  // Glow intensity proportional to proximity; pulses when >80%
  const glowR = Math.round(bestPct * 255), glowG = Math.round((1 - bestPct) * 120)
  const proxColor = canClaim ? '#ec4899' : `rgb(${glowR},${glowG},${Math.round(40 + bestPct * 60)})`
  const proxGlow = bestPct > 0.4 ? `0 0 ${Math.round(bestPct * 18)}px ${proxColor}40,0 0 ${Math.round(bestPct * 8)}px ${proxColor}20` : 'none'
  return (
    <div style={{
      background: 'linear-gradient(180deg,#1a1029,#0b0614)', border: `2px solid ${canClaim ? '#ec4899' : bestPct > 0.5 ? proxColor : device.active ? '#b26bff30' : '#1a1029'}`, borderRadius: 14, padding: 0,
      boxShadow: canClaim ? `0 0 0 2px rgba(236,72,153,0.3),0 6px 24px rgba(236,72,153,0.15)` : bestPct > 0.4 ? proxGlow : device.active ? '0 0 10px rgba(178,107,255,0.06)' : 'none',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', userSelect: 'none'
    }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(90deg,#150d24,#1a1029)', padding: '4px 7px', borderBottom: '1px solid #1a1029', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 11, height: 11, background: 'linear-gradient(to bottom,#b26bff 0%,#7c3aed 100%)', clipPath: 'polygon(50% 0%,100% 50%,50% 100%,0% 50%)', flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700, color: '#b26bff' }}>{device.nftId}</span>
            {device.walletAddr && <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 5, color: '#150d24', letterSpacing: '0.03em' }}>⛓ {device.walletAddr.slice(0, 10)}…</span>}
          </div>
        </div>
        <div style={{ flex: 1, height: 14, background: 'rgba(178,107,255,0.03)', border: '1px dashed #150d24', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 3px' }}>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 5, color: '#150d24' }}>AD</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>{nc}/15</span>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: device.active ? '#a78bfa' : '#241538', animation: device.active ? 'dot 1.5s infinite' : 'none' }} />
        </div>
      </div>
      {/* Mini bank / activate */}
      {device.active ? (
        <div style={{ background: '#070310', margin: '3px 5px 0', borderRadius: 5, border: '1px solid #150d24', padding: '2px 5px', display: 'flex', alignItems: 'center', gap: 4, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px)', pointerEvents: 'none' }} />
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 5, color: '#2d1f4a', zIndex: 1 }}>BANK</span>
          <span style={{ fontFamily: 'Syne,sans-serif', fontSize: 16, fontWeight: 800, color: '#fff', lineHeight: 1, zIndex: 1, textShadow: currentNum ? '0 0 8px #fff' : 'none' }}>{currentNum ?? '—'}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <div style={{ width: 3, height: 3, borderRadius: '50%', background: clickWindowOpen ? '#a78bfa' : '#ff5c8a', animation: clickWindowOpen ? 'dot 1s infinite' : 'none' }} />
              <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 5, color: clickWindowOpen ? '#a78bfa' : '#ff5c8a' }}>{clickWindowOpen ? 'OPEN' : 'CLOSED'}</span>
            </div>
            <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 5, color: '#2d1f4a' }}>{BANKS[liveBank]?.name?.split(' ')[0] ?? ''}</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, zIndex: 1 }}>
            {Array.from(calledNums).slice(-3).reverse().map((n, i) => (
              <div key={i} style={{ width: 12, height: 12, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#150d24', border: '1px solid #241538', fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#453071', opacity: 1 - i * 0.25 }}>{n}</div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ margin: '3px 5px 0', background: '#070310', border: '1px solid #150d24', borderRadius: 5, padding: '4px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>Disconnected</span>
          <button className="keyboard-key keyboard-key-accent" onClick={() => onActivate(device.id)} style={{ borderRadius: 4, padding: '3px 7px', fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700, cursor: 'pointer' }}>ACTIVATE</button>
        </div>
      )}
      {/* Grid */}
      <div style={{ margin: '3px 5px 0', background: '#0a0612', border: '1px solid #150d24', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', borderBottom: '1px solid #150d24' }}>
          {COL_HEADERS.map((h, i) => <div key={i} style={{ padding: '1px 0', textAlign: 'center', fontFamily: 'DM Mono,monospace', fontSize: 4.5, color: '#241538', borderRight: i < 8 ? '1px solid #150d24' : 'none', background: '#070310' }}>{h}</div>)}
        </div>
        {device.grid.map((row, ri) => (
          <div key={ri} style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', borderBottom: ri < 2 ? '1px solid #150d24' : 'none' }}>
            {row.map((cell, ci) => {
              const isMissed = cell.matched && !cell.clicked && cell.missed
              const isCur = cell.num !== null && cell.num === currentNum
              const isClick = isCur && clickWindowOpen && !cell.clicked && device.active
              const isEmpty = cell.num === null
              const glitch = `gx${(ri * 9 + ci) % 3} ${2 + ((ri * 9 + ci) % 2)}s ${(ri * 9 + ci) * 0.08}s infinite`
              return (
                <button key={ci} onClick={() => isClick && onCellClick(device.id, ri, ci)} style={{
                  height: 20, padding: 0, cursor: isClick ? 'pointer' : 'default', border: 'none',
                  borderRight: ci < 8 ? '1px solid #150d24' : 'none',
                  background: isEmpty ? '#0a0612' : cell.clicked ? 'rgba(255,255,255,0.08)' : isClick ? 'rgba(255,255,255,0.05)' : 'transparent',
                  boxShadow: isClick ? 'inset 0 0 0 1.5px rgba(255,255,255,0.9)' : 'none',
                  color: '#ffffff', fontFamily: 'DM Mono,monospace', fontSize: 9, fontWeight: 700,
                  textShadow: isEmpty ? 'none' : cell.clicked ? '0 0 6px #fff,0 0 12px rgba(255,255,255,0.8)' : isClick ? '0 0 10px #fff' : '0 0 2px rgba(255,255,255,0.35)',
                  opacity: isEmpty ? 0 : cell.clicked ? 1 : isClick ? 1 : 0.45,
                  animation: (!isEmpty && !isClick && !cell.clicked) ? glitch : 'none',
                  transition: 'opacity 0.2s',
                }}>{cell.num ?? ''}</button>
              )
            })}
          </div>
        ))}
      </div>
      {/* LED strip */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 3, padding: '3px 5px 1px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 2 }}>{[0, 1].map(i => <div key={i} style={{ width: 6, height: 5, borderRadius: 1, background: '#150d24', border: '1px solid #1a1029' }} />)}</div>
        {LED_TYPES.map((type, i) => {
          const ws = winStates[type], won = device.claimed.has(type), lit = ws.claimable && !ws.claimed
          // dead = win claimed by others and filament phase started — NOT during flicker window
          const dead = ws.claimed && !won && ws.broken
          // Compute this LED's individual proximity
          let ledPct = 0
          if (type === 'EARLY_FIVE') ledPct = ef5p
          else if (type === 'TOP_LINE') ledPct = t0p
          else if (type === 'MIDDLE_LINE') ledPct = m1p
          else if (type === 'BOTTOM_LINE') ledPct = b2p
          else ledPct = fhp
          const proximityGlow = !ws.claimed && !ws.broken && !lit && ledPct > 0.3 ? `0 0 ${Math.round(ledPct * 8)}px ${LED_COLORS[type]}${Math.round(ledPct * 80).toString(16).padStart(2, '0')}` : 'none'
          const dimOpacity = (!lit && !won && !ws.broken) ? (0.1 + ledPct * 0.5) : 1
          return (
            <div key={type} title={WIN_LABELS[type]} style={{
              width: 9, height: 7, borderRadius: 2, position: 'relative', overflow: 'hidden',
              background: ws.broken ? 'transparent' : won && ws.bursting ? LED_COLORS[type] : (won || lit) ? LED_COLORS[type] : dead ? '#0e0819' : ledPct > 0.3 ? `${LED_COLORS[type]}${Math.round(ledPct * 60).toString(16).padStart(2, '0')}` : '#150d24',
              border: `1px solid ${ws.broken ? LED_COLORS[type] + '90' : (won || lit) || ws.bursting ? LED_COLORS[type] : ledPct > 0.3 ? LED_COLORS[type] + '60' : '#1a1029'}`,
              boxShadow: ws.broken ? `0 0 8px ${LED_COLORS[type]},0 0 20px ${LED_COLORS[type]}80,0 0 40px ${LED_COLORS[type]}40` : won && ws.bursting ? `0 0 12px ${LED_COLORS[type]},0 0 30px ${LED_COLORS[type]}80` : (won || lit) && !ws.broken ? `0 0 4px ${LED_COLORS[type]},0 0 8px ${LED_COLORS[type]}60` : proximityGlow,
              opacity: dead ? 0.15 : dimOpacity,
              animation: ws.broken ? 'filamentGlow 1.5s ease-in-out infinite' : won && ws.bursting ? 'ledBurst 0.4s ease-out forwards' : ws.expired ? 'ledExpire 0.4s ease forwards' : ws.flickering ? 'rapidFlicker 0.08s infinite' : lit && !won ? `ledBlink 0.6s ${i * 0.07}s infinite` : 'none',
            }}>
              {ws.broken && !type.startsWith('FULL_HOUSE') && (
                <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle,${LED_COLORS[type]}ff 0%,${LED_COLORS[type]}99 30%,transparent 75%)`, animation: 'filamentGlow 1.5s ease-in-out infinite' }} />
              )}
              {ws.broken && type === 'FULL_HOUSE_1' && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700, color: LED_COLORS[type], textShadow: `0 0 4px ${LED_COLORS[type]}` }}>1</div>}
              {ws.broken && type === 'FULL_HOUSE_2' && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700, color: LED_COLORS[type], textShadow: `0 0 4px ${LED_COLORS[type]}` }}>2</div>}
              {ws.broken && type === 'FULL_HOUSE_3' && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700, color: LED_COLORS[type], textShadow: `0 0 4px ${LED_COLORS[type]}` }}>3</div>}
              {won && ws.bursting && <div style={{ position: 'absolute', inset: -8, borderRadius: '50%', background: `radial-gradient(circle,${LED_COLORS[type]}99 0%,transparent 70%)`, animation: 'burstRing 0.5s ease-out forwards', pointerEvents: 'none' }} />}
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 2 }}>{[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 5, borderRadius: 1, background: '#150d24', border: '1px solid #1a1029' }} />)}</div>
      </div>
      {/* Bottom bar */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'center', padding: '2px 5px 5px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ width: 7, height: 7, borderRadius: 2, background: '#ff5c8a', boxShadow: '0 0 4px #ff5c8a' }} />
          <div style={{ width: 7, height: 7, borderRadius: 2, background: '#f97316', boxShadow: '0 0 4px #f97316' }} />
          <div style={{ width: 7, height: 7, borderRadius: 2, background: device.active ? '#a78bfa' : '#150d24', border: device.active ? 'none' : '1px solid #1a1029' }} />
        </div>
        <MiniStopwatch seconds={timer} total={totalTimer} />
        <div style={{ position: 'relative', flex: 1, display: 'flex', margin: '0 2px' }}>
          <button onClick={doClaim} disabled={!canClaim} style={{
            flex: 1, width: '100%',
            background: canClaim ? 'linear-gradient(180deg,#1a0000,#0d0000)' : bestPct > 0.5 ? `linear-gradient(180deg,rgba(${glowR},${glowG},20,0.15),rgba(${glowR},${glowG},20,0.05))` : 'linear-gradient(180deg,#080f18,#040a10)',
            border: `2px solid ${canClaim ? '#ff5c8a' : bestPct > 0.5 ? proxColor : '#1a1029'}`, borderRadius: 7,
            padding: '8px 4px', cursor: canClaim ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: canClaim ? 'ransomPulse 1s infinite' : bestPct > 0.8 ? 'ransomPulse 2s infinite' : 'none',
            boxShadow: canClaim ? 'inset 0 0 10px rgba(255,32,32,0.3),0 0 10px rgba(255,32,32,0.4)' : bestPct > 0.5 ? `inset 0 0 ${Math.round(bestPct * 8)}px ${proxColor}30,0 0 ${Math.round(bestPct * 10)}px ${proxColor}30` : 'none',
            margin: '0 2px',
          }}>
            <span style={{
              fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.1em',
              color: canClaim ? '#ff4040' : bestPct > 0.6 ? proxColor : '#241538',
              textShadow: canClaim ? '0 0 8px #ff5c8a,0 0 20px #ff5c8a80' : bestPct > 0.6 ? `0 0 6px ${proxColor}` : 'none'
            }}>RANSOM</span>
          </button>
          {onOpenVault && (
            <button onClick={(e) => { e.stopPropagation(); onOpenVault() }} title="⚿ CLAIM FROM DECENTERILZIED VAULT — anytime before the next round" style={{
              position: 'absolute', top: 1, right: 1, width: 16, height: 16, borderRadius: 3, padding: 0, zIndex: 3,
              background: 'rgba(255,209,102,0.12)', border: '1px solid rgba(255,209,102,0.5)',
              color: '#ffd166', fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>⚿</button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {[0, 1].map(i => <div key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%,#33205e,#0e0819)', border: '1.5px solid #241538' }} />)}
        </div>
      </div>
    </div>
  )
}

// ─── Vault SVG Sketch ────────────────────────────────────────────────────────
// ─── Vault SVG — proper bank vault with door, money stacks, fill level ────────
function VaultSketch({ pct, paid }: { pct: number; paid: number }) {
  const maxStack = 7
  const stacks = Math.floor(pct * maxStack)
  const fillY = Math.max(78 - Math.round(pct * 52), 26) // liquid rises from y=78 up to y=26
  return (
    <svg viewBox="0 0 120 110" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      {/* ── Vault room walls ── */}
      <rect x="6" y="18" width="108" height="80" rx="3" fill="#0a0612" stroke="#1f1330" strokeWidth="1.5" />
      {/* Floor */}
      <line x1="6" y1="96" x2="114" y2="96" stroke="#1f1330" strokeWidth="1" />

      {/* ── Money fill liquid ── */}
      <clipPath id="roomClip"><rect x="7" y="19" width="106" height="76" rx="2" /></clipPath>
      <rect x="7" y={fillY} width="106" height={98 - fillY} fill="rgba(178,107,255,0.07)" clipPath="url(#roomClip)" style={{ transition: 'all 1.4s cubic-bezier(.4,0,.2,1)' }} />
      {pct > 0 && <ellipse cx="60" cy={fillY} rx="53" ry="2.5" fill="rgba(178,107,255,0.25)" style={{ transition: 'cy 1.4s cubic-bezier(.4,0,.2,1)' }} />}

      {/* ── Money stacks on floor ── */}
      {Array.from({ length: stacks }, (_, i) => {
        const sx = 14 + i * 14, sy = 88
        const col = i % 3 === 0 ? '#a78bfa' : i % 3 === 1 ? '#16a34a' : '#15803d'
        return (
          <g key={i}>
            <rect x={sx} y={sy - 10} width="10" height="10" rx="1" fill={col} opacity="0.85" />
            <line x1={sx} y1={sy - 7} x2={sx + 10} y2={sy - 7} stroke="#0a0612" strokeWidth="0.7" opacity="0.6" />
            <line x1={sx} y1={sy - 4} x2={sx + 10} y2={sy - 4} stroke="#0a0612" strokeWidth="0.7" opacity="0.6" />
            <text x={sx + 5} y={sy - 2} textAnchor="middle" fontSize="3.5" fill="#0a0612" fontWeight="bold">$</text>
          </g>
        )
      })}

      {/* ── Vault door frame ── */}
      <rect x="30" y="20" width="60" height="74" rx="4" fill="#0f0a1c" stroke="#2d1f4a" strokeWidth="2" />
      {/* Door inner bevel */}
      <rect x="34" y="24" width="52" height="66" rx="3" fill="none" stroke="#0a2a45" strokeWidth="1" />

      {/* ── Door fill (claimed portion = door cracking open) ── */}
      {pct > 0 && (
        <rect x="30" y="20" width={Math.round(pct * 60)} height="74" rx="4"
          fill="rgba(178,107,255,0.04)" style={{ transition: 'width 1.4s ease' }} />
      )}

      {/* ── Locking bolts — 3 right side ── */}
      {[30, 52, 74].map((y, i) => (
        <g key={i}>
          <rect x="82" y={y} width="10" height="8" rx="2" fill="#170f2b" stroke="#2d1f4a" strokeWidth="1" />
          <rect x="86" y={y + 2} width="6" height="4" rx="1" fill={pct > 0.3 ? '#b26bff60' : '#0f0a1c'}
            style={{ transition: 'fill 0.5s ease' }} />
        </g>
      ))}

      {/* ── Central dial ── */}
      <circle cx="60" cy="57" r="18" fill="#060f1c" stroke="#2d1f4a" strokeWidth="1.5" />
      <circle cx="60" cy="57" r="13" fill="none" stroke="#150d24" strokeWidth="1" />
      {/* Dial notches */}
      {Array.from({ length: 12 }, (_, i) => {
        const a = i * 30 * Math.PI / 180, r1 = 13, r2 = 16
        return <line key={i} x1={60 + r1 * Math.sin(a)} y1={57 - r1 * Math.cos(a)} x2={60 + r2 * Math.sin(a)} y2={57 - r2 * Math.cos(a)} stroke="#2d1f4a" strokeWidth="0.8" />
      })}
      {/* Dial pointer — rotates with pct */}
      <line x1="60" y1="57"
        x2={60 + 10 * Math.sin(pct * 6.28)} y2={57 - 10 * Math.cos(pct * 6.28)}
        stroke="#b26bff" strokeWidth="1.5" strokeLinecap="round"
        style={{ transition: 'all 1.4s ease' }} />
      <circle cx="60" cy="57" r="2.5" fill="#2d1f4a" />
      {/* Center jewel */}
      <circle cx="60" cy="57" r="1.2" fill={pct > 0 ? '#b26bff' : '#150d24'} style={{ transition: 'fill 0.5s ease' }} />

      {/* ── Handle ── */}
      <rect x="74" y="54" width="12" height="6" rx="3" fill="#170f2b" stroke="#2d1f4a" strokeWidth="1" />
      <circle cx="86" cy="57" r="3" fill="#170f2b" stroke="#2d1f4a" strokeWidth="1" />

      {/* ── Hinges left side ── */}
      {[28, 68].map((y, i) => (
        <g key={i}>
          <rect x="26" y={y} width="6" height="12" rx="2" fill="#0f0a1c" stroke="#2d1f4a" strokeWidth="1" />
          <line x1="26" y1={y + 6} x2="32" y2={y + 6} stroke="#2d1f4a" strokeWidth="0.5" />
        </g>
      ))}

      {/* ── Amount label ── */}
      <text x="60" y="105" textAnchor="middle" fontSize="7" fill="#b26bff" fontWeight="700"
        fontFamily='DM Mono,monospace'>${(paid / 1000).toFixed(0)}K CLAIMED</text>
    </svg>
  )
}

// ─── HEIST Sparkline Chart ────────────────────────────────────────────────────
function HeistChart({ prices, trend, live, contractAddr }: { prices: number[]; trend: boolean; live: number; contractAddr: string }) {
  const W = 140, H = 54
  const min = Math.min(...prices), max = Math.max(...prices), range = Math.max(max - min, 0.001)
  const pts = prices.map((p, i) => `${(i / Math.max(prices.length - 1, 1)) * W},${H - 4 - (((p - min) / range) * (H - 10))}`).join(' ')
  const lx = (prices.length - 1) / Math.max(prices.length - 1, 1) * W
  const ly = H - 4 - (((prices[prices.length - 1] - min) / range) * (H - 10))
  const col = trend ? '#a78bfa' : '#ff5c8a'
  if (!contractAddr) return (
    <div style={{
      height: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: '#0a0612', border: '1px dashed #150d24', borderRadius: 6, gap: 4
    }}>
      <div style={{ fontSize: 16 }}>📈</div>
      <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#150d24', textAlign: 'center', lineHeight: 1.4 }}>enter contract addr{'\n'}to show live chart</span>
    </div>
  )
  return (
    <div style={{ background: '#0a0612', border: '1px solid #150d24', borderRadius: 6, padding: '4px 6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>HEIST/USDT</span>
        <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700, color: col }}>{trend ? '▲' : '▼'} ${live.toFixed(4)}</span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.25" />
            <stop offset="100%" stopColor={col} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} stroke="#150d24" strokeWidth="0.5" />
        ))}
        {prices.length > 1 && <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#cg)" />}
        {prices.length > 1 && <polyline points={pts} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" />}
        <circle cx={lx} cy={ly} r="2.5" fill={col} />
        <circle cx={lx} cy={ly} r="4" fill="none" stroke={col} strokeWidth="0.8" opacity="0.5">
          <animate attributeName="r" values="3;6;3" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  )
}

// ─── Winners Typewriter Terminal ───────────────────────────────────────────────
function WinnersTerminal({ winRecords }: { winRecords: WinRecord[] }) {
  const [lines, setLines] = useState<{ text: string; col: string }[]>([])
  const [cursor, setCursor] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLen = useRef(0)

  useEffect(() => {
    if (winRecords.length <= prevLen.current) return
    const rec = winRecords[winRecords.length - 1]
    prevLen.current = winRecords.length
    const cols = ['#b26bff', '#f59e0b', '#c084fc', '#a855f7', '#ec4899']
    const col = cols[(winRecords.length - 1) % cols.length]
    const full = `> ${WIN_LABELS[rec.wt]} · ${rec.claimers.join('+')} · ${rec.heistEach ?? 0} HEIST each`
    let i = 0
    setLines(p => [...p, { text: '', col }])
    const iv = setInterval(() => {
      i++
      setLines(p => { const n = [...p]; n[n.length - 1] = { text: full.slice(0, i), col }; return n })
      if (i >= full.length) clearInterval(iv)
    }, 14)
    return () => clearInterval(iv)
  }, [winRecords])

  useEffect(() => { const t = setInterval(() => setCursor(b => !b), 530); return () => clearInterval(t) }, [])
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }, [lines])

  return (
    <div ref={scrollRef} style={{ overflowY: 'auto', maxHeight: 72, fontFamily: 'DM Mono,monospace', fontSize: 8, lineHeight: 1.7 }}>
      {lines.length === 0 ? (
        <span style={{ color: '#150d24' }}>awaiting claim<span style={{ opacity: cursor ? 1 : 0, color: '#2d1f4a' }}>_</span></span>
      ) : lines.map((l, i) => (
        <div key={i} style={{ color: l.col, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {l.text}{i === lines.length - 1 && <span style={{ opacity: cursor ? 1 : 0 }}>_</span>}
        </div>
      ))}
    </div>
  )
}

// ─── Hack Matrix Display (bisected vertically) ────────────────────────────────
function HackMatrixDisplay({ calledNums, calledOrder, clickWindowOpen, preGameSecs, winRecords, liveBank, contractAddr, timer, totalTimer, deviceCount, vaultTotal, heistRateUsd }: {
  calledNums: Set<number>; calledOrder: number[]; clickWindowOpen: boolean; preGameSecs: number; winRecords: WinRecord[]; liveBank: number; contractAddr: string; timer: number; totalTimer: number; deviceCount: number; vaultTotal: number; heistRateUsd?: number
}) {
  const [glitching, setGlitching] = useState(false)
  const [bgCmds, setBgCmds] = useState<{ cmd: string; x: number; y: number; op: number; st: string; col: string }[]>([])
  const [prices, setPrices] = useState<number[]>([0.12, 0.14, 0.11, 0.16, 0.18, 0.15, 0.20, 0.22, 0.19, 0.24, 0.21, 0.26])
  const [live, setLive] = useState(0.26)
  const lastNum = calledOrder[calledOrder.length - 1] ?? null
  const prev5 = calledOrder.slice(-6, -1).reverse()
  const prevRef = useRef<number | null>(null)
  const neonCols = ['#b26bff', '#c084fc', '#ff5c8a', '#f59e0b', '#a855f7']
  const drawn = calledNums.size
  const pct = Math.round((drawn / 90) * 100)
  const paid = winRecords.reduce((s, r) => s + r.split * r.claimers.length, 0)
  const vaultPct = Math.min(vaultTotal > 0 ? paid / vaultTotal : 0, 1)
  const trend = prices[prices.length - 1] >= prices[0]
  // HEIST calculations
  // Convert vault MIST → SUI → USD → HEIST
  const vaultHeist = Math.max(0, Math.floor(vaultTotal / 1e9)) // vault holds raw HEIST (v4)
  const totalPaidHeist = paid

  useEffect(() => {
    if (lastNum !== null && lastNum !== prevRef.current) {
      prevRef.current = lastNum
      setGlitching(true)
      setTimeout(() => setGlitching(false), 600)
    }
  }, [lastNum])

  useEffect(() => {
    const t = setInterval(() => {
      setBgCmds(p => [...p.slice(-16), {
        cmd: HACK_CMDS[Math.floor(Math.random() * HACK_CMDS.length)],
        x: 3 + Math.random() * 90, y: 5 + Math.random() * 85,
        op: 0.015,
        st: HACK_STATUSES[Math.floor(Math.random() * HACK_STATUSES.length)],
        col: neonCols[Math.floor(Math.random() * neonCols.length)],
      }])
    }, 260)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!contractAddr) return
    const t = setInterval(() => {
      const delta = (Math.random() - 0.47) * 0.012
      setLive(p => { const n = Math.max(0.001, +(p + delta).toFixed(4)); setPrices(pp => [...pp.slice(-28), n]); return n })
    }, 1800)
    return () => clearInterval(t)
  }, [contractAddr])

  return (
    <div style={{ background: '#0e0819', border: '2px solid #2e1065', borderRadius: 14, overflow: 'hidden', display: 'flex', position: 'relative', minHeight: 360 }}>
      {/* Scanlines */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.1) 2px,rgba(0,0,0,0.1) 4px)', pointerEvents: 'none', zIndex: 1 }} />

      {/* ════ LEFT — numbers + progress + winners ════ */}
      <div style={{ flex: 1, minWidth: 0, padding: '10px 12px', position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column' }}>
        {/* floating bg commands */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
          {/* background glitches removed for cleaner arena */}
        </div>

        <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#453071', letterSpacing: '0.15em' }}>◉ HACK MATRIX</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#a78bfa', animation: 'dot 1.5s infinite' }} />
              <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#a78bfa' }}>LIVE</span>
            </div>
          </div>

          {preGameSecs > 0 && calledOrder.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#453071', letterSpacing: '0.2em' }}>HACK INITIATES IN</div>
              <div style={{
                fontFamily: 'Syne,sans-serif', fontSize: 56, fontWeight: 800, color: '#fff', lineHeight: 1,
                textShadow: '0 0 30px #fff,0 0 60px rgba(255,255,255,0.4)'
              }}>{fmtTime(preGameSecs)}</div>
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>ACTIVATE YOUR DEVICES NOW</div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 8, paddingTop: 4 }}>
              {/* ── Big number ── */}
              <div style={{ textAlign: 'center', position: 'relative' }}>
                {lastNum !== null ? (
                  <>
                    <div style={{
                      fontFamily: 'Syne,sans-serif', fontSize: 72, fontWeight: 800, lineHeight: 1, color: '#fff',
                      textShadow: '0 0 20px #fff,0 0 40px rgba(255,255,255,0.6)',
                      animation: glitching ? 'matrixGlitch 0.6s ease' : 'numAppear 0.4s cubic-bezier(.34,1.56,.64,1)'
                    }}>
                      {lastNum}
                    </div>
                    {glitching && (<>
                      <div style={{
                        position: 'absolute', inset: 0, fontFamily: 'Syne,sans-serif', fontSize: 72, fontWeight: 800,
                        color: '#ff0040', opacity: 0.5, animation: 'glitchR 0.6s ease', pointerEvents: 'none'
                      }}>{lastNum}</div>
                      <div style={{
                        position: 'absolute', inset: 0, fontFamily: 'Syne,sans-serif', fontSize: 72, fontWeight: 800,
                        color: '#c084fc', opacity: 0.5, animation: 'glitchB 0.6s ease', pointerEvents: 'none'
                      }}>{lastNum}</div>
                    </>)}
                  </>
                ) : (
                  <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 32, fontWeight: 400, color: '#2d1f4a', lineHeight: 2.2, letterSpacing: '0.2em' }}>
                    STANDBY
                  </div>
                )}
              </div>

              {/* Click window pill + round timer arc — synced with device clocks */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
                  background: clickWindowOpen ? 'rgba(167,139,250,0.1)' : 'rgba(255,92,138,0.06)',
                  border: `1px solid ${clickWindowOpen ? 'rgba(167,139,250,0.4)' : 'rgba(255,92,138,0.2)'}`, borderRadius: 20
                }}>
                  <div style={{
                    width: 4, height: 4, borderRadius: '50%', background: clickWindowOpen ? '#a78bfa' : '#ff5c8a',
                    animation: clickWindowOpen ? 'dot 1s infinite' : 'none'
                  }} />
                  <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: clickWindowOpen ? '#a78bfa' : '#ff5c8a' }}>
                    {clickWindowOpen ? 'CLICK WINDOW OPEN' : 'WINDOW CLOSED'}
                  </span>
                </div>
                {/* Timer moved to vertical Decenterilzied vault bar */}
              </div>

              {/* Prev 5 */}
              {prev5.length > 0 && (
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                  {prev5.map((n, i) => (
                    <div key={i} style={{
                      width: 22, height: 22, borderRadius: 4, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', background: '#150d24', border: '1px solid #241538',
                      fontFamily: 'DM Mono,monospace', fontSize: 9, color: '#fff',
                      opacity: 0.72 - i * 0.12, textShadow: '0 0 4px rgba(255,255,255,0.4)'
                    }}>{n}</div>
                  ))}
                </div>
              )}

              {/* Progress bar */}
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>NUMBERS DRAWN</span>
                  <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#453071' }}>{drawn}/90 · {100 - pct}% left</span>
                </div>
                <div style={{ height: 5, background: '#150d24', borderRadius: 3, overflow: 'hidden', border: '1px solid #150d24', position: 'relative' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`, borderRadius: 3, transition: 'width 0.6s ease',
                    background: 'linear-gradient(90deg,#b26bff,#c084fc,#f59e0b)',
                    boxShadow: '0 0 6px rgba(178,107,255,0.5)'
                  }} />
                  {Array.from({ length: 9 }, (_, i) => (
                    <div key={i} style={{ position: 'absolute', left: `${(i + 1) * 100 / 9}%`, top: 0, bottom: 0, width: 1, background: '#ffffff0a' }} />
                  ))}
                </div>
              </div>

              {/* Winner feed */}
              <div style={{ width: '100%', background: '#0a0612', border: '1px solid #150d24', borderRadius: 6, padding: '5px 8px' }}>
                <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', letterSpacing: '0.1em', marginBottom: 3 }}>
                  🏆 WINNER FEED
                </div>
                <WinnersTerminal winRecords={winRecords} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ════ Divider ════ */}
      <div className="matrix-right-divider" style={{ width: 1, background: 'linear-gradient(180deg,transparent,#2e106560,#2e106560,transparent)', flexShrink: 0, zIndex: 2, alignSelf: 'stretch' }} />

      {/* ════ RIGHT — Vault + Chart + Stats (hidden on mobile) ════ */}
      <div className="matrix-right-panel" style={{ width: 170, flexShrink: 0, padding: '10px 10px', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 6 }}>

        {/* Bank name */}
        <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#453071', letterSpacing: '0.1em', fontWeight: 700 }}>
          🏦 {BANKS[liveBank].name.toUpperCase()}
        </div>

        {/* ── 1. Decenterilzied vault illustration + vertical timer ── */}
        <div style={{ flex: '0 0 130px', display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <VaultSketch pct={vaultPct} paid={paid} />
          {(() => {
            const danger = timer <= 10
            const pctTime = Math.max(0, Math.min(100, (timer / Math.max(totalTimer, 1)) * 100))
            return (
              <div title="Round timer" style={{ width: 12, borderRadius: 8, background: '#07121f', border: '1px solid #2e1065', overflow: 'hidden', position: 'relative', alignSelf: 'stretch' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${pctTime}%`, background: danger ? 'linear-gradient(180deg,#ff5c8a,#47161b)' : 'linear-gradient(180deg,#b26bff,#c084fc)', boxShadow: danger ? '0 0 10px #ff5c8a' : '0 0 10px #b26bff', transition: 'height 0.9s linear' }} />
                <span style={{ position: 'absolute', inset: 0, writingMode: 'vertical-rl', transform: 'rotate(180deg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#f8fafc', fontWeight: 700 }}>{String(timer % 60).padStart(2, '0')}s</span>
              </div>
            )
          })()}
        </div>

        {/* Vault progress bar */}
        <div style={{ height: 4, background: '#150d24', borderRadius: 2, overflow: 'hidden', border: '1px solid #150d24' }}>
          <div style={{
            height: '100%', width: `${vaultPct * 100}%`, background: 'linear-gradient(90deg,#b26bff,#a78bfa)',
            borderRadius: 2, transition: 'width 1.2s ease', boxShadow: '0 0 4px rgba(178,107,255,0.5)'
          }} />
        </div>

        {/* ── 2. HEIST chart ── */}
        <div>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', letterSpacing: '0.08em', marginBottom: 3 }}>
            📈 HEIST PRICE
          </div>
          <HeistChart prices={prices} trend={trend} live={live} contractAddr={contractAddr} />
        </div>

        {/* ── 3. Sliding Decenterilzied vault stats panel ── */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid #150d24', padding: '7px 8px', borderRadius: 8, background: 'linear-gradient(90deg,rgba(178,107,255,0.06),rgba(0,184,255,0.02))', transform: 'translateX(0)', boxShadow: 'inset 3px 0 0 rgba(178,107,255,0.35)' }}>
          {[
            ['CLAIMED', `$${(paid / 1000).toFixed(0)}K`, '#b26bff'],
            ['REMAINING', `$${((vaultTotal - paid) / 1000).toFixed(1)}K`, '#f59e0b'],
            ['DRAWN', `${drawn}/90`, '#a99bc4'],
            ['WINS', String(winRecords.length), '#a855f7'],
          ].map(([k, v, col]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '1.5px 0', borderBottom: '1px solid #070f1a' }}>
              <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>{k}</span>
              <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: col, fontWeight: 700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ════ BOTTOM — Vault Info Bar ════ */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, background: 'linear-gradient(180deg,rgba(2,13,26,0.92),rgba(2,13,26,0.98))', borderTop: '1px solid #2e1065', padding: '6px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        {/* Vault HEIST tokens */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#b26bff', boxShadow: '0 0 6px #b26bff' }} />
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', letterSpacing: '0.05em' }}>DECENTERILZIED VAULT</span>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b26bff', fontWeight: 700 }}>{Math.max(0, Math.floor(vaultHeist - totalPaidHeist)).toLocaleString()} HEIST</span>
        </div>
        {/* Devices */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 6px #a855f7' }} />
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', letterSpacing: '0.05em' }}>DEVICES</span>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#a855f7', fontWeight: 700 }}>{deviceCount}/20</span>
        </div>
        {/* Claimed */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ec4899', boxShadow: '0 0 6px #ec4899' }} />
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', letterSpacing: '0.05em' }}>CLAIMED</span>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#ec4899', fontWeight: 700 }}>{winRecords.length}/7 wins</span>
        </div>
        {/* USDC equivalent */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 6px #f59e0b' }} />
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', letterSpacing: '0.05em' }}>VALUE</span>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#f59e0b', fontWeight: 700 }}>${heistRateUsd != null ? (Math.max(0, vaultHeist - totalPaidHeist) * heistRateUsd).toFixed(2) : '—'}</span>
        </div>
      </div>
    </div>
  )
}




// ─── Map & Terminal Chat & Overlays ──────────────────────────────────────────
interface OperativeUser {
  id: string;
  name: string;
  level: number;
  devices: number;
  status: 'online' | 'in_heist' | 'minting';
}

const INITIAL_OPERATIVES: OperativeUser[] = [
  { id: 'op1', name: 'CIPHER_9', level: 6, devices: 4, status: 'online' },
  { id: 'op2', name: 'GHOST_X', level: 9, devices: 8, status: 'in_heist' },
  { id: 'op3', name: 'ZERO_DAY', level: 7, devices: 5, status: 'online' },
  { id: 'op4', name: 'NEO_404', level: 3, devices: 2, status: 'minting' },
  { id: 'op5', name: 'SPECTRE_1', level: 5, devices: 3, status: 'online' },
  { id: 'op6', name: 'VORTEX_8', level: 4, devices: 2, status: 'in_heist' },
  { id: 'op7', name: 'SHADOW_OPS', level: 8, devices: 6, status: 'online' },
]

// VBGIOR Neon Color Band Palette
const NEON_PALETTE = [
  { name: 'Violet', hex: '#a855f7' },
  { name: 'Blue', hex: '#c084fc' },
  { name: 'Green', hex: '#b26bff' },
  { name: 'Indigo/Cyan', hex: '#06b6d4' },
  { name: 'Orange', hex: '#f59e0b' },
  { name: 'Red', hex: '#ff5c8a' },
  { name: 'Yellow', hex: '#ffd166' },
]

interface MintNotification {
  id: string;
  heistId: string;
  username: string;
  count: number;
  timestamp: number;
  x: number;
  y: number;
}

// ── Small Floating DM Terminal Component ─────────────────────────────────────
function SmallDmTerminal({
  targetUser,
  onClose,
  nickname,
  isBlocked,
  onToggleBlock,
}: {
  targetUser: string;
  onClose: () => void;
  nickname: string;
  isBlocked: boolean;
  onToggleBlock: (name: string) => void;
}) {
  const [minimized, setMinimized] = useState(false)
  const [messages, setMessages] = useState<Array<{ sender: string; text: string; color?: string; img?: string; audio?: string }>>([
    { sender: 'SYSTEM', text: `ENCRYPTED P2P TUNNEL // TARGET: ${targetUser}`, color: '#b26bff' },
    { sender: targetUser, text: 'Heist channel secured. Send coordinates.', color: '#ec4899' },
  ])
  const [dmInput, setDmInput] = useState('')
  const [dmColor, setDmColor] = useState('#b26bff')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  const sendDm = () => {
    if (!dmInput.trim()) return
    const sender = (nickname || 'OPERATIVE').toUpperCase()
    const text = dmInput.trim()
    setMessages(p => [...p, { sender, text, color: dmColor }])
    setDmInput('')

    if (!isBlocked) {
      setTimeout(() => {
        setMessages(p => [...p, {
          sender: targetUser,
          text: `[ACK] Payload received: "${text.slice(0, 16)}..." Standby for breach pulse.`,
          color: '#ec4899'
        }])
      }, 1200)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    files.forEach(f => {
      const isImg = f.type.startsWith('image/')
      const isAudio = f.type.startsWith('audio/')
      if (!isImg && !isAudio) return
      const reader = new FileReader()
      reader.onload = ev => {
        const src = ev.target?.result as string
        const sender = (nickname || 'OPERATIVE').toUpperCase()
        setMessages(p => [
          ...p,
          {
            sender,
            text: `[SHARED FILE] ${f.name}`,
            color: dmColor,
            img: isImg ? src : undefined,
            audio: isAudio ? src : undefined,
          }
        ])
      }
      reader.readAsDataURL(f)
    })
    e.target.value = ''
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: 230,
        bottom: 12,
        width: 320,
        background: 'rgba(3,10,20,0.96)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid #ec4899',
        borderRadius: 8,
        boxShadow: '0 0 24px rgba(236,72,153,0.35)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'DM Mono, monospace',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '6px 10px',
        background: 'rgba(236,72,153,0.15)',
        borderBottom: '1px solid rgba(236,72,153,0.3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: '#ec4899', fontWeight: 700 }}>✉ TERM://DM/@{targetUser}</span>
          {isBlocked && <span style={{ fontSize: 7, color: '#ff5c8a', background: 'rgba(255,92,138,0.2)', padding: '1px 4px', borderRadius: 3 }}>BLOCKED</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => onToggleBlock(targetUser)}
            style={{ background: 'transparent', border: 'none', color: isBlocked ? '#a78bfa' : '#ff5c8a', fontSize: 8, cursor: 'pointer' }}
            title={isBlocked ? "Unblock User" : "Block User"}
          >
            {isBlocked ? 'UNBLOCK' : 'BLOCK'}
          </button>
          <button
            onClick={() => setMinimized(m => !m)}
            style={{ background: 'transparent', border: 'none', color: '#b26bff', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
            title="Minimize"
          >
            {minimized ? '□' : '—'}
          </button>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#ff5c8a', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Chat Messages */}
          <div ref={listRef} style={{ height: 160, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, background: '#0a0612' }}>
            {messages.map((m, i) => (
              <div key={i} style={{ fontSize: 8, lineHeight: 1.4 }}>
                <span style={{ color: m.color || '#b26bff', fontWeight: 700 }}>[{m.sender}]: </span>
                <span style={{ color: m.color || '#f8fafc' }}>{m.text}</span>
                {m.img && <img src={m.img} alt="" style={{ maxWidth: '100%', maxHeight: 80, borderRadius: 4, marginTop: 4, display: 'block', border: '1px solid #ec4899' }} />}
                {m.audio && <audio controls src={m.audio} style={{ width: '100%', height: 26, marginTop: 4 }} />}
              </div>
            ))}
          </div>

          {/* Color strip for DM */}
          <div style={{ display: 'flex', gap: 4, padding: '4px 8px', background: 'rgba(5,15,25,0.9)', borderTop: '1px solid rgba(236,72,153,0.2)', alignItems: 'center' }}>
            <span style={{ fontSize: 7, color: '#a99bc4' }}>COLOR:</span>
            {NEON_PALETTE.map(p => (
              <div
                key={p.hex}
                onClick={() => setDmColor(p.hex)}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: p.hex,
                  cursor: 'pointer',
                  border: dmColor === p.hex ? '1px solid #fff' : '1px solid transparent',
                  boxShadow: dmColor === p.hex ? `0 0 6px ${p.hex}` : 'none',
                }}
              />
            ))}
          </div>

          {/* Input & File Controls */}
          <div style={{ display: 'flex', borderTop: '1px solid rgba(236,72,153,0.3)', background: '#01050a' }}>
            <input ref={fileInputRef} type="file" accept="image/*,audio/*" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{ background: 'transparent', border: 'none', borderRight: '1px solid rgba(236,72,153,0.2)', padding: '6px 8px', color: '#ec4899', cursor: 'pointer', fontSize: 10 }}
              title="Insert Image/Audio"
            >
              📎
            </button>
            <input
              value={dmInput}
              onChange={e => setDmInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendDm()}
              placeholder={isBlocked ? "USER BLOCKED" : "SEND ENCRYPTED DM..."}
              disabled={isBlocked}
              style={{ flex: 1, background: 'transparent', border: 'none', padding: '6px 8px', fontFamily: 'DM Mono,monospace', fontSize: 8, color: dmColor, outline: 'none' }}
            />
            <button
              onClick={sendDm}
              disabled={isBlocked}
              style={{ background: 'rgba(236,72,153,0.2)', border: 'none', borderLeft: '1px solid rgba(236,72,153,0.3)', padding: '6px 10px', color: '#ec4899', cursor: isBlocked ? 'default' : 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700 }}
            >
              TX
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── View Minted Consoles Terminal Modal ──────────────────────────────────────
function MintedConsolesModal({
  devices,
  onClose,
}: {
  devices: Device[];
  onClose: () => void;
}) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(1,8,16,0.88)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 620,
        maxHeight: '85vh',
        background: '#040d18',
        border: '1px solid #b26bff',
        borderRadius: 12,
        boxShadow: '0 0 40px rgba(178,107,255,0.25)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'DM Mono, monospace',
      }}>
        {/* Header */}
        <div style={{ padding: '10px 14px', background: 'rgba(178,107,255,0.12)', borderBottom: '1px solid #b26bff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>📟</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#b26bff' }}>MINTED CONSOLES TERMINAL [{devices.length} ARMED]</span>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#ff5c8a', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {devices.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#a99bc4', fontSize: 11 }}>
              NO CONSOLES DETECTED. MINT CONSOLES FROM THE VAULT OR ROBINHOOD LOCK PANEL TO INITIATE HACKING MATRIX.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {devices.map((d, idx) => (
                <div key={d.id} style={{ background: '#081626', border: '1px solid rgba(178,107,255,0.25)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#b26bff' }}>CONSOLE #{idx + 1} ({d.nftId ? d.nftId.slice(0, 8) : `#DEV-${d.id}`})</span>
                    <span style={{ fontSize: 8, color: d.active ? '#a78bfa' : '#f59e0b', background: 'rgba(167,139,250,0.1)', padding: '1px 5px', borderRadius: 3 }}>{d.active ? 'ACTIVE' : 'READY'}</span>
                  </div>
                  <div style={{ fontSize: 7, color: '#a99bc4' }}>HASH: {d.walletAddr ? d.walletAddr.slice(0, 16) + '...' : 'LOCAL_STORAGE_NFT'}</div>
                  {/* Micro 3x9 Matrix Preview */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 2, background: '#020810', padding: 4, borderRadius: 4 }}>
                    {d.grid.flatMap((row, rIdx) => row.map((cell, cIdx) => (
                      <div
                        key={`${rIdx}-${cIdx}`}
                        style={{
                          aspectRatio: '1',
                          background: cell.num ? 'rgba(178,107,255,0.15)' : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${cell.num ? 'rgba(178,107,255,0.4)' : 'transparent'}`,
                          borderRadius: 2,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 6,
                          color: cell.num ? '#b26bff' : '#33205e',
                        }}
                      >
                        {cell.num || ''}
                      </div>
                    )))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 14px', background: '#020710', borderTop: '1px solid rgba(178,107,255,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 8, color: '#a99bc4' }}>
          <span>DECENTERILZIED HARDWARE SPECS: 27 NODES · 15 RANDOM SEEDS</span>
          <button onClick={onClose} style={{ background: 'rgba(178,107,255,0.15)', border: '1px solid #b26bff', color: '#b26bff', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>CLOSE</button>
        </div>
      </div>
    </div>
  )
}

// ── Integrated Lobby Map With Full-Map Transparent Cyber Terminal ─────────────
function LobbyMapWithOverlays({
  nickname,
  currentHour,
  liveBank,
  selectedBank,
  setSelectedBank,
  lobbyCountdown,
  onEnterGame,
  devices,
  mintToken,
  setMintToken,
  onQuickMint,
  mintCostLabel,
  chatRooms,
  onCreateRoom,
  onCloseRoom,
}: {
  nickname: string;
  currentHour: number;
  liveBank: number;
  selectedBank: number | null;
  setSelectedBank: (id: number | null) => void;
  lobbyCountdown: number;
  onEnterGame: () => void;
  devices: Device[];
  mintToken?: string;
  setMintToken?: (t: string) => void;
  onQuickMint?: (count: number) => void;
  mintCostLabel?: string;
  chatRooms: ChatRoom[];
  onCreateRoom: (room: ChatRoom) => void;
  onCloseRoom: (id: string) => void;
}) {
  const [activeDmUser, setActiveDmUser] = useState<string | null>(null)
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set())
  const [operatives, setOperatives] = useState<OperativeUser[]>(INITIAL_OPERATIVES)
  const [showConsolesModal, setShowConsolesModal] = useState(false)
  const [selectedColor, setSelectedColor] = useState('#b26bff')
  const [quickMintCount, setQuickMintCount] = useState(1)
  const [heistPanelOpen, setHeistPanelOpen] = useState(() => typeof window !== 'undefined' ? window.innerWidth > 600 : true)
  const [hudMenuOpen, setHudMenuOpen] = useState(false)
  const [hudColourOpen, setHudColourOpen] = useState(false)
  const [createRoomOpen, setCreateRoomOpen] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomPasskey, setRoomPasskey] = useState('')
  const [roomMembers, setRoomMembers] = useState<Set<string>>(new Set())

  // Laser animations and Mint Notifications
  const [mintNotifications, setMintNotifications] = useState<MintNotification[]>([
    { id: 'm1', heistId: 'HEIST_#892', username: 'GHOST_X', count: 10, timestamp: Date.now() - 5000, x: 35, y: 40 },
  ])
  const [lasers, setLasers] = useState<Array<{ id: string; x1: number; y1: number; x2: number; y2: number; color: string; opacity: number }>>([])

  const [selectedOperativeId, setSelectedOperativeId] = useState<string | null>(null)
  const [lastAcquired, setLastAcquired] = useState<number | null>(null)
  const [showAcquiredAnim, setShowAcquiredAnim] = useState(false)

  // Caliber Roller state
  const handleRollerWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (e.deltaY < 0) setQuickMintCount(c => Math.min(20, c + 1))
    else setQuickMintCount(c => Math.max(1, c - 1))
  }

  // Trigger laser and notification simulation periodically or on mint
  useEffect(() => {
    const triggerMintEvent = (heistId: string, username: string, count: number) => {
      const x = 20 + Math.random() * 60
      const y = 20 + Math.random() * 60
      const newNotif: MintNotification = {
        id: Math.random().toString(),
        heistId,
        username,
        count,
        timestamp: Date.now(),
        x,
        y,
      }
      setMintNotifications(prev => [newNotif, ...prev.slice(0, 3)])

      // Spawn laser beams towards map targets
      const laserId = Math.random().toString()
      setLasers(prev => [
        ...prev,
        {
          id: laserId,
          x1: x,
          y1: y,
          x2: 50 + (Math.random() - 0.5) * 40,
          y2: 50 + (Math.random() - 0.5) * 40,
          color: ['#b26bff', '#c084fc', '#f59e0b', '#ec4899'][Math.floor(Math.random() * 4)],
          opacity: 1,
        }
      ])

      // Slowly fade out laser
      setTimeout(() => {
        setLasers(prev => prev.filter(l => l.id !== laserId))
      }, 4000)

      // Vault acquisition animation if it's "us" (simulated for demo here)
      if (username === nickname || username === 'CIPHER_9') {
        setLastAcquired(count * 0.5)
        setShowAcquiredAnim(true)
        setTimeout(() => setShowAcquiredAnim(false), 3000)
      }
    }

    const interval = setInterval(() => {
      const sampleUsers = ['CIPHER_9', 'ZERO_DAY', 'SPECTRE_1', 'NEO_404', 'SHADOW_OPS']
      const u = sampleUsers[Math.floor(Math.random() * sampleUsers.length)]
      const c = [2, 5, 10, 20][Math.floor(Math.random() * 4)]
      const h = `HEIST_#${Math.floor(1000 + Math.random() * 9000)}`
      triggerMintEvent(h, u, c)
    }, 14000)

    return () => clearInterval(interval)
  }, [])

  // Watch user's own devices for new mint animations
  const prevDeviceCountRef = useRef(devices.length)
  useEffect(() => {
    if (devices.length > prevDeviceCountRef.current) {
      const diff = devices.length - prevDeviceCountRef.current
      const myName = (nickname || 'OPERATIVE').toUpperCase()
      const heistId = `HEIST_#${Math.floor(1000 + Math.random() * 9000)}`
      
      const newNotif: MintNotification = {
        id: Math.random().toString(),
        heistId,
        username: myName,
        count: diff,
        timestamp: Date.now(),
        x: 50,
        y: 50,
      }
      setMintNotifications(prev => [newNotif, ...prev.slice(0, 3)])
      
      // Spawn intense laser beam
      const laserId = Math.random().toString()
      setLasers(prev => [
        ...prev,
        { id: laserId, x1: 50, y1: 50, x2: 20, y2: 30, color: '#b26bff', opacity: 1 },
        { id: laserId + '_2', x1: 50, y1: 50, x2: 80, y2: 70, color: '#c084fc', opacity: 1 },
      ])
      setTimeout(() => {
        setLasers(prev => prev.filter(l => !l.id.startsWith(laserId)))
      }, 4500)
    }
    prevDeviceCountRef.current = devices.length
  }, [devices.length, nickname])

  // Chat state
  const [lines, setLines] = useState<Array<{ sender: string; m: string; t?: string; src?: string; audioSrc?: string; color?: string }>>([
    { sender: 'SYSTEM', m: 'HEIST TERMINAL ACTIVE · DECENTERILZIED VAULT SECURED', t: 'sys', color: '#b26bff' },
    { sender: 'CIPHER_9', m: 'All 4 hacking consoles deployed and synchronized.', t: 'user', color: '#c084fc' },
    { sender: 'ZERO_DAY', m: 'Monitoring target bank security node.', t: 'user', color: '#ffd166' },
  ])
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const b = scrollRef.current
    if (b) b.scrollTop = b.scrollHeight
  }, [lines])

  const toggleBlock = (targetName: string) => {
    setBlockedUsers(prev => {
      const next = new Set(prev)
      if (next.has(targetName)) next.delete(targetName)
      else next.add(targetName)
      return next
    })
  }

  const send = () => {
    if (!input.trim()) return
    const myName = (nickname || 'OPERATIVE').toUpperCase()
    setLines(p => [...p, { sender: myName, m: input.trim(), t: 'user', color: selectedColor }])
    setInput('')
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    files.forEach(f => {
      const isImg = f.type.startsWith('image/')
      const isAud = f.type.startsWith('audio/')
      if (!isImg && !isAud) return
      const r = new FileReader()
      r.onload = ev => {
        const src = ev.target?.result as string
        const myName = (nickname || 'OPERATIVE').toUpperCase()
        setLines(p => [
          ...p,
          {
            sender: myName,
            m: `[UPLOADED ${isAud ? 'AUDIO' : 'IMAGE'}]: ${f.name}`,
            src: isImg ? src : undefined,
            audioSrc: isAud ? src : undefined,
            t: 'file',
            color: selectedColor,
          }
        ])
      }
      r.readAsDataURL(f)
    })
    e.target.value = ''
  }

  const visibleLines = lines.filter(l => !blockedUsers.has(l.sender))

  return (
    <div className="lobby-map-stage" style={{ position: 'relative', background: '#0a0612', border: '1px solid rgba(178,107,255,0.3)', borderRadius: 12, overflow: 'hidden', minHeight: 560, display: 'flex', flexDirection: 'column' }}>
      
      {/* ── Main Map Container (100% Full View Area) ── */}
      <div style={{ position: 'relative', flex: 1, minHeight: 560, width: '100%', height: '100%', overflow: 'hidden' }}>
        
        {/* The World Map Background (100% full view underneath) */}
        <WorldMapSketch className="world-map-sketch" currentHour={currentHour} onSelectBank={setSelectedBank} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

        {/* ── Laser Beam SVG Overlay on Map ── */}
        <svg className="laser-beams" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 8 }}>
          <defs>
            <filter id="laserGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {lasers.map(l => (
            <g key={l.id}>
              <line
                x1={`${l.x1}%`}
                y1={`${l.y1}%`}
                x2={`${l.x2}%`}
                y2={`${l.y2}%`}
                stroke={l.color}
                strokeWidth="2.5"
                filter="url(#laserGlow)"
                style={{ opacity: l.opacity, transition: 'opacity 3.5s ease-out' }}
              />
              <circle
                cx={`${l.x1}%`}
                cy={`${l.y1}%`}
                r="8"
                fill="none"
                stroke={l.color}
                strokeWidth="2"
                style={{ opacity: l.opacity, transition: 'opacity 3.5s ease-out' }}
              />
              <circle
                cx={`${l.x2}%`}
                cy={`${l.y2}%`}
                r="14"
                fill="none"
                stroke={l.color}
                strokeWidth="1.5"
                strokeDasharray="4 2"
                style={{ opacity: l.opacity, transition: 'opacity 3.5s ease-out' }}
              />
            </g>
          ))}
        </svg>

        {/* ── FULL MAP TRANSPARENT CHAT INTERFACE HUD ── */}
        <div className="global-heist-hud"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(2, 8, 16, 0.25)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'DM Mono, monospace',
          }}
        >
          {/* Top Organized Icons & Action Controls Header */}
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(17,24,39, 0.85)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              borderBottom: '1px solid rgba(178, 107, 255, 0.25)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              zIndex: 20,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {/* Left: Terminal Identity & Live Map Target */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#b26bff', animation: 'ledBlink 1.5s infinite', boxShadow: '0 0 8px #b26bff' }} />
                <span style={{ fontSize: 10, color: '#b26bff', fontWeight: 700 }}>TERMINAL://GLOBAL_HEIST_HUD</span>
              </div>
            </div>

            {/* Center: Live Mint Notification Ticker */}
            {mintNotifications[0] && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: 'linear-gradient(90deg, rgba(178,107,255,0.15), rgba(0,184,255,0.15))',
                border: '1px solid rgba(178,107,255,0.4)',
                borderRadius: 4,
                padding: '2px 8px',
                animation: 'ledBlink 2.5s infinite',
              }}>
                <span style={{ fontSize: 8 }}>⚡</span>
                <span style={{ fontSize: 7.5, color: '#b26bff', fontWeight: 700 }}>
                  [{mintNotifications[0].heistId}] <span style={{ color: '#fff' }}>{mintNotifications[0].username}</span> MINTED <span style={{ color: '#ffd166' }}>{mintNotifications[0].count} CONSOLES</span>!
                </span>
              </div>
            )}

            {/* Right: Arranged Top Action Icons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {/* ⚙ OPTIONS Dropdown: Colour / Consoles / Create Room */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setHudMenuOpen(o => !o)}
                  style={{
                    padding: '3px 8px',
                    background: hudMenuOpen ? 'rgba(178,107,255,0.2)' : 'rgba(178,107,255,0.12)',
                    border: '1px solid #b26bff',
                    borderRadius: 4,
                    color: '#b26bff',
                    fontSize: 7.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'DM Mono, monospace',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title="HUD options"
                >
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: selectedColor, display: 'inline-block', boxShadow: `0 0 4px ${selectedColor}` }} />
                  ⚙ OPTIONS {hudMenuOpen ? '▴' : '▾'}
                </button>
                {hudMenuOpen && (
                  <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 172, background: 'rgba(3,14,28,0.97)', border: '1px solid rgba(178,107,255,0.4)', borderRadius: 6, boxShadow: '0 10px 30px rgba(0,0,0,0.7)', zIndex: 40, padding: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {/* Colour */}
                    <div
                      onClick={() => setHudColourOpen(o => !o)}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 8, fontWeight: 700, color: '#b26bff', background: hudColourOpen ? 'rgba(178,107,255,0.1)' : 'transparent' }}
                    >
                      <span>🎨 COLOUR</span><span style={{ fontSize: 7 }}>{hudColourOpen ? '▴' : '▾'}</span>
                    </div>
                    {hudColourOpen && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '5px 7px', background: 'rgba(0,0,0,0.4)', borderRadius: 4 }}>
                        {NEON_PALETTE.map(p => (
                          <div
                            key={p.hex}
                            onClick={() => setSelectedColor(p.hex)}
                            title={`${p.name} (${p.hex})`}
                            style={{
                              width: 13,
                              height: 13,
                              borderRadius: 3,
                              background: p.hex,
                              cursor: 'pointer',
                              border: selectedColor === p.hex ? '1.5px solid #ffffff' : '1px solid rgba(255,255,255,0.15)',
                              boxShadow: selectedColor === p.hex ? `0 0 6px ${p.hex}` : 'none',
                              transform: selectedColor === p.hex ? 'scale(1.15)' : 'scale(1)',
                              transition: 'all 0.12s ease',
                            }}
                          />
                        ))}
                      </div>
                    )}
                    {/* Consoles */}
                    <div
                      onClick={() => { setShowConsolesModal(true); setHudMenuOpen(false) }}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 8, fontWeight: 700, color: '#c084fc' }}
                    >
                      <span>📟 CONSOLES</span><span style={{ fontSize: 7, color: '#a99bc4' }}>{devices.length}</span>
                    </div>
                    {/* Create Room */}
                    <div
                      onClick={() => { setCreateRoomOpen(true); setHudMenuOpen(false) }}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 8, fontWeight: 700, color: '#a855f7' }}
                    >
                      <span>🔒 CREATE ROOM</span><span style={{ fontSize: 7 }}>+</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ⚡ ENTER THE MATRIX Button */}
              <button
                onClick={onEnterGame}
                style={{
                  background: 'linear-gradient(135deg,#ff5c8a,#be185d)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 4,
                  padding: '4px 9px',
                  fontSize: 8.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 0 10px rgba(255,92,138,0.5)',
                  fontFamily: 'Syne, sans-serif',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
                title="Enter Hack Matrix"
              >
                <span style={{ fontSize: 8 }}>ENTER</span> MATRIX →
              </button>

              {/* Mobile toggle for Heist List */}
              <button
                onClick={() => setHeistPanelOpen(o => !o)}
                style={{
                  padding: '3px 7px',
                  background: heistPanelOpen ? 'rgba(236,72,153,0.2)' : 'rgba(0,184,255,0.12)',
                  border: `1px solid ${heistPanelOpen ? '#ec4899' : '#c084fc'}`,
                  borderRadius: 4,
                  color: heistPanelOpen ? '#ec4899' : '#c084fc',
                  fontSize: 7.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'DM Mono, monospace',
                }}
              >
                👥 HEIST LIST ({operatives.length})
              </button>
            </div>
          </div>

          {/* ── Middle Transparent Chat Body & Floating Heist List ── */}
          <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
            
            {/* Transparent Chat Log Area (Map is fully visible through here) */}
            <div
              ref={scrollRef}
              className={`hud-chatlog${heistPanelOpen ? '' : ' heist-closed'}`}
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                background: 'transparent',
              }}
            >
              {visibleLines.map((l, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 8.5,
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                    background: 'rgba(3, 12, 24, 0.45)',
                    backdropFilter: 'blur(3px)',
                    WebkitBackdropFilter: 'blur(3px)',
                    padding: '4px 10px',
                    borderRadius: 6,
                    borderLeft: `2px solid ${l.color || '#b26bff'}`,
                    width: 'fit-content',
                    maxWidth: '85%',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  }}
                >
                  {l.t === 'sys' ? (
                    <span style={{ color: '#b26bff', fontWeight: 700 }}>[SYS_OP] {l.m}</span>
                  ) : (
                    <span>
                      <strong style={{ color: l.sender === (nickname || 'OPERATIVE').toUpperCase() ? '#b26bff' : '#c084fc' }}>root@{l.sender}:~$ </strong>
                      <span style={{ color: l.color || '#f8fafc' }}>{l.m}</span>
                    </span>
                  )}
                  {l.src && (
                    <img
                      src={l.src}
                      alt=""
                      style={{ maxWidth: '100%', maxHeight: 110, borderRadius: 4, marginTop: 4, display: 'block', border: '1px solid rgba(178,107,255,0.3)' }}
                    />
                  )}
                  {l.audioSrc && (
                    <div style={{ marginTop: 4 }}>
                      <audio controls src={l.audioSrc} style={{ width: '100%', maxWidth: 280, height: 26 }} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ── Extreme Right: Heist List Section with Quick Mint Tab above ── */}
            <div
              className={`heist-panel${heistPanelOpen ? '' : ' heist-closed'}`}
              style={{
                position: 'absolute',
                right: 12,
                top: 12,
                bottom: 12,
                width: 220,
                background: 'rgba(17,24,39, 0.88)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: '1px solid rgba(178,107,255,0.3)',
                borderRadius: 8,
                boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
                zIndex: 20,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* ── Quick Mint Console Tab (Above Heist List) ── */}
              <div style={{
                padding: '8px 10px',
                background: 'linear-gradient(180deg, rgba(178,107,255,0.14), rgba(4,18,34,0.95))',
                borderBottom: '1px solid rgba(178,107,255,0.25)',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: '#b26bff', letterSpacing: '0.05em' }}>QUICK MINT</span>
                  <span style={{ fontSize: 7, color: '#ffd166', background: 'rgba(255,209,102,0.12)', padding: '1px 4px', borderRadius: 3 }}>
                    {mintToken || 'ETH'}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
                  <button
                    className="keyboard-key keyboard-key-accent"
                    onClick={() => onQuickMint ? onQuickMint(quickMintCount) : null}
                    style={{
                      flex: 1,
                      padding: '12px 20px',
                      fontSize: 12,
                      fontWeight: 700,
                      borderRadius: 10,
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      boxShadow: '0 4px 20px rgba(178,107,255,0.3)'
                    }}
                  >
                    <span>MINT {quickMintCount}×</span>
                  </button>

                  {/* Caliber Keys — keyboard-key steppers (scroll wheel still works) */}
                  <div
                    onWheel={handleRollerWheel}
                    style={{
                      width: 46,
                      background: '#150d24',
                      border: '1px solid #b26bff40',
                      borderLeft: 'none',
                      borderRadius: '0 6px 6px 0',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 3,
                      padding: '4px 2px',
                      userSelect: 'none'
                    }}
                    title="▲ / ▼ keys or scroll to change amount"
                  >
                    <button
                      className="keyboard-key keyboard-key-sm"
                      aria-label="Increase mint amount"
                      onClick={() => setQuickMintCount(c => Math.min(20, c + 1))}
                      disabled={quickMintCount >= 20}
                      style={{
                        width: 28,
                        height: 16,
                        padding: 0,
                        background: 'linear-gradient(180deg,#2d1f4a,#1f1330)',
                        border: '1px solid #b26bff55',
                        borderTop: '1px solid #b26bffaa',
                        borderRadius: 4,
                        color: '#b26bff',
                        fontSize: 8,
                        fontWeight: 800,
                        lineHeight: 1,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >▲</button>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#b26bff', fontFamily: 'DM Mono,monospace', lineHeight: 1 }}>{quickMintCount}</div>
                    <button
                      className="keyboard-key keyboard-key-sm"
                      aria-label="Decrease mint amount"
                      onClick={() => setQuickMintCount(c => Math.max(1, c - 1))}
                      disabled={quickMintCount <= 1}
                      style={{
                        width: 28,
                        height: 16,
                        padding: 0,
                        background: 'linear-gradient(180deg,#2d1f4a,#1f1330)',
                        border: '1px solid #b26bff55',
                        borderBottom: '1px solid #b26bffaa',
                        borderRadius: 4,
                        color: '#b26bff',
                        fontSize: 8,
                        fontWeight: 800,
                        lineHeight: 1,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >▼</button>
                  </div>
                </div>
              </div>

              {/* Heist List Header */}
              <div style={{ padding: '6px 8px', background: 'rgba(14,8,25,0.98)', borderBottom: '1px solid rgba(178,107,255,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 8.5, fontWeight: 700, color: '#b26bff' }}>◈ HEIST LIST</span>
                <span style={{ fontSize: 7, color: '#a78bfa', background: 'rgba(167,139,250,0.12)', padding: '1px 5px', borderRadius: 3 }}>{operatives.length} ACTIVE</span>
              </div>

              {/* Operatives user list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {operatives.map(op => {
                  const isBlocked = blockedUsers.has(op.name)
                  const isTargetingDm = activeDmUser === op.name
                  return (
                    <div
                      key={op.id}
                      onClick={() => setSelectedOperativeId(op.id === selectedOperativeId ? null : op.id)}
                      style={{
                        padding: '5px 7px',
                        background: isBlocked ? 'rgba(255,92,138,0.08)' : isTargetingDm ? 'rgba(236,72,153,0.1)' : 'rgba(10,22,38,0.6)',
                        border: `1px solid ${isBlocked ? 'rgba(255,92,138,0.3)' : isTargetingDm ? '#ec4899' : 'rgba(51,65,85,0.4)'}`,
                        borderRadius: 5,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ width: 4, height: 4, borderRadius: '50%', background: op.status === 'online' ? '#a78bfa' : op.status === 'in_heist' ? '#f59e0b' : '#c084fc' }} />
                          <span style={{ fontSize: 7.5, fontWeight: 700, color: isBlocked ? '#ff5c8a' : '#f8fafc', textDecoration: isBlocked ? 'line-through' : 'none' }}>{op.name}</span>
                        </div>
                        <span style={{ fontSize: 7, color: '#a99bc4' }}>{op.devices} devs</span>
                      </div>

                      {/* Actions: DM & Block (Only visible if selected) */}
                      {selectedOperativeId === op.id && (
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 1 }}>
                          <button
                            onClick={() => setActiveDmUser(op.name)}
                            disabled={isBlocked}
                            style={{
                              padding: '2px 5px',
                              background: 'rgba(236,72,153,0.15)',
                              border: '1px solid rgba(236,72,153,0.35)',
                              borderRadius: 3,
                              color: isBlocked ? '#7d6b99' : '#ec4899',
                              fontSize: 7,
                              fontWeight: 700,
                              cursor: isBlocked ? 'default' : 'pointer',
                            }}
                          >
                            ✉ DM
                          </button>
                          <button
                            onClick={() => toggleBlock(op.name)}
                            style={{
                              padding: '2px 5px',
                              background: isBlocked ? 'rgba(255,92,138,0.2)' : 'rgba(125,107,153,0.1)',
                              border: `1px solid ${isBlocked ? '#ff5c8a' : 'rgba(125,107,153,0.3)'}`,
                              borderRadius: 3,
                              color: isBlocked ? '#ff5c8a' : '#7d6b99',
                              fontSize: 7,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            {isBlocked ? '✓' : '🚫'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={{ padding: '4px 6px', borderTop: '1px solid rgba(178,107,255,0.15)', background: 'rgba(14,8,25,0.98)', textAlign: 'center', fontSize: 6.5, color: '#a99bc4' }}>
                DECENTERILZIED VAULT HUNTERS
              </div>
            </div>

            {/* ── Vertical Drawer Key (glides on the list's left edge — press » to slide the list away & widen chat) ── */}
            <div
              className="heist-drawer-key"
              onClick={() => setHeistPanelOpen(o => !o)}
              style={{ right: heistPanelOpen ? 234 : 2 }}
              title={heistPanelOpen ? 'Slide heist list away — widen chat' : 'Draw heist list out'}
            >
              <span style={{ fontSize: 12, fontWeight: 800 }}>{heistPanelOpen ? '»' : '«'}</span>
              <span className="vertical-label">HEIST LIST</span>
            </div>

            {/* ── Private Room Windows (cascade next to main chat) ── */}
            {chatRooms.map((room, i) => (
              <RoomChatTerminal
                key={room.id}
                room={room}
                nickname={nickname}
                posStyle={{ position: 'absolute', top: 12 + i * 16, right: (heistPanelOpen ? 252 : 46) + i * 16, zIndex: 30 }}
                onClose={() => onCloseRoom(room.id)}
              />
            ))}

            {/* ── Active Small DM Terminal Window (Floating) ── */}
            {activeDmUser && (
              <SmallDmTerminal
                targetUser={activeDmUser}
                onClose={() => setActiveDmUser(null)}
                nickname={nickname}
                isBlocked={blockedUsers.has(activeDmUser)}
                onToggleBlock={toggleBlock}
              />
            )}
          </div>

          {/* ── Bottom Transparent Input Bar with Universal File Upload ── */}
          <div
            style={{
              display: 'flex',
              borderTop: '1px solid rgba(178,107,255,0.25)',
              background: 'rgba(17,24,39, 0.85)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              zIndex: 20,
            }}
          >
            <input ref={fileRef} type="file" accept="image/*,audio/*" multiple onChange={handleFile} style={{ display: 'none' }} />
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                background: 'rgba(178,107,255,0.08)',
                border: 'none',
                borderRight: '1px solid rgba(178,107,255,0.2)',
                padding: '8px 12px',
                color: '#ffd166',
                cursor: 'pointer',
                fontSize: 8.5,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
              title="Insert Image or Audio File"
            >
              📎 INSERT FILE
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="ENTER TRANSMISSION COMMAND TO GLOBAL HEIST MATRIX..."
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                padding: '8px 12px',
                fontFamily: 'DM Mono,monospace',
                fontSize: 8.5,
                color: selectedColor,
                outline: 'none',
              }}
            />
            <button
              onClick={send}
              style={{
                background: 'rgba(178,107,255,0.2)',
                border: 'none',
                borderLeft: '1px solid rgba(178,107,255,0.3)',
                padding: '8px 16px',
                color: '#b26bff',
                cursor: 'pointer',
                fontFamily: 'DM Mono,monospace',
                fontSize: 8.5,
                fontWeight: 700,
              }}
            >
              TRANSMIT
            </button>
          </div>
        </div>
      </div>

      {/* ── Minted Consoles Modal ── */}
      {showConsolesModal && (
        <MintedConsolesModal
          devices={devices}
          onClose={() => setShowConsolesModal(false)}
        />
      )}

      {/* ── CREATE ROOM Modal ── */}
      {createRoomOpen && (() => {
        const canCreate = roomName.trim().length >= 2 && /^[A-Za-z0-9]{4}$/.test(roomPasskey) && roomMembers.size > 0
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(1,8,16,0.9)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setCreateRoomOpen(false) }}>
            <div style={{ background: '#0e0819', border: '1px solid rgba(168,85,247,0.5)', borderRadius: 14, padding: 18, width: '100%', maxWidth: 380, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 0 40px rgba(168,85,247,0.25)', fontFamily: 'DM Mono, monospace' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#a855f7' }}>🔒 CREATE PRIVATE ROOM</span>
                <button onClick={() => setCreateRoomOpen(false)} style={{ background: '#150d24', border: '1px solid #241538', color: '#a99bc4', borderRadius: 5, padding: '3px 8px', fontSize: 8, cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ fontSize: 8, color: '#a99bc4', marginBottom: 14 }}>Seperate chat window for invited operatives only. Rooms persist until the game ends.</div>

              <div style={{ fontSize: 8, color: '#b26bff', fontWeight: 700, marginBottom: 5 }}>ROOM NAME</div>
              <input
                value={roomName}
                onChange={e => setRoomName(e.target.value)}
                placeholder="e.g. VAULT_CREW"
                maxLength={16}
                style={{ width: '100%', boxSizing: 'border-box', background: '#150d24', border: '1px solid #241538', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#a855f7', outline: 'none', marginBottom: 10 }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 8, color: '#b26bff', fontWeight: 700 }}>PASSKEY (4 CHARS)</span>
                <span style={{ fontSize: 7, color: '#a99bc4' }}>{roomPasskey.length}/4</span>
              </div>
              <input
                value={roomPasskey}
                onChange={e => setRoomPasskey(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4))}
                placeholder="e.g. X9K2"
                style={{ width: '100%', boxSizing: 'border-box', background: '#150d24', border: '1px solid #241538', borderRadius: 8, padding: '10px 12px', fontSize: 14, letterSpacing: '0.35em', color: '#ffd166', outline: 'none', marginBottom: 4 }}
              />
              {!/^[A-Za-z0-9]{4}$/.test(roomPasskey) && roomPasskey.length > 0 && (
                <div style={{ fontSize: 7, color: '#ff5c8a', marginBottom: 8 }}>Exactly 4 letters/numbers required</div>
              )}

              <div style={{ fontSize: 8, color: '#b26bff', fontWeight: 700, margin: '10px 0 5px' }}>ALLOWED OPERATIVES ({roomMembers.size} selected)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 150, overflowY: 'auto', marginBottom: 12 }}>
                {operatives.filter(op => !blockedUsers.has(op.name)).map(op => (
                  <div
                    key={op.id}
                    onClick={() => setRoomMembers(prev => {
                      const n = new Set(prev)
                      if (n.has(op.name)) n.delete(op.name)
                      else n.add(op.name)
                      return n
                    })}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: 5, cursor: 'pointer', background: roomMembers.has(op.name) ? 'rgba(168,85,247,0.14)' : 'rgba(10,22,38,0.6)', border: `1px solid ${roomMembers.has(op.name) ? '#a855f7' : 'rgba(51,65,85,0.4)'}` }}
                  >
                    <span style={{ fontSize: 8, color: roomMembers.has(op.name) ? '#d8b4fe' : '#f8fafc', fontWeight: 700 }}>{op.name}</span>
                    <span style={{ fontSize: 8, color: roomMembers.has(op.name) ? '#a855f7' : '#a99bc4' }}>{roomMembers.has(op.name) ? '✓ IN' : '+ ADD'}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => {
                  if (!canCreate) return
                  onCreateRoom({ id: Math.random().toString(36).slice(2), name: roomName.trim().toUpperCase(), passkey: roomPasskey, members: Array.from(roomMembers) })
                  setRoomName(''); setRoomPasskey(''); setRoomMembers(new Set()); setCreateRoomOpen(false)
                  setHeistPanelOpen(false)
                }}
                disabled={!canCreate}
                style={{ width: '100%', padding: 12, background: canCreate ? 'linear-gradient(135deg,#a855f7,#6d28d9)' : '#150d24', color: canCreate ? '#fff' : '#241538', border: `1px solid ${canCreate ? '#a855f7' : '#241538'}`, borderRadius: 10, fontSize: 11, fontWeight: 800, cursor: canCreate ? 'pointer' : 'default', fontFamily: 'Syne, sans-serif' }}
              >
                🔒 LAUNCH PRIVATE ROOM
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}


function ChatTerminal({ nickname }: { nickname: string }) {
  const [lines, setLines] = useState<ChatLine[]>([
    { t: 'sys', m: 'HACKING MATRIX v3.7.1 INITIALIZED' },
    { t: 'sys', m: `AGENT ${nickname.toUpperCase()} CONNECTED` },
    { t: 'sys', m: 'TIP: /ai <question> — CONSULT THE ORACLE (OMNIROUTE UPLINK)' },
  ])
  const [input, setInput] = useState('')
  const [mediaQueue, setMediaQueue] = useState<MediaItem[]>([])
  const [playIdx, setPlayIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => { const b = scrollRef.current; if (b) b.scrollTop = b.scrollHeight }, [lines])

  // Sequential media player: when queue grows or playback ends, play next
  useEffect(() => {
    if (mediaQueue.length === 0 || playing) return
    setPlaying(true)
  }, [mediaQueue, playing])

  const handleMediaEnd = () => {
    const next = playIdx + 1
    if (next < mediaQueue.length) { setPlayIdx(next) }
    else { setPlaying(false); setPlayIdx(0); setMediaQueue([]) }
  }

  const [aiBusy, setAiBusy] = useState(false)

  // /ai <question> — ask the ORACLE through the local OmniRoute gateway (/api/chat)
  const send = async () => {
    if (!input.trim() || aiBusy) return
    const text = input
    setLines(p => [...p, { t: 'user', m: `${nickname}: ${text}` }])
    setInput('')
    if (text.startsWith('/ai ')) {
      const q = text.slice(4).trim()
      if (q) {
        setAiBusy(true)
        setLines(p => [...p, { t: 'sys', m: 'ORACLE IS CONSULTING THE GATEWAY...' }])
        try {
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: q }], stream: false, maxTokens: 1024 }),
          })
          const data = await res.json()
          setLines(p => [...p, { t: 'sys', m: `ORACLE: ${data.content || data.error || '[no response]'}` }])
        } catch (e) {
          setLines(p => [...p, { t: 'sys', m: `ORACLE OFFLINE: ${String(e)}` }])
        } finally {
          setAiBusy(false)
        }
      }
    }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    files.forEach(f => {
      if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) return
      const r = new FileReader()
      r.onload = ev => {
        const src = ev.target?.result as string
        const type: 'image' | 'video' = f.type.startsWith('video/') ? 'video' : 'image'
        setMediaQueue(q => [...q, { src, type, name: f.name }])
        setLines(p => [...p, { t: 'img', m: `${nickname}: ${f.name}`, src: type === 'image' ? src : undefined, vSrc: type === 'video' ? src : undefined }])
      }
      r.readAsDataURL(f)
    })
    e.target.value = ''
  }

  const currentMedia = playing && mediaQueue[playIdx] ? mediaQueue[playIdx] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#0e0819', border: '1px solid #150d24', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '5px 10px', borderBottom: '1px solid #150d24', fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b26bff', display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#a78bfa', animation: 'dot 1.5s infinite' }} />
        SECURE CHAT
        {mediaQueue.length > 0 && <span style={{ marginLeft: 'auto', fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#f59e0b' }}>▶ {playIdx + 1}/{mediaQueue.length} queued</span>}
      </div>
      {/* Media player — sequential queue */}
      {currentMedia && (
        <div style={{ background: '#070310', borderBottom: '1px solid #150d24', padding: 4 }}>
          {currentMedia.type === 'image' ? (
            <img src={currentMedia.src} alt="" onLoad={() => setTimeout(handleMediaEnd, 2000)}
              style={{ width: '100%', maxHeight: 120, objectFit: 'contain', borderRadius: 4, display: 'block' }} />
          ) : (
            <video ref={videoRef} src={currentMedia.src} autoPlay controls onEnded={handleMediaEnd}
              style={{ width: '100%', maxHeight: 120, borderRadius: 4, display: 'block' }} />
          )}
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#f59e0b', padding: '2px 4px' }}>{currentMedia.name} · {playIdx + 1}/{mediaQueue.length}</div>
        </div>
      )}
      <div ref={scrollRef} style={{ height: 200, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {lines.map((l, i) => (
          <div key={i}>
            <div style={{
              fontFamily: 'DM Mono,monospace', fontSize: 8,
              color: l.t === 'sys' ? '#b26bff' : l.t === 'user' ? '#c084fc' : l.t === 'img' ? '#f59e0b' : '#453071',
              fontWeight: l.t === 'user' ? 600 : 400
            }}>{l.m}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid #150d24' }}>
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={handleFile} style={{ display: 'none' }} />
        <button onClick={() => fileRef.current?.click()} style={{ background: '#150d24', border: 'none', borderRight: '1px solid #150d24', padding: '6px 9px', color: '#f59e0b', cursor: 'pointer', fontSize: 12 }}>📎</button>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="TYPE MESSAGE..."
          style={{ flex: 1, background: 'transparent', border: 'none', padding: '6px 7px', fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#c084fc', outline: 'none' }} />
        <button onClick={send} style={{ background: '#150d24', border: 'none', borderLeft: '1px solid #150d24', padding: '6px 9px', color: '#453071', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 8 }}>TX</button>
      </div>
    </div>
  )
}

// ─── Game Stats ───────────────────────────────────────────────────────────────
function GameStats({ devices, calledNums, bankruptCount, liveBank, nickname, winStates, contractAddr, setContractAddr }: {
  devices: Device[]; calledNums: Set<number>; bankruptCount: number; liveBank: number; nickname: string;
  winStates: Record<WinType, WinState>; contractAddr: string; setContractAddr: (v: string) => void
}) {
  const LED_TYPES: WinType[] = ['EARLY_FIVE', 'TOP_LINE', 'MIDDLE_LINE', 'BOTTOM_LINE', 'FULL_HOUSE_1', 'FULL_HOUSE_2', 'FULL_HOUSE_3']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ background: '#0e0819', border: '1px solid #150d24', borderRadius: 12, padding: 10 }}>
        <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#453071', marginBottom: 7 }}>GAME STATS</div>
        {[['AGENT', nickname], ['TARGET', BANKS[liveBank].name.split(' ')[0]], ['DRAWN', `${calledNums.size}/90`], ['DEVICES', `${devices.filter(d => d.active).length}/${devices.length}`], ['BANKRUPT', `${bankruptCount}/3`]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid #150d24' }}>
            <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>{k}</span>
            <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#a99bc4', fontWeight: 600 }}>{v}</span>
          </div>
        ))}
        {/* Contract address input for HEIST price feed */}
        <div style={{ marginTop: 7, paddingTop: 6, borderTop: '1px solid #150d24' }}>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', marginBottom: 3 }}>HEIST CONTRACT</div>
          <input value={contractAddr} onChange={e => setContractAddr(e.target.value)}
            placeholder="0x... or token addr"
            style={{
              width: '100%', background: '#150d24', border: `1px solid ${contractAddr ? '#b26bff40' : '#150d24'}`, borderRadius: 5, padding: '4px 6px',
              fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b26bff', outline: 'none', boxSizing: 'border-box'
            }} />
        </div>
      </div>
      <div style={{ background: '#0e0819', border: '1px solid #150d24', borderRadius: 10, padding: 10 }}>
        <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', marginBottom: 7 }}>WIN STATUS</div>
        {LED_TYPES.map(type => <LedProgress key={type} type={type} ws={winStates[type]} devices={devices} />)}
      </div>
    </div>
  )
}

// ─── Nickname Modal ───────────────────────────────────────────────────────────
function NicknameModal({ onConfirm }: { onConfirm: (name: string) => void }) {
  const [name, setName] = useState(''), [err, setErr] = useState('')
  const go = () => { if (name.trim().length < 3) { setErr('Min 3 chars'); return } if (name.trim().length > 16) { setErr('Max 16 chars'); return } onConfirm(name.trim()) }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(135deg,#0a0612,#0e0819)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#0e0819', border: '1px solid #2e1065', borderRadius: 20, padding: 32, maxWidth: 340, width: '100%', boxShadow: '0 0 60px rgba(178,107,255,0.08)' }}>
        <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 28, fontWeight: 800, color: '#b26bff', textShadow: '0 0 20px #b26bff60', marginBottom: 4 }}>ROBHIN HEIST</div>
        <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 9, color: '#453071', letterSpacing: '0.15em', marginBottom: 24 }}>HACK THE BANKS — CLAIM THE DECENTERILZIED VAULT</div>
        <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 9, color: '#a99bc4', marginBottom: 8 }}>CHOOSE YOUR AGENT NAME</div>
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="e.g. GHOST_ZERO" maxLength={16}
          style={{ width: '100%', background: '#150d24', border: '1px solid #241538', borderRadius: 10, padding: '12px 14px', fontFamily: 'DM Mono,monospace', fontSize: 14, color: '#b26bff', outline: 'none', boxSizing: 'border-box', marginBottom: 6, caretColor: '#b26bff' }} />
        {err && <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#ff5c8a', marginBottom: 8 }}>{err}</div>}
        <button className="keyboard-key keyboard-key-accent" onClick={go} style={{ width: '100%', borderRadius: 10, padding: '14px', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 6 }}>ENTER THE MATRIX →</button>
      </div>
    </div>
  )
}

// ─── Private Room Chat (create-room feature) ──────────────────────────────
// Module-level store so room messages survive lobby→matrix phase switches.
// Rooms live in main-component state and are wiped when the game ends.
type ChatRoom = { id: string; name: string; passkey: string; members: string[] }
type RoomMsg = { sender: string; text: string; color?: string; img?: string; audio?: string }
const roomMsgStore = new Map<string, RoomMsg[]>()

function RoomChatTerminal({
  room,
  nickname,
  onClose,
  posStyle,
  cascadeIndex = 0,
  fixed = false,
}: {
  room: ChatRoom
  nickname: string
  onClose: () => void
  posStyle?: React.CSSProperties
  cascadeIndex?: number
  fixed?: boolean
}) {
  const [minimized, setMinimized] = useState(false)
  const [messages, setMessages] = useState<RoomMsg[]>(() => roomMsgStore.get(room.id) ?? [
    { sender: 'SYSTEM', text: `PRIVATE ROOM // ${room.name} // KEY: ${room.passkey}`, color: '#a855f7' },
    { sender: 'SYSTEM', text: `ALLOWED: ${room.members.join(', ')}`, color: '#a99bc4' },
  ])
  const [roomInput, setRoomInput] = useState('')
  const [roomColor, setRoomColor] = useState('#a855f7')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { roomMsgStore.set(room.id, messages.slice(-80)) }, [messages, room.id])
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight }, [messages, minimized])

  const sendRoom = () => {
    if (!roomInput.trim()) return
    const sender = (nickname || 'OPERATIVE').toUpperCase()
    setMessages(p => [...p, { sender, text: roomInput.trim(), color: roomColor }])
    setRoomInput('')
    const others = room.members.filter(m => m !== sender)
    if (others.length > 0) {
      const responder = others[Math.floor(Math.random() * others.length)]
      setTimeout(() => setMessages(p => [...p, { sender: responder, text: `[SECURE] Copy that — room "${room.name}" synced.`, color: '#c084fc' }]), 1100)
    }
  }

  const pos: React.CSSProperties = posStyle ?? (fixed
    ? { position: 'fixed', top: 60 + cascadeIndex * 16, right: 12 + cascadeIndex * 16, zIndex: 900 }
    : { position: 'absolute', top: 12 + cascadeIndex * 16, right: 12 + cascadeIndex * 16, zIndex: 30 })

  return (
    <div style={{
      ...pos,
      width: 300,
      maxWidth: 'calc(100vw - 60px)',
      background: 'rgba(3,10,20,0.96)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid #a855f7',
      borderRadius: 8,
      boxShadow: '0 0 24px rgba(168,85,247,0.35)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      fontFamily: 'DM Mono, monospace',
    }}>
      {/* Header */}
      <div style={{ padding: '6px 10px', background: 'rgba(168,85,247,0.15)', borderBottom: '1px solid rgba(168,85,247,0.35)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 9, color: '#a855f7', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🔒 TERM://ROOM/{room.name}</span>
          <span style={{ fontSize: 7, color: '#ffd166', background: 'rgba(255,209,102,0.12)', padding: '1px 4px', borderRadius: 3 }}>🔑 {room.passkey}</span>
          <span style={{ fontSize: 7, color: '#a99bc4' }}>👥 {room.members.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setMinimized(m => !m)} style={{ background: 'transparent', border: 'none', color: '#b26bff', fontSize: 11, cursor: 'pointer', fontWeight: 700 }} title="Minimize">{minimized ? '□' : '—'}</button>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#ff5c8a', fontSize: 11, cursor: 'pointer', fontWeight: 700 }} title="Close room">✕</button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Allowed members strip */}
          <div style={{ padding: '3px 8px', fontSize: 7, color: '#a99bc4', background: 'rgba(5,15,25,0.9)', borderBottom: '1px solid rgba(168,85,247,0.2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            ALLOWED: {room.members.join(' · ')}
          </div>

          {/* Messages */}
          <div ref={listRef} style={{ height: 170, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, background: '#0a0612' }}>
            {messages.map((m, i) => (
              <div key={i} style={{ fontSize: 8, lineHeight: 1.4 }}>
                <span style={{ color: m.color || '#a855f7', fontWeight: 700 }}>[{m.sender}]: </span>
                <span style={{ color: m.color || '#f8fafc' }}>{m.text}</span>
                {m.img && <img src={m.img} alt="" style={{ maxWidth: '100%', maxHeight: 80, borderRadius: 4, marginTop: 4, display: 'block', border: '1px solid #a855f7' }} />}
                {m.audio && <audio controls src={m.audio} style={{ width: '100%', height: 26, marginTop: 4 }} />}
              </div>
            ))}
          </div>

          {/* Colour strip */}
          <div style={{ display: 'flex', gap: 4, padding: '4px 8px', background: 'rgba(5,15,25,0.9)', borderTop: '1px solid rgba(168,85,247,0.2)', alignItems: 'center' }}>
            <span style={{ fontSize: 7, color: '#a99bc4' }}>COLOR:</span>
            {NEON_PALETTE.map(p => (
              <div key={p.hex} onClick={() => setRoomColor(p.hex)} title={p.name} style={{ width: 10, height: 10, borderRadius: 2, background: p.hex, cursor: 'pointer', border: roomColor === p.hex ? '1.5px solid #ffffff' : '1px solid rgba(255,255,255,0.15)' }} />
            ))}
          </div>

          {/* Input */}
          <div style={{ display: 'flex', borderTop: '1px solid rgba(168,85,247,0.3)' }}>
            <input
              value={roomInput}
              onChange={e => setRoomInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendRoom()}
              placeholder={`MESSAGE #${room.name}...`}
              style={{ flex: 1, background: 'transparent', border: 'none', padding: '7px 9px', fontFamily: 'DM Mono,monospace', fontSize: 8, color: roomColor, outline: 'none', minWidth: 0 }}
            />
            <button onClick={sendRoom} style={{ background: 'rgba(168,85,247,0.25)', border: 'none', borderLeft: '1px solid rgba(168,85,247,0.35)', padding: '7px 12px', color: '#d8b4fe', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700 }}>SEND</button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Maximized Device Grid (fullscreen overlay) ───────────────────────────────
// ─── Maximized Device Grid (fullscreen overlay, 2-col, 6 per page) ──────────
function MaximizedDevices({ devices, currentNum, clickWindowOpen, calledNums, onCellClick, onClaim, onActivate, winStates, bankruptCount, timer, totalTimer, liveBank, onClose, onOpenVault }: {
  devices: Device[]; currentNum: number | null; clickWindowOpen: boolean; calledNums: Set<number>;
  onCellClick: (id: number, r: number, c: number) => void; onClaim: (id: number, w: WinType) => void;
  onActivate: (id: number) => void; winStates: Record<WinType, WinState>; bankruptCount: number;
  timer: number; totalTimer: number; liveBank: number; onClose: () => void; onOpenVault?: () => void
}) {
  const [page, setPage] = useState(0)
  const total = Math.max(1, Math.ceil(devices.length / 6))
  const pageDevs = devices.slice(page * 6, page * 6 + 6)
  const txRef = useRef<number | null>(null)
  const tyRef = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { txRef.current = e.touches[0].clientX; tyRef.current = e.touches[0].clientY }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (txRef.current === null || tyRef.current === null) return
    const dx = e.changedTouches[0].clientX - txRef.current
    const dy = e.changedTouches[0].clientY - tyRef.current
    if (Math.abs(dx) > Math.abs(dy) * 1.4 && Math.abs(dx) > 40) {
      if (dx < 0 && page < total - 1) setPage(p => p + 1)
      if (dx > 0 && page > 0) setPage(p => p - 1)
    }
    txRef.current = null; tyRef.current = null
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'linear-gradient(180deg,#0a0612,#0e0819)', zIndex: 100, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', borderBottom: '1px solid #1a1029', background: 'rgba(2,13,26,0.98)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>◈ DEVICES</span>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#453071' }}>{devices.filter(d => d.active).length}/{devices.length} active</span>
          {total > 1 && <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#241538' }}>pg {page + 1}/{total}</span>}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {total > 1 && Array.from({ length: total }, (_, i) => (
            <button key={i} onClick={() => setPage(i)} style={{
              width: 7, height: 7, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
              background: i === page ? '#b26bff' : '#241538', boxShadow: i === page ? '0 0 5px #b26bff' : 'none'
            }} />
          ))}
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ width: 24, height: 24, borderRadius: 6, background: '#150d24', border: '1px solid #241538', color: page === 0 ? '#241538' : '#a99bc4', cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
          <button onClick={() => setPage(p => Math.min(total - 1, p + 1))} disabled={page >= total - 1}
            style={{ width: 24, height: 24, borderRadius: 6, background: '#150d24', border: '1px solid #241538', color: page >= total - 1 ? '#241538' : '#a99bc4', cursor: page >= total - 1 ? 'default' : 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
          <button onClick={onClose} style={{ background: '#150d24', border: '1px solid #241538', color: '#a99bc4', borderRadius: 7, padding: '4px 10px', fontFamily: 'DM Mono,monospace', fontSize: 8, cursor: 'pointer' }}>⊟ EXIT</button>
        </div>
      </div>
      {/* 2-col grid, 6 devices per page, scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
          {pageDevs.map(d => (
            <HackingDevice key={d.id} device={d} currentNum={currentNum} clickWindowOpen={clickWindowOpen}
              calledNums={calledNums} onCellClick={onCellClick} onClaim={onClaim} onActivate={onActivate}
              winStates={winStates} bankruptCount={bankruptCount} timer={timer} totalTimer={totalTimer} liveBank={liveBank} onOpenVault={onOpenVault} />
          ))}
        </div>
      </div>
      {total > 1 && (
        <div style={{ textAlign: 'center', padding: '5px', fontFamily: 'DM Mono,monospace', fontSize: 8, color: 'rgba(51,65,85,0.7)', flexShrink: 0 }}>
          ← SWIPE OR USE ARROWS TO NAVIGATE ·  6 DEVICES PER PAGE →
        </div>
      )}
    </div>
  )
}

// ─── Vault Claim Panel — claim held winnings anytime before the next round ──
function VaultClaimPanel({ wallet, announce }: { wallet: string | null; announce: (m: string) => void }) {
  const [data, setData] = useState<any>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const load = useCallback(async () => {
    if (!wallet) { setData(null); return }
    try {
      const r = await fetch('/api/claims?wallet=' + encodeURIComponent(wallet))
      if (r.ok) { const d = await r.json(); if (d.ok) setData(d) }
    } catch { }
  }, [wallet])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])
  const claim = async (winType: number, key: string) => {
    if (!wallet) return
    setBusy(winType)
    try {
      const r = await fetch('/api/claim-sui', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, winType }),
      })
      const d = await r.json()
      if (d.ok) { announce(`✅ ${key} CLAIMED — HELD IN DECENTERILZIED VAULT\nPayout at round end`); load() }
      else { announce(`⚠ ${d.error || 'Claim failed'}`) }
    } catch (e: any) { announce('⚠ ' + e.message) } finally { setBusy(null) }
  }
  const claimable = data?.claimable || []
  const claimed = data?.claimed || []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 8, color: '#ffd166', fontWeight: 700 }}>⚿ YOUR DECENTERILZIED VAULT CLAIMS</span>
        {wallet && <span style={{ fontSize: 8, color: '#a99bc4' }}>{wallet.slice(0, 6)}…{wallet.slice(-4)}</span>}
      </div>
      {!wallet && <div style={{ fontSize: 8, color: '#2d1f4a', textAlign: 'center', padding: '6px 0' }}>CONNECT A SUI WALLET TO CLAIM</div>}
      {wallet && !data && <div style={{ fontSize: 8, color: '#2d1f4a', textAlign: 'center', padding: '6px 0' }}>CHECKING CLAIMS…</div>}
      {wallet && data && claimable.length === 0 && claimed.length === 0 && (
        <div style={{ fontSize: 8, color: '#2d1f4a', textAlign: 'center', padding: '6px 0' }}>NO CLAIMABLE WINS RIGHT NOW</div>
      )}
      {claimable.map((c: any) => (
        <div key={c.winType} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '5px 7px', background: 'rgba(255,209,102,0.06)', border: '1px solid rgba(255,209,102,0.25)', borderRadius: 5 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: '#ffd166', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
            <div style={{ fontSize: 8, color: '#a99bc4' }}>≈ {((c.estPayout || 0) / 1e9).toFixed(4)} SUI</div>
          </div>
          <button onClick={() => claim(c.winType, c.key)} disabled={busy === c.winType} style={{
            flexShrink: 0, padding: '4px 9px', background: busy === c.winType ? '#3a3f2a' : 'linear-gradient(135deg,#f59e0b,#d97706)',
            color: '#000', border: 'none', borderRadius: 4, fontSize: 8, fontWeight: 800, cursor: busy === c.winType ? 'default' : 'pointer', opacity: busy === c.winType ? 0.5 : 1
          }}>{busy === c.winType ? '…' : 'CLAIM'}</button>
        </div>
      ))}
      {claimed.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {claimed.map((c: any) => (
            <span key={c.winType} style={{ fontSize: 8, color: '#a78bfa', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 3, padding: '2px 5px' }}>✓ {c.label}</span>
          ))}
        </div>
      )}
    </div>
  )
}



// ─── Missions Demo Tab ────────────────────────────────────────────────────────
function MissionsDemo() {
  const [step, setStep] = useState(0)
  const [drawn, setDrawn] = useState<number[]>([])
  const [matched1, setMatched1] = useState<Set<number>>(new Set())
  const [matched2, setMatched2] = useState<Set<number>>(new Set())
  const [log, setLog] = useState<string[]>(['⬡ DEMO MODE — Watch 2 devices compete for the vault...'])
  const [running, setRunning] = useState(false)
  const [won, setWon] = useState<string | null>(null)

  const GRID1 = [[7, 22, 34, 0, 56, 0, 71, 82, 90], [0, 15, 0, 38, 0, 52, 0, 88, 0], [3, 0, 29, 41, 0, 63, 74, 0, 85]]
  const GRID2 = [[9, 21, 0, 37, 0, 55, 68, 0, 89], [2, 0, 33, 0, 48, 0, 72, 83, 0], [0, 17, 28, 0, 57, 0, 0, 86, 91]]

  const allNums = Array.from({ length: 90 }, (_, i) => i + 1)

  const runStep = () => {
    if (running || won) return
    setRunning(true)
    let d = [...drawn]
    let m1 = new Set(matched1), m2 = new Set(matched2)
    let logs = [...log]
    let winner = null

    const interval = setInterval(() => {
      const remaining = allNums.filter(n => !d.includes(n))
      if (!remaining.length) { clearInterval(interval); setRunning(false); return }
      const n = remaining[Math.floor(Math.random() * remaining.length)]
      d = [...d, n]
      setDrawn([...d])

      const flat1 = GRID1.flat().filter(x => x > 0)
      const flat2 = GRID2.flat().filter(x => x > 0)
      if (flat1.includes(n)) { m1 = new Set([...m1, n]); setMatched1(new Set(m1)) }
      if (flat2.includes(n)) { m2 = new Set([...m2, n]); setMatched2(new Set(m2)) }

      logs = [`🎲 Drew #${n}${flat1.includes(n) ? ' — Device A matched!' : flat2.includes(n) ? ' — Device B matched!' : ''}`, ...logs.slice(0, 6)]
      setLog([...logs])

      // Check wins
      const row0_1 = GRID1[0].filter(x => x > 0).every(x => m1.has(x))
      const row0_2 = GRID2[0].filter(x => x > 0).every(x => m2.has(x))
      const early1 = [...m1].length >= 5
      const early2 = [...m2].length >= 5

      if (early1 && !winner && [...m1].length === 5) {
        winner = 'A'
        logs = ['🏆 DEVICE A wins EARLY FIVE! +10% vault claimed', ...logs.slice(0, 5)]
        setLog([...logs]); setWon('A')
        clearInterval(interval); setRunning(false)
      } else if (early2 && !winner && [...m2].length === 5) {
        winner = 'B'
        logs = ['🏆 DEVICE B wins EARLY FIVE! +10% vault claimed', ...logs.slice(0, 5)]
        setLog([...logs]); setWon('B')
        clearInterval(interval); setRunning(false)
      } else if (row0_1 && !winner) {
        winner = 'A'
        logs = ['🏆 DEVICE A wins TOP LINE! +10% vault claimed', ...logs.slice(0, 5)]
        setLog([...logs]); setWon('A')
        clearInterval(interval); setRunning(false)
      } else if (row0_2 && !winner) {
        winner = 'B'
        logs = ['🏆 DEVICE B wins TOP LINE! +10% vault claimed', ...logs.slice(0, 5)]
        setLog([...logs]); setWon('B')
        clearInterval(interval); setRunning(false)
      }
    }, 600)
  }

  const reset = () => { setDrawn([]); setMatched1(new Set()); setMatched2(new Set()); setLog(['⬡ DEMO MODE — Watch 2 devices compete for the vault...']); setWon(null); setRunning(false) }

  const renderGrid = (grid: number[][], matched: Set<number>, label: string, color: string) => (
    <div style={{ background: '#150d24', border: '1px solid ' + (won === label ? color : 'rgba(36,21,56,0.3)'), padding: 12, flex: 1, boxShadow: won === label ? '0 0 20px ' + color + '40' : 'none', transition: 'all 0.3s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color, fontWeight: 700 }}>DEVICE {label}</span>
        <span style={{ fontSize: 9, color: '#7d6b99' }}>{matched.size}/15 matched</span>
      </div>
      {grid.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 3, marginBottom: 3 }}>
          {row.map((cell, ci) => {
            const isMatch = cell > 0 && matched.has(cell)
            const isLast = cell > 0 && drawN && cell === drawN
            return (<div key={ci} style={{
              flex: 1, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isMatch ? color + '30' : isLast ? 'rgba(255,255,0,0.15)' : 'rgba(0,0,0,0.4)',
              border: '1px solid ' + (isMatch ? color : isLast ? '#ffff00' : 'rgba(36,21,56,0.3)'),
              fontSize: 9, fontWeight: isMatch ? 700 : 400, color: isMatch ? color : cell === 0 ? '#241538' : '#7d6b99',
              boxShadow: isMatch ? '0 0 8px ' + color + '60' : 'none', transition: 'all 0.2s'
            }}>
              {cell === 0 ? '' : cell}
            </div>)
          })}
        </div>
      ))}
    </div>
  )

  const drawN = drawn[drawn.length - 1] || null

  return (
    <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>📋 MISSIONS — GAME DEMO</div>
          <div style={{ fontSize: 9, color: '#7d6b99', marginTop: 2 }}>Watch a live game simulation with 2 devices competing</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={reset} style={{ padding: '6px 14px', background: 'rgba(36,21,56,0.3)', border: '1px solid rgba(36,21,56,0.5)', color: '#7d6b99', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>RESET</button>
          <button className="keyboard-key keyboard-key-accent" onClick={runStep} disabled={running || !!won} style={{ padding: '6px 14px', background: running || won ? 'rgba(178,107,255,0.1)' : 'linear-gradient(to bottom,#b26bff 0%,#7c3aed 100%)', color: running || won ? '#7d6b99' : '#000', fontSize: 10, fontWeight: 700, cursor: running || won ? 'default' : 'pointer' }}>
            {won ? 'GAME OVER' : running ? 'DRAWING...' : '▶ DRAW NUMBER'}
          </button>
        </div>
      </div>
      {drawN && <div style={{ background: 'rgba(47,243,173,0.06)', border: '1px solid rgba(47,243,173,0.2)', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 9, color: '#7d6b99' }}>LAST DRAWN</span>
        <span style={{ fontSize: 28, fontWeight: 800, color: '#b26bff' }}>{drawN}</span>
        <span style={{ fontSize: 9, color: '#7d6b99' }}>{drawn.length}/90 numbers drawn</span>
        {won && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#b26bff' }}>🏆 DEVICE {won} WINS!</span>}
      </div>}
      <div style={{ display: 'flex', gap: 12 }}>
        {renderGrid(GRID1, matched1, 'A', '#b26bff')}
        {renderGrid(GRID2, matched2, 'B', '#c084fc')}
      </div>
      <div style={{ background: '#150d24', border: '1px solid rgba(36,21,56,0.2)', padding: 12 }}>
        <div style={{ fontSize: 9, color: '#7d6b99', marginBottom: 8 }}>📡 DRAW LOG</div>
        {log.map((l, i) => (<div key={i} style={{ fontSize: 9, color: i === 0 ? '#b26bff' : '#453071', padding: '3px 0', borderBottom: '1px solid rgba(10,25,40,0.5)' }}>{l}</div>))}
      </div>
      <div style={{ background: '#150d24', border: '1px solid rgba(36,21,56,0.2)', padding: 12 }}>
        <div style={{ fontSize: 9, color: '#7d6b99', marginBottom: 8 }}>📖 WIN CONDITIONS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[['EARLY FIVE', 'First 5 cells matched', '10%'], ['TOP LINE', 'All 5 cells in row 1', '10%'], ['MIDDLE LINE', 'All 5 cells in row 2', '10%'], ['BOTTOM LINE', 'All 5 cells in row 3', '10%'], ['BANKRUPT I', 'All 15 cells matched', '15%'], ['BANKRUPT III', '3rd full house', '30%']].map(([name, desc, pct]) => (
            <div key={name} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(36,21,56,0.2)', padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: '#b26bff', fontWeight: 700, marginBottom: 2 }}>{name}</div>
              <div style={{ fontSize: 8, color: '#7d6b99', marginBottom: 4 }}>{desc}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#c084fc' }}>{pct} vault</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


// ─── Network Hub Tab ─────────────────────────────────────────────────────────
function NetworkHub({ nickname, wallet }: { nickname: string; wallet: string | null }) {
  const [rooms, setRooms] = useState([
    { id: 'vault-hunters', name: 'DECENTERILZIED VAULT HUNTERS', members: 12, private: false, topic: 'Coordinating the next heist' },
    { id: 'early-birds', name: 'EARLY BIRDS', members: 5, private: false, topic: 'Early Five strategy' },
    { id: 'global-ops', name: 'GLOBAL OPS', members: 28, private: false, topic: 'Multi-region coordination' },
  ])
  const [activeRoom, setActiveRoom] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<{ user: string; text: string; ts: number }[]>([
    { user: 'GHOST_X', text: 'Anyone targeting Nairobi vault?', ts: Date.now() - 120000 },
    { user: 'CIPHER_9', text: 'Already minted 3 devices', ts: Date.now() - 60000 },
    { user: 'ZERO_DAY', text: 'ETA 45 min to launch window', ts: Date.now() - 30000 },
  ])
  const [input, setInput] = useState('')
  const [newRoom, setNewRoom] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [muteMic, setMuteMic] = useState(true)
  const [muteSpeaker, setMuteSpeaker] = useState(false)
  const [voiceConnected, setVoiceConnected] = useState(false)

  const sendMsg = () => {
    if (!input.trim()) return
    setMsgs(m => [...m, { user: nickname || 'OPERATIVE', text: input.trim(), ts: Date.now() }])
    setInput('')
  }

  const createRoom = () => {
    if (!newRoom.trim()) return
    const id = newRoom.toLowerCase().replace(/\s+/g, '-')
    setRooms(r => [...r, { id, name: newRoom.toUpperCase(), members: 1, private: false, topic: 'New room' }])
    setActiveRoom(id)
    setNewRoom('')
    setShowCreate(false)
  }

  const fmtTs = (ts: number) => {
    const d = Math.floor((Date.now() - ts) / 1000)
    if (d < 60) return d + 's ago'
    if (d < 3600) return Math.floor(d / 60) + 'm ago'
    return Math.floor(d / 3600) + 'h ago'
  }

  return (
    <div style={{ flex: 1, padding: 20, display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, height: 'calc(100vh - 160px)' }}>
      {/* Left: rooms list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#b26bff', fontWeight: 700 }}>🌐 NETWORK ROOMS</span>
          <button onClick={() => setShowCreate(s => !s)} style={{ fontSize: 9, padding: '4px 8px', background: 'rgba(178,107,255,0.1)', border: '1px solid rgba(178,107,255,0.3)', color: '#b26bff', cursor: 'pointer' }}>+ NEW</button>
        </div>
        {showCreate && <div style={{ background: '#150d24', border: '1px solid rgba(178,107,255,0.3)', padding: 10 }}>
          <input value={newRoom} onChange={e => setNewRoom(e.target.value)} placeholder="Room name..." onKeyDown={e => e.key === 'Enter' && createRoom()} style={{ width: '100%', background: 'transparent', border: 'none', color: '#b26bff', fontSize: 10, outline: 'none', marginBottom: 6, boxSizing: 'border-box' }} />
          <button className="keyboard-key keyboard-key-accent" onClick={createRoom} style={{ width: '100%', padding: '5px', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>CREATE ROOM</button>
        </div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflowY: 'auto' }}>
          {rooms.map(r => (
            <div key={r.id} onClick={() => setActiveRoom(r.id)} style={{ padding: '8px 10px', background: activeRoom === r.id ? 'rgba(178,107,255,0.08)' : 'rgba(0,0,0,0.3)', border: '1px solid ' + (activeRoom === r.id ? 'rgba(178,107,255,0.4)' : 'rgba(36,21,56,0.3)'), cursor: 'pointer', transition: 'all 0.15s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: activeRoom === r.id ? '#b26bff' : '#f8fafc', fontWeight: 700 }}>{r.name}</span>
                <span style={{ fontSize: 8, color: '#7d6b99' }}>{r.members} online</span>
              </div>
              <div style={{ fontSize: 8, color: '#7d6b99', marginTop: 2 }}>{r.topic}</div>
            </div>
          ))}
        </div>
        {/* Voice chat controls */}
        <div style={{ background: '#150d24', border: '1px solid rgba(36,21,56,0.2)', padding: 10 }}>
          <div style={{ fontSize: 9, color: '#7d6b99', marginBottom: 8 }}>🎙 VOICE COMMS</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => setMuteMic(m => !m)} style={{ flex: 1, padding: '6px 0', background: muteMic ? 'rgba(255,92,138,0.15)' : 'rgba(178,107,255,0.1)', border: '1px solid ' + (muteMic ? 'rgba(255,92,138,0.4)' : 'rgba(178,107,255,0.3)'), color: muteMic ? '#ff5c8a' : '#b26bff', fontSize: 9, cursor: 'pointer' }}>
              {muteMic ? '🎙 MUTED' : '🎙 LIVE'}
            </button>
            <button onClick={() => setMuteSpeaker(m => !m)} style={{ flex: 1, padding: '6px 0', background: muteSpeaker ? 'rgba(255,92,138,0.15)' : 'rgba(178,107,255,0.1)', border: '1px solid ' + (muteSpeaker ? 'rgba(255,92,138,0.4)' : 'rgba(178,107,255,0.3)'), color: muteSpeaker ? '#ff5c8a' : '#b26bff', fontSize: 9, cursor: 'pointer' }}>
              {muteSpeaker ? '🔇 OFF' : '🔊 ON'}
            </button>
          </div>
          <button onClick={() => setVoiceConnected(v => !v)} style={{ width: '100%', padding: '6px 0', background: voiceConnected ? 'rgba(255,92,138,0.15)' : 'rgba(178,107,255,0.1)', border: '1px solid ' + (voiceConnected ? 'rgba(255,92,138,0.4)' : 'rgba(178,107,255,0.3)'), color: voiceConnected ? '#ff5c8a' : '#b26bff', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
            {voiceConnected ? '📻 DISCONNECT' : '📻 JOIN VOICE'}
          </button>
          {voiceConnected && <div style={{ marginTop: 6, fontSize: 8, color: '#b26bff', animation: 'ledBlink 1s infinite', textAlign: 'center' }}>● CONNECTED — WALKIE TALKIE ACTIVE</div>}
        </div>
      </div>
      {/* Right: chat */}
      <div style={{ display: 'flex', flexDirection: 'column', background: '#150d24', border: '1px solid rgba(36,21,56,0.2)' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(36,21,56,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#b26bff', fontWeight: 700 }}>
            {activeRoom ? rooms.find(r => r.id === activeRoom)?.name || activeRoom : 'SELECT A ROOM'}
          </span>
          {activeRoom && <span style={{ fontSize: 9, color: '#7d6b99' }}>{rooms.find(r => r.id === activeRoom)?.members} operatives online</span>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activeRoom ? msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ width: 24, height: 24, background: 'rgba(178,107,255,0.1)', border: '1px solid rgba(178,107,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#b26bff', flexShrink: 0 }}>{m.user[0]}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontSize: 9, color: '#b26bff', fontWeight: 700 }}>{m.user}</span>
                  <span style={{ fontSize: 8, color: '#453071' }}>{fmtTs(m.ts)}</span>
                </div>
                <div style={{ fontSize: 10, color: '#f8fafc' }}>{m.text}</div>
              </div>
            </div>
          )) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#453071', fontSize: 10 }}>Select a room to start chatting</div>
          )}
        </div>
        {activeRoom && <div style={{ padding: 10, borderTop: '1px solid rgba(36,21,56,0.2)', display: 'flex', gap: 8 }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMsg()} placeholder="Message..." style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(36,21,56,0.3)', color: '#f8fafc', fontSize: 10, padding: '6px 10px', outline: 'none' }} />
          <button className="keyboard-key keyboard-key-accent" onClick={sendMsg} style={{ padding: '6px 14px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>SEND</button>
        </div>}
      </div>
    </div>
  )
}

// ─── Main (wrapped with wallet providers) ─────────────────────────────────────
export default function RansomeApp() {
  const network = WalletAdapterNetwork.Devnet
  const endpoint = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com'
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], [])
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Ransome />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

function Ransome() {
  const { publicKey, disconnect, connected, sendTransaction } = useWallet()
  const { connection: solanaConnection } = useConnection()

  // ─── On-chain constants ────────────────────────────────────────────────
  const PROGRAM_ID_STR = '5ZFVc4h5Z6ccuxCRNM1Ubr1LC5cv6bvPugYFMJMgRU31'
  const SESSION_AUTH_STR = publicKey?.toBase58() || ''
  const WIN_TYPE_INDEX: Record<string, number> = {
    EARLY_FIVE: 0, TOP_LINE: 1, MIDDLE_LINE: 2, BOTTOM_LINE: 3,
    FULL_HOUSE_1: 4, FULL_HOUSE_2: 5, FULL_HOUSE_3: 6,
  }
  // ─── Chain selection (solana | sui) ─────────────────────────────────────
  const [chain, setChain] = useState<'solana' | 'evm'>('evm')
  // EVM wallet state — reactive via useEvmWallet hook
  const {
    address: evmAddress,
    chainId: evmChainId,
    connecting: evmConnecting,
    ethBalance,
    usdgBalance,
    usdcBalance,
    usdtBalance,
    xBalance,
    isDiscountEligible,
    connect: connectEvm,
    disconnect: disconnectEvm,
    switchNetwork: switchEvmNetwork,
    lockXTokens,
    mintConsoles,
    refreshBalances,
  } = useEvmWallet()

  const evmConnected = !!evmAddress
  const evmWallet = { address: evmAddress, chainId: evmChainId, connected: evmConnected, isDiscountEligible, lockXTokens, switchNetwork: switchEvmNetwork }
  // HEIST price rules defined at top (see HEIST PRICING RULES) — this is the on-chain HEIST payment amount
  // Unified wallet address
  const wallet = chain === 'solana' && connected && publicKey ? publicKey.toBase58() : chain === 'evm' && evmConnected ? evmAddress : null
  // ── Check MTRX delegation status ───────────────────────────────────
  const checkMtrxDelegation = useCallback(async (addr: string) => {
    if (!addr || addr.length < 32) { setMtrxDelegated(false); setMtrxBalance(0); return }
    setCheckingMtrx(true)
    try {
      const r = await fetch('/api/check-mtrx-delegation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr }) })
      if (r.ok) { const d = await r.json(); if (d.ok) { setMtrxDelegated(d.delegated); setMtrxBalance(d.balance) } }
    } catch { } finally { setCheckingMtrx(false) }
  }, [])

  const [phase, setPhase] = useState<string>('setup')
  const [nickname, setNickname] = useState('')
  const [devices, setDevices] = useState<Device[]>([])
  const [calledNums, setCalledNums] = useState<Set<number>>(new Set())
  const [calledOrder, setCalledOrder] = useState<number[]>([])
  const [timer, setTimer] = useState(60)
  const [totalTimer, setTotalTimer] = useState(60)
  const [clickWindowOpen, setClickWindowOpen] = useState(false)
  const [announcement, setAnnouncement] = useState<string | null>(null)
  const [bankruptCount, setBankruptCount] = useState(0)
  const [mintCount, setMintCount] = useState(1)
  const [mintToken, setMintToken] = useState('ETH')
  const [mtrxDelegated, setMtrxDelegated] = useState(false)
  const [mtrxBalance, setMtrxBalance] = useState(0)
  const [solAddress, setSolAddress] = useState('')
  const [checkingMtrx, setCheckingMtrx] = useState(false)
  const [selectedBank, setSelectedBank] = useState<number | null>(null)
  const [devicesExpanded, setDevicesExpanded] = useState(false)
  const [showTerminate, setShowTerminate] = useState(false)
  const [showVaultClaim, setShowVaultClaim] = useState(false)
  // ── Theme: dark (default) / light (white primary + saffron/green accents) ──
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return (localStorage.getItem('ransome_theme') as 'dark' | 'light') || 'dark' } catch { return 'dark' } })
  useEffect(() => { try { localStorage.setItem('ransome_theme', theme); document.documentElement.setAttribute('data-theme', theme) } catch { } }, [theme])
  const [preGameSecs, setPreGameSecs] = useState(0)
  const [bankHacked, setBankHacked] = useState(false)
  const [winRecords, setWinRecords] = useState<WinRecord[]>([])
  const [roundNum, setRoundNum] = useState(0)
  const [contractAddr, setContractAddr] = useState('')
  // claimers accumulating per round per winType
  const pendingClaimers = useRef<Record<WinType, string[]>>({ EARLY_FIVE: [], TOP_LINE: [], MIDDLE_LINE: [], BOTTOM_LINE: [], FULL_HOUSE_1: [], FULL_HOUSE_2: [], FULL_HOUSE_3: [] })
  const roundTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [winStates, setWinStates] = useState<Record<WinType, WinState>>(defaultWinStates())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const preTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const flickerTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const sessionStartRef = useRef<number>(0)       // Date.now() when game started
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [sessionSecs, setSessionSecs] = useState(0) // elapsed seconds this session
  const [showEndScreen, setShowEndScreen] = useState(false) // all bankrupts done
  const [walletDebug, setWalletDebug] = useState<string[]>([]) // wallet detection debug logs
  const currentHour = new Date().getUTCHours()
  const liveBank = getLiveBank(currentHour)
  const [navTab, setNavTab] = useState<'operative' | 'vault' | 'missions' | 'heist' | 'quick-mint'>('operative')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([])  // private rooms — persist lobby→matrix, wiped when game ends
  const [devClock, setDevClock] = useState(0)             // dev: jump the 59-min clock
  const lobbyCountdown = useLobbyCountdown(devClock)    // 59-min cycle countdown
  const lobbyFill = Math.min(1 - (lobbyCountdown / LOBBY_CYCLE), 1)  // 0→1 as vault fills
  const onChainSession = useOnChainSession(phase === 'game')  // poll on-chain state during game

  // ── v5 mint prices/rates for the LOBBY ──────────────────────────────────────
  // The 2s game-poll only runs in-game; minting happens from the lobby, so we
  // keep prices+rates fresh here (every 30s while not in-game) — both for the
  // "1 HEIST = $X" display AND the exact mint payment amount.
  const [lobbyPrices, setLobbyPrices] = useState<Record<string, { full: string; mtrx: string }> | null>(null)
  const [lobbyRates, setLobbyRates] = useState<Record<string, string> | null>(null)
  useEffect(() => {
    if (phase === 'game') return
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/session-state')
        if (r.ok) { const d = await r.json(); if (d.ok && alive) { setLobbyPrices(d.prices || null); setLobbyRates(d.rates || null) } }
      } catch { }
    }
    load()
    const t = setInterval(load, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [phase])
  const mintPrices = onChainSession?.prices ?? lobbyPrices
  const mintRates = onChainSession?.rates ?? lobbyRates

  // ── v5 mint cost display: per-device cost in the SELECTED token + live rates ──
  const mintCostLabel = useMemo(() => {
    if (chain === 'solana') return `${mintCount}× $${(mintCount * (mtrxDelegated ? 0.25 : 0.5)).toFixed(2)} SOL`
    const isDisc = isDiscountEligible
    const pricePer = isDisc ? 0.25 : 0.50
    const totalUsd = mintCount * pricePer
    if (mintToken === 'ETH') {
      const estEth = ((totalUsd / 2500) * 1.05).toFixed(5)
      return `${mintCount}× $${pricePer.toFixed(2)} (~${estEth} ETH) · $${totalUsd.toFixed(2)}${isDisc ? ' (50% OFF)' : ''}`
    }
    if (mintToken === 'X') {
      const pricePerX = isDisc ? 25 : 50
      const totalX = mintCount * pricePerX
      return `${totalX} X · $${totalUsd.toFixed(2)}${isDisc ? ' (50% OFF)' : ''}`
    }
    return `${totalUsd.toFixed(2)} ${mintToken} · $${totalUsd.toFixed(2)}${isDisc ? ' (50% OFF)' : ''}`
  }, [chain, mintCount, mintToken, mtrxDelegated, isDiscountEligible])

  // ── Persist & restore state ──────────────────────────────────────────────
  const resumeRef = useRef(false)
  const restoredNumsRef = useRef<number[]>([])  // holds saved calledNums for resume sync
  const restoredPreGameSecsRef = useRef<number>(0)  // >0 means reload happened during pre-game
  const restoredTimerRef = useRef<number>(60)            // saved round timer for mid-game resume
  const pendingAnnounce = useRef<string[]>([])              // win announcements queued for next round
  const startRoundRef = useRef<() => void>(() => { })               // stable ref to startRound
  const masterRef = useRef<ReturnType<typeof setInterval> | null>(null)  // ONE master clock
  const clockPhaseRef = useRef<'idle' | 'pregame' | 'round'>('idle')       // master clock state

  useEffect(() => {
    const s = loadState()
    if (!s) return
    if (s.nickname) setNickname(s.nickname)
    // wallet restored from adapter, not localStorage
    if (s.mintToken) setMintToken(s.mintToken)
    if (s.solAddress) setSolAddress(s.solAddress)
    if (s.mtrxDelegated !== undefined) setMtrxDelegated(s.mtrxDelegated)
    if (s.mtrxBalance !== undefined) setMtrxBalance(s.mtrxBalance)
    if (s.contractAddr) setContractAddr(s.contractAddr)
    // Restore devices with claimed Sets
    if (s.devices && s.devices.length > 0) {
      const rehydrated = s.devices.map((d: any) => ({ ...d, claimed: new Set(d.claimed ?? []), missed: d.missed ?? false }))
      setDevices(rehydrated)
    }
    // Restore game progress
    if (s.calledNums && s.calledNums.length > 0) {
      setCalledNums(new Set(s.calledNums as number[]))
      setCalledOrder(s.calledOrder ?? [])
      restoredNumsRef.current = s.calledNums as number[]  // for resume drawnRef sync
    }
    if (s.winStates) {
      // Rehydrate winStates — ensure all fields exist with defaults
      const ws = s.winStates as Record<WinType, any>
      const fixed: Record<string, WinState> = {}
        ; (Object.keys(defaultWinStates()) as WinType[]).forEach(k => {
          fixed[k] = {
            claimed: ws[k]?.claimed ?? false,
            claimable: ws[k]?.claimable ?? false,
            flickering: false,  // never restore flickering — start clean
            broken: ws[k]?.broken ?? false,
            expired: ws[k]?.expired ?? false,
            claimers: ws[k]?.claimers ?? [],
            bursting: false,    // never restore burst animation — start clean
          }
        })
      setWinStates(fixed as Record<WinType, WinState>)
    }
    if (s.winRecords) setWinRecords(s.winRecords)
    if (typeof s.bankruptCount === 'number') setBankruptCount(s.bankruptCount)
    if (typeof s.roundNum === 'number') setRoundNum(s.roundNum)
    if (s.phase === 'game') {
      setPhase('game')
      const elapsed = s.savedAt ? Math.floor((Date.now() - s.savedAt) / 1000) : 0
      const hasDrawn = (s.calledNums && s.calledNums.length > 0)
      if (!hasDrawn) {
        // PRE-GAME: no numbers drawn — resume countdown (60s fresh start, elapsed accounted)
        const remaining = Math.max(60 - elapsed, 3)
        restoredPreGameSecsRef.current = remaining
      } else {
        // MID-GAME: resume round timer from saved position
        const savedTimer = typeof s.timer === 'number' ? s.timer : 60
        const resumeTimer = Math.max(savedTimer - elapsed, 1)
        if (typeof s.totalTimer === 'number') setTotalTimer(s.totalTimer)
        setTimer(resumeTimer)
        restoredTimerRef.current = resumeTimer
        restoredPreGameSecsRef.current = 0
      }
      resumeRef.current = true
    } else if (s.phase && s.phase !== 'setup') {
      setPhase(s.phase)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])



  // Save ALL game state on every meaningful change
  useEffect(() => {
    if (phase === 'setup') return
    saveState({
      nickname, phase, mintToken, contractAddr, solAddress, mtrxDelegated, mtrxBalance,
      devices: devices.map(d => ({ ...d, claimed: Array.from(d.claimed) })),
      calledNums: Array.from(calledNums),
      calledOrder,
      winStates,
      winRecords,
      bankruptCount,
      roundNum,
      timer,
      totalTimer,
      savedAt: Date.now(),
    })
  }, [nickname, phase, mintToken, contractAddr, devices, calledNums, calledOrder, winStates, winRecords, bankruptCount, roundNum, timer, totalTimer])
  const currentNum = calledOrder[calledOrder.length - 1] ?? null
  const hourCd = useHourCountdown()

  const announce = (msg: string) => { setAnnouncement(msg); setTimeout(() => setAnnouncement(null), 6000) }

  const drawnRef = useRef<Set<number>>(new Set())  // source-of-truth to prevent duplicates
  const drawLockRef = useRef(false)               // prevent concurrent draws

  const drawNumber = useCallback(() => {
    if (drawLockRef.current) return
    drawLockRef.current = true
    setRoundNum(r => r + 1)
    setClickWindowOpen(false)
    const already = drawnRef.current
    if (already.size >= 90) { setBankHacked(true); drawLockRef.current = false; return }
    const remaining = Array.from({ length: 90 }, (_, i) => i + 1).filter(n => !already.has(n))
    if (!remaining.length) { setBankHacked(true); drawLockRef.current = false; return }
    const num = remaining[Math.floor(Math.random() * remaining.length)]
    drawnRef.current = new Set(Array.from(already).concat([num]))
    setCalledOrder(o => [...o, num])
    setCalledNums(new Set(Array.from(drawnRef.current)))
    setDevices(ds => ds.map(d => {
      if (!d.active || d.corrupted) return d
      return { ...d, grid: d.grid.map(row => row.map(cell => cell.num === num ? { ...cell, matched: true } : cell)) }
    }))
    // On new round: process claimed→filament, announce winners, expire unclaimed wins
    setWinStates(prev => {
      const next = { ...prev }
        ; (Object.keys(next) as WinType[]).forEach(wt => {
          if (next[wt].claimed && next[wt].bursting) {
            // Claiming devices: burst→filament. Flicker stops for all, broken goes bright
            next[wt] = { ...next[wt], flickering: false, bursting: false, broken: true }
          } else if (next[wt].claimable && !next[wt].claimed && !next[wt].expired) {
            // Unclaimed claimable: lightning blink then expire
            next[wt] = { ...next[wt], claimable: false, flickering: true, expired: false }
            setTimeout(() => {
              setWinStates(p => ({ ...p, [wt]: { ...p[wt], flickering: false, expired: true } }))
            }, 400)
          }
        })
      return next
    })
    // Announce queued winners now (start of new round)
    if (pendingAnnounce.current.length > 0) {
      pendingAnnounce.current.forEach(msg => announce(msg))
      pendingAnnounce.current = []
    }
    setTimeout(() => { setClickWindowOpen(true); drawLockRef.current = false }, 150)
  }, [])

  useEffect(() => {
    if (!bankHacked) return
    stopMaster()
    setClickWindowOpen(false)
    announce(`🏦 BANK HACKED! ALL 90 DRAWN!\n💸 Unclaimed → ${CLAIM_WALLET.slice(0, 8)}...${CLAIM_WALLET.slice(-6)}\n🗑 NFT devices unlinked — session ended\nReturning to lobby...`)
    setTimeout(() => {
      pendingAnnounce.current = []
      setDevices([])  // trash NFT devices — session ended
      setChatRooms([])  // game over — rooms are wiped
      setPhase('lobby'); setBankHacked(false); setCalledNums(new Set()); setCalledOrder([])
      setWinStates(defaultWinStates()); setWinRecords([]); setRoundNum(0); setBankruptCount(0)
    }, 8000)
  }, [bankHacked])

  const stopSessionClock = useCallback(() => {
    if (sessionTimerRef.current) { clearInterval(sessionTimerRef.current); sessionTimerRef.current = null }
  }, [])

  const startSessionClock = useCallback(() => {
    sessionStartRef.current = Date.now()
    setSessionSecs(0)
    stopSessionClock()
    sessionTimerRef.current = setInterval(() => {
      setSessionSecs(Math.floor((Date.now() - sessionStartRef.current) / 1000))
    }, 1000)
  }, [stopSessionClock])

  // ── MASTER CLOCK ──────────────────────────────────────────────────────────
  // One interval drives pre-game countdown AND round countdown.
  // Switching phases is atomic — no drift between two separate setIntervals.
  const stopMaster = useCallback(() => {
    if (masterRef.current) { clearInterval(masterRef.current); masterRef.current = null }
    clockPhaseRef.current = 'idle'
  }, [])

  const beginRound = useCallback(() => {
    // Called when it's time to draw a number and run a 60s round
    drawNumber()        // draw first
    setTimer(60)        // clock reset in same render batch — guaranteed sync
    setTotalTimer(60)
    clockPhaseRef.current = 'round'
  }, [drawNumber])

  // Keep startRoundRef pointing at beginRound for legacy resume paths
  useEffect(() => { startRoundRef.current = beginRound }, [beginRound])

  const startPreGame = useCallback((secs: number) => {
    stopMaster()
    clockPhaseRef.current = 'pregame'
    setPreGameSecs(secs)
    setTimer(60); setTotalTimer(60)
    masterRef.current = setInterval(() => {
      if (clockPhaseRef.current === 'pregame') {
        setPreGameSecs(p => {
          if (p <= 1) {
            // Pre-game done — switch to first round atomically in this same tick
            clockPhaseRef.current = 'round'
            startSessionClock()
            drawNumber()       // draw number NOW
            setTimer(60)       // clock resets NOW — same JS tick, same React batch
            setTotalTimer(60)
            return 0
          }
          return p - 1
        })
      } else if (clockPhaseRef.current === 'round') {
        setTimer(prev => {
          if (prev <= 1) {
            // Round done — draw next number, reset clock atomically
            setClickWindowOpen(false)
            drawNumber()
            setTimer(60)
            setTotalTimer(60)
            return 60
          }
          return prev - 1
        })
      }
    }, 1000)
  }, [stopMaster, startSessionClock, drawNumber])

  // Resume game after page reload — fires whenever devices state settles with resumeRef flagged
  useEffect(() => {
    if (!resumeRef.current) return
    if (phase !== 'game') return
    resumeRef.current = false
    // Clear any stale timers
    stopMaster()
    // Short delay so React fully commits restored device state
    const t = setTimeout(() => {
      if (restoredPreGameSecsRef.current > 0) {
        // PRE-GAME RESUME: countdown was running, pick up where it left off
        const remaining = restoredPreGameSecsRef.current
        restoredPreGameSecsRef.current = 0
        drawnRef.current = new Set()
        setClickWindowOpen(false)
        // Resume via master clock — same atomic pre-game flow
        startPreGame(remaining)
      } else {
        // MID-GAME RESUME: numbers already drawn, resume draw interval
        drawnRef.current = new Set(restoredNumsRef.current.length > 0 ? restoredNumsRef.current : Array.from(calledNums))
        setDevices(ds => ds.map(d => ({
          ...d,
          grid: d.grid.map(row => row.map(cell =>
            cell.matched && !cell.clicked ? { ...cell, missed: true } : cell
          ))
        })))
        const rt = restoredTimerRef.current > 0 ? restoredTimerRef.current : 60
        drawLockRef.current = false
        startSessionClock()
        setPreGameSecs(0); setTotalTimer(60); setTimer(rt)
        setClickWindowOpen(restoredNumsRef.current.length > 0)
        // Resume mid-game via master clock at remaining seconds
        stopMaster()
        clockPhaseRef.current = 'round'
        masterRef.current = setInterval(() => {
          if (clockPhaseRef.current === 'round') {
            setTimer(prev => {
              if (prev <= 1) {
                setClickWindowOpen(false)
                drawNumber()
                setTimer(60); setTotalTimer(60)
                return 60
              }
              return prev - 1
            })
          }
        }, 1000)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [phase, drawNumber])


  const warnedRef = useRef(false)  // tracks 57-min warning fired

  // ── 57/58 minute session enforcement ──────────────────────────────────────
  useEffect(() => {
    if (phase !== 'game' || showEndScreen) return
    if (sessionSecs >= (3420) && !warnedRef.current) {
      warnedRef.current = true
      announce(`⚠️ SECURITY BREACH TRACKER DETECTED\n🚨 HACK SESSION ENDING IN 60 SECONDS\nAll active ransoms will be auto-liquidated`)
    }
    if (sessionSecs >= 3480) {
      // Hard stop — end session now
      stopMaster(); stopSessionClock()
      setClickWindowOpen(false)
      setShowEndScreen(true)
      // Deactivate all devices
      setDevices(ds => ds.map(d => ({ ...d, active: false })))
      // Build final payout: split remaining vault equally among all winners
      // If no winners, full vault to CLAIM_WALLET
      setWinRecords(wr => {
        const allWinners = Array.from(new Set(wr.flatMap(r => r.claimers)))
        const totalPaid = wr.reduce((s, r) => s + r.split * r.claimers.length, 0)
        const remaining = Math.max((onChainSession?.vaultTotal ?? VAULT_ESTIMATE) - totalPaid, 0)
        if (remaining > 0) {
          const dest = allWinners.length > 0 ? allWinners : [CLAIM_WALLET.slice(0, 8) + '…']
          const cut = Math.floor(remaining / dest.length)
          announce(`🚨 DECENTERILZIED VAULT HIJACKED BY TOP HACKERS\n💸 ${(remaining / 1000).toFixed(0)}K split:\n${dest.map(w => `  ${w} → $${(cut / 1000).toFixed(0)}K`).join('\n')}`)
        }
        return wr
      })
      // Return to lobby after 60s
      setTimeout(() => {
        stopSessionClock()
        warnedRef.current = false
        setShowEndScreen(false)
        setDevices([])
        setCalledNums(new Set())
        setCalledOrder([])
        setWinStates(defaultWinStates())
        setWinRecords([])
        setRoundNum(0)
        setBankruptCount(0)
        setChatRooms([])  // game over — rooms are wiped
        setPhase('lobby')
        try { localStorage.removeItem('ransome_state_v1') } catch { }
      }, 60000)
    }
  }, [phase, sessionSecs, showEndScreen, stopSessionClock])


  // ── All bankrupts claimed → show end screen ───────────────────────────────
  useEffect(() => {
    if (phase !== 'game' || bankruptCount < 3 || showEndScreen) return
    stopMaster(); stopSessionClock()
    setClickWindowOpen(false)
    setShowEndScreen(true)
    setDevices(ds => ds.map(d => ({ ...d, active: false })))
    announce(`🏆 ALL RANSOMS CLAIMED!\n💰 Final vault summary broadcasting...\nSession ending in 60 seconds`)
    setTimeout(() => {
      stopSessionClock()
      warnedRef.current = false
      setShowEndScreen(false)
      setDevices([])
      setCalledNums(new Set())
      setCalledOrder([])
      setWinStates(defaultWinStates())
      setWinRecords([])
      setRoundNum(0)
      setBankruptCount(0)
      setChatRooms([])  // game over — rooms are wiped
      setPhase('lobby')
      try { localStorage.removeItem('ransome_state_v1') } catch { }
    }, 60000)
  }, [phase, bankruptCount, showEndScreen, stopSessionClock])


  // ── Auto-launch: when lobby countdown hits 0, enter game if devices minted ──
  const autoLaunchedRef = useRef(false)
  useEffect(() => {
    if (phase !== 'lobby') return
    if (lobbyCountdown <= 1 && !autoLaunchedRef.current && devices.length > 0) {
      autoLaunchedRef.current = true
      announce('🚀 BATCH LAUNCHING — TRANSFERRING TO HACK MATRIX')
      setTimeout(() => enterGame(), 1200)
    }
    if (lobbyCountdown > 5 && !DEV_MODE) autoLaunchedRef.current = false  // reset for next cycle (skip in dev mode)
  }, [phase, lobbyCountdown, devices.length])


  // ── Sync on-chain numbers to frontend ─────────────────────────────────────
  // When the cron draws a new number on-chain, push it to the local game state
  const lastOnChainNumRef = useRef<number>(0)
  useEffect(() => {
    if (!onChainSession || phase !== 'game' || preGameSecs > 0) return
    const newNum = onChainSession.lastNumber
    if (newNum > 0 && newNum !== lastOnChainNumRef.current) {
      lastOnChainNumRef.current = newNum
      // If this number isn't already in our local state, add it
      if (!drawnRef.current.has(newNum)) {
        drawLockRef.current = false  // allow the draw
        // Directly update state with on-chain number (bypass Math.random)
        drawnRef.current = new Set(Array.from(drawnRef.current).concat([newNum]))
        setCalledOrder(o => [...o, newNum])
        setCalledNums(new Set(Array.from(drawnRef.current)))
        setRoundNum(r => r + 1)
        setDevices(ds => ds.map(d => {
          if (!d.active || d.corrupted) return d
          return { ...d, grid: d.grid.map(row => row.map(cell => cell.num === newNum ? { ...cell, matched: true } : cell)) }
        }))
        // Reset timer to 60 and open click window
        setTimer(60); setTotalTimer(60)
        setTimeout(() => setClickWindowOpen(true), 150)
      }
    }
    // Sync draw count — if on-chain shows all numbers drawn
    const maxD = onChainSession.maxDraws || 59
    if (onChainSession.drawCount >= maxD && !bankHacked) {
      setBankHacked(true)
    }
    // v6: 58th minute announcement — warn players game is ending
    if (onChainSession.drawCount === maxD - 1 && phase === 'game') {
      announce('⚠️ FINAL NUMBER — claim your wins NOW!')
    }
  }, [onChainSession, phase, preGameSecs, bankHacked])

  // Win detection
  useEffect(() => {
    if (phase !== 'game') return
    setWinStates(prev => {
      const next = { ...prev }; let ann = false
      devices.forEach(d => {
        if (!d.active || d.corrupted) return
        const all = d.grid.flat(), nc = all.filter(c => c.clicked)
        const triggerWin = (wt: WinType, msg: string) => {
          if (next[wt].claimable || next[wt].claimed || next[wt].expired) return
          // Win achieved: flicker ALL active device LEDs for this win type this round
          // Expiry happens automatically when next number is drawn (in drawNumber)
          next[wt] = { ...next[wt], claimable: true, flickering: true }
          if (!ann) { announce(msg); ann = true }
        }
        if (nc.length >= 5) triggerWin('EARLY_FIVE', `⚡ ${d.nftId} — EARLY FIVE! CLAIM NOW`)
        if (d.grid[0].filter(cl => cl.num).every(cl => cl.clicked)) triggerWin('TOP_LINE', `⚡ ${d.nftId} — TOP LINE! CLAIM NOW`)
        if (d.grid[1].filter(cl => cl.num).every(cl => cl.clicked)) triggerWin('MIDDLE_LINE', `⚡ ${d.nftId} — MIDDLE LINE! CLAIM NOW`)
        if (d.grid[2].filter(cl => cl.num).every(cl => cl.clicked)) triggerWin('BOTTOM_LINE', `⚡ ${d.nftId} — BOTTOM LINE! CLAIM NOW`)
        if (all.filter(cl => cl.num).every(cl => cl.clicked)) { const fk = `FULL_HOUSE_${Math.min(bankruptCount + 1, 3)}` as WinType; triggerWin(fk, `🔥 ${d.nftId} — FULL HOUSE! CLAIM NOW`) }
      })
      return next
    })
  }, [devices, phase])

  const handleCellClick = (devId: number, r: number, c: number) => {
    if (!clickWindowOpen || !currentNum) return
    setDevices(ds => ds.map(d => {
      if (d.id !== devId || !d.active) return d
      const cell = d.grid[r][c]
      if (!cell.num || cell.num !== currentNum || cell.clicked || cell.missed) return d
      return { ...d, grid: d.grid.map((row, ri) => row.map((cl, ci) => ri === r && ci === c ? { ...cl, clicked: true } : cl)) }
    }))
  }

  // Claim: accumulate claimers within same round, then split on-chain after debounce
  const handleClaim = async (devId: number, wt: WinType) => {
    if (winStates[wt].claimed) return
    const dev = devices.find(d => d.id === devId)
    if (!dev) return
    // Add to pending claimers for this win type
    const claimers = pendingClaimers.current[wt]
    if (!claimers.includes(dev.nftId)) {
      claimers.push(dev.nftId)
      setDevices(ds => ds.map(d => d.id !== devId ? d : { ...d, claimed: new Set(Array.from(d.claimed).concat([wt])) }))
    }
    if (wt.startsWith('FULL_HOUSE')) setBankruptCount(b => Math.min(b + 1, 3))

    // Debounce: wait 500ms for other same-round claimers, then execute on-chain split
    const key = `claim_${wt}`
    if (roundTimers.current[key]) clearTimeout(roundTimers.current[key])
    roundTimers.current[key] = setTimeout(async () => {
      const final = [...pendingClaimers.current[wt]]
      pendingClaimers.current[wt] = []
      if (final.length === 0) return

      // Collect wallet addresses for each claimer NFT
      const winnerAddresses: string[] = []
      for (const nftId of final) {
        const d = devices.find(dd => dd.nftId === nftId)
        const addr = d?.walletAddr
        if (addr) winnerAddresses.push(addr)
      }

      // ── Server-verified claim — held in vault, paid at round end ─────────
      if (winnerAddresses.length > 0) {
        let verified = 0, lastEst = 0
        for (const addr of [...new Set(winnerAddresses)]) {
          try {
            const res = await fetch('/api/claim-sui', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ wallet: addr, winType: WIN_TYPE_INDEX[wt] ?? 0 }),
            })
            const data = await res.json()
            if (data.ok) { verified++; lastEst = data.estPayout || lastEst }
            else console.error('Claim rejected:', data.error)
          } catch (e: any) { console.error('Claim fetch error:', e.message) }
        }
        if (verified > 0) {
          announce(`✅ RANSOM HELD IN DECENTERILZIED VAULT!\n${WIN_LABELS[wt]}\n${verified} wallet${verified > 1 ? 's' : ''} verified\n≈ ${(lastEst / 1e9).toFixed(0)} HEIST est. · claim from Decenterilzied vault before next round`)
        }
      }

      // ── Frontend state update (HEIST tokens from vault balance) ──────────
      // Vault holds SUI/USDC — convert to HEIST at market rate
      const vaultUsdc = onChainSession?.vaultTotal ?? 0
      // Convert vault MIST → SUI → USD → HEIST
      const vaultHeist = Math.max(0, Math.floor(vaultUsdc / 1e9)) // vault holds raw HEIST (v4)
      const bps = WIN_BPS[wt]
      const totalPayoutHeist = Math.floor(vaultHeist * bps / 10_000)
      const splitHeist = Math.floor(totalPayoutHeist / Math.max(final.length, 1))
      setWinRecords(r => [...r, { wt, claimers: final, round: roundNum, split: splitHeist, heistEach: splitHeist }])
      const walletSnip = (addr: string | null) => addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '?'
      const claimerLines = final.map(nftId => {
        const dev2 = devices.find(d => d.nftId === nftId)
        return `  ${nftId} (${walletSnip(dev2?.walletAddr ?? null)}) → ${splitHeist} HEIST`
      }).join('\n')
      pendingAnnounce.current.push(`🏆 ${WIN_LABELS[wt]} — ROUND ${roundNum}\n${claimerLines}\n💸 Vault → wallets`)
      setWinStates(prev => ({ ...prev, [wt]: { ...prev[wt], claimed: true, claimers: final, flickering: true, broken: false, bursting: true } }))
    }, 500)
  }

  const handleActivate = (devId: number) => {
    setDevices(ds => ds.map(d => d.id !== devId ? d : { ...d, active: true }))
    const dev = devices.find(d => d.id === devId)
    announce(`⚡ ${dev?.nftId} CONNECTED`)
  }

  const handleActivateAll = () => {
    setDevices(ds => ds.map(d => ({ ...d, active: true })))
    announce(`⚡ ALL ${devices.length} DEVICES CONNECTED`)
  }

  // ─── DEV tools (testnet faucet testing) ────────────────────────────────
  // Draw the next on-chain number immediately + trigger round-end settlement
  // so the split across wallets can be verified without waiting for the cron.
  const devDrawNext = async () => {
    try {
      const r = await fetch('/api/draw')
      const d = await r.json()
      if (d.ok) {
        const mx = onChainSession?.maxDraws || 59
        announce(`⏩ ON-CHAIN DRAW ${d.number} (${d.drawCount}/${mx})`)
      }
      else announce(`⚠ ${d.error || 'draw failed'}`)
    } catch (e: any) { announce('⚠ ' + e.message) }
  }
  const devSettleNow = async () => {
    try {
      const r = await fetch('/api/settle-claims')
      const d = await r.json()
      if (d.ok) announce(`⏭ SETTLE OK — ${(d.results || []).length} win type${(d.results || []).length === 1 ? '' : 's'}`)
      else announce(`⚠ ${d.error || 'settle failed'}`)
    } catch (e: any) { announce('⚠ ' + e.message) }
  }
  // Jump the 59-min UTC lobby clock so rounds cycle instantly.
  // mins=0 → launch immediately (countdown can't reach 0 by formula).
  const devJump = (mins: number) => {
    if (mins <= 0) { enterGame(); return }
    const n = new Date()
    const e = n.getUTCHours() * 3600 + n.getUTCMinutes() * 60 + n.getUTCSeconds()
    setDevClock((LOBBY_CYCLE - mins * 60 - (e % LOBBY_CYCLE) + LOBBY_CYCLE) % LOBBY_CYCLE)
  }

  // ─── SUI wallet connect/disconnect (dapp-kit hooks) ────────────────────
  
  // ─── Mint devices (SUI or Solana) ──────────────────────────────────────
  const mintDevices = async () => {
    const count = mintCount

    // DEV MODE — local-only mint ONLY when no wallet is connected (pure UI testing)
    if (DEV_MODE && !(chain === 'evm' && evmConnected && evmAddress) && !(chain === 'solana' && connected && publicKey)) {
      const nd = Array.from({ length: count }, (_, i) => ({ ...generateDevice(devices.length + i), walletAddr: wallet || 'DEV_LOCAL' }))
      setDevices(p => [...p, ...nd])
      announce(`⚡ ${count} DEVICE${count > 1 ? 'S' : ''} MINTED (DEV) — ${devices.length + count} TOTAL`)
      return
    }

    // EVM chain (Robinhood, Sepolia, etc.) — real on-chain mint via useEvmWallet
    if (chain === 'evm' && evmConnected && evmAddress) {
      try {
        const nd = Array.from({ length: count }, (_, i) => ({ ...generateDevice(devices.length + i), walletAddr: evmAddress }))
        const rawGrids = nd.map(d => d.grid.map(row => row.map(c => c.num || 0)))
        
        const tokenForMint = (['USDG', 'USDC', 'USDT', 'ETH', 'X'].includes(mintToken) ? mintToken : 'ETH') as 'USDG' | 'USDC' | 'USDT' | 'ETH' | 'X'
        
        announce(`⚡ MINTING ${count} DEVICE${count > 1 ? 'S' : ''} WITH ${tokenForMint}...`)
        const result = await mintConsoles(tokenForMint, count, rawGrids)
        const txHash = (result as any)?.receipt?.transactionHash || (result as any)?.mintTx || (result as any)?.tx || 'tx'

        // Register grids server-side so claims can be verified
        try {
          const regRes = await fetch('/api/mint-nft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallet: evmAddress,
              mintTxHash: typeof txHash === 'string' ? txHash : '',
              chain: 'evm',
              solAddress,
              coinType: tokenForMint,
              devices: nd.map(d => ({ grid: d.grid.map(r => r.map(c => c.num)) })),
            }),
          })
          const regData = await regRes.json()
          if (regData.ok && Array.isArray(regData.devices) && regData.devices.length === nd.length) {
            regData.devices.forEach((on: any, i: number) => {
              nd[i] = { ...nd[i], nftId: on.objectId, grid: on.grid.map((row: any) => row.map((n: any) => ({ num: n, matched: false, clicked: false, missed: false }))) }
            })
          }
        } catch { }
        setDevices(p => [...p, ...nd])
        announce(`⚡ ${count} DEVICE${count > 1 ? 'S' : ''} MINTED ON EVM — ${String(txHash).slice(0, 16)}…`)
      } catch (e: any) {
        console.error('[EVM] Mint error:', e)
        announce(`⚠ EVM MINT FAILED: ${e?.shortMessage || e?.message || e}`)
      }
      return
    }

    // Solana chain or fallback — local mint (no on-chain tx for now)
    if (chain === 'solana' && connected && publicKey) {
      try {
        const { PublicKey } = await import('@solana/web3.js')
        const programId = new PublicKey(PROGRAM_ID_STR)
        const nd = Array.from({ length: count }, (_, i) => ({ ...generateDevice(devices.length + i), walletAddr: publicKey.toBase58() }))
        setDevices(p => [...p, ...nd])
        announce(`⚡ ${count} DEVICE${count > 1 ? 'S' : ''} MINTED — BOUND TO ${publicKey.toBase58().slice(0, 8)}`)
      } catch (e: any) {
        announce(`⚠ SOL MINT FAILED: ${e.message}`)
      }
      return
    }

    // No wallet connected — local-only mint
    const nd = Array.from({ length: count }, (_, i) => ({ ...generateDevice(devices.length + i), walletAddr: wallet || 'UNCONNECTED' }))
    setDevices(p => [...p, ...nd])
    announce(`⚡ ${count} DEVICE${count > 1 ? 'S' : ''} MINTED — BOUND TO ${(wallet || 'WALLET').slice(0, 8)}`)
  }

  const enterGame = () => {
    // Clear all previous game state — fresh session (rooms persist)
    setCalledNums(new Set()); setCalledOrder([])
    setWinStates(defaultWinStates()); setWinRecords([]); setRoundNum(0); setBankruptCount(0)
    setBankHacked(false); setClickWindowOpen(false); setShowEndScreen(false)
    drawnRef.current = new Set(); drawLockRef.current = false
    pendingAnnounce.current = []; warnedRef.current = false
    stopSessionClock(); setSessionSecs(0)
    setPhase('game'); startPreGame(60); announce('🔴 HACK IN 60 SECONDS')
  }
  const terminateGame = () => {
    stopMaster(); stopSessionClock()
    try { localStorage.removeItem('ransome_state_v1') } catch { }
    setDevices([]); setCalledNums(new Set()); setCalledOrder([]); setWinStates(defaultWinStates()); setWinRecords([]); setBankHacked(false); setPreGameSecs(0)
    setChatRooms([])  // game over — rooms are wiped
    setShowTerminate(false); setPhase('lobby')
  }

  // v6: Under-construction overlay when game is paused by admin
  const regPaused = onChainSession?.registryPaused
  const regPauseEnd = onChainSession?.registryPauseEndMs || 0
  if (regPaused) {
    const now = Date.now()
    const indefinite = regPauseEnd === 0
    const timeLeft = indefinite ? null : Math.max(0, regPauseEnd - now)
    return (
      <div data-theme={theme} style={{ minHeight: '100vh', background: '#0a0612', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 500, padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔧</div>
          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 28, fontWeight: 800, color: '#f59e0b', marginBottom: 12 }}>UNDER CONSTRUCTION</div>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 11, color: '#a99bc4', lineHeight: 1.8, marginBottom: 20 }}>
            The game is currently paused for maintenance.
            {!indefinite && timeLeft !== null && (
              <><br />Resuming in: <span style={{ color: '#f59e0b', fontWeight: 700 }}>{fmtTime(Math.ceil(timeLeft / 1000))}</span></>
            )}
            {indefinite && <><br />Please check back later.</>}
          </div>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#241538' }}>
            ROBHIN HEIST — MAINTENANCE MODE
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'setup') return (
    <div data-theme={theme} style={{ minHeight: '100vh', background: '#0a0612' }}>
      <NicknameModal onConfirm={name => { setNickname(name); setPhase('lobby') }} />
    </div>
  )

  // ── LOBBY ─────────────────────────────────────────────────────────────────
  if (phase === 'lobby') return (
    <div data-theme={theme} style={{ minHeight: '100vh', background: '#0e0819', color: '#f8fafc', overflow: 'hidden' }}>
      <div className="lobby-topbar" style={{ position: 'fixed', top: 0, left: 0, width: '100%', zIndex: 50, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: 'rgba(5,10,23,0.9)', borderBottom: '1px solid rgba(178,107,255,0.1)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#b26bff' }}>ROBHIN HEIST</span>
          <span style={{ fontSize: 10, color: '#b26bff', borderBottom: '2px solid #b26bff', paddingBottom: 2 }}>NETWORK: ONLINE</span>
          {DEV_MODE && <span style={{ fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 4, padding: '2px 6px', marginLeft: 8 }}>⚠ DEV MODE</span>}
          <span style={{ fontSize: 10, color: 'rgba(178,107,255,0.35)' }}>ENCRYPTION: AES-256</span>
        </div>
        <div className="lobby-topbar-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="mobile-menu-button" onClick={() => setMobileMenuOpen(open => !open)} aria-label={mobileMenuOpen ? 'Close lobby menu' : 'Open lobby menu'} aria-expanded={mobileMenuOpen} title={mobileMenuOpen ? 'Close menu' : 'Open menu'}>
            <span />
            <span />
            <span />
          </button>
          <div style={{ background: 'rgba(24,39,51,0.5)', padding: '4px 10px', border: '1px solid rgba(47,243,173,0.2)', fontSize: 12, color: '#b26bff', fontWeight: 700 }}>{fmtTime(lobbyCountdown)}</div>
          <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Light / dark mode" style={{ background: '#150d24', border: '1px solid #241538', borderRadius: 6, padding: '4px 8px', fontSize: 10, cursor: 'pointer' }}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          {DEV_MODE && <div className="dev-jump-controls" style={{ display: 'flex', gap: 3 }}>
            <button onClick={() => devJump(0)} title="Launch now" style={{ background: '#150d24', border: '1px solid #f59e0b55', borderRadius: 6, padding: '4px 6px', fontSize: 8, cursor: 'pointer', color: '#f59e0b' }}>🚀 NOW</button>
            <button onClick={() => devJump(30)} title="Jump +30 min" style={{ background: '#150d24', border: '1px solid #f59e0b55', borderRadius: 6, padding: '4px 6px', fontSize: 8, cursor: 'pointer', color: '#f59e0b' }}>+30M</button>
            <button onClick={() => devJump(59)} title="Jump +59 min (round boundary)" style={{ background: '#150d24', border: '1px solid #f59e0b55', borderRadius: 6, padding: '4px 6px', fontSize: 8, cursor: 'pointer', color: '#f59e0b' }}>+59M</button>
          </div>}
          <div style={{ fontSize: 10, color: '#a99bc4', background: '#150d24', border: '1px solid #241538', borderRadius: 6, padding: '4px 8px' }}>👤 {nickname}</div>
          {/* Governance button */}
          <a href="/governance" style={{ textDecoration: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: chain === 'evm' ? 'rgba(168,85,247,0.1)' : 'rgba(178,107,255,0.1)', border: `1px solid ${chain === 'evm' ? 'rgba(168,85,247,0.3)' : 'rgba(178,107,255,0.3)'}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 10 }}>🗳</span>
              <span style={{ fontSize: 8, fontWeight: 700, color: chain === 'evm' ? '#a855f7' : '#b26bff' }}>GOVERN</span>
              {mtrxDelegated && <span style={{ fontSize: 8, color: '#a78bfa', background: 'rgba(167,139,250,0.15)', borderRadius: 3, padding: '1px 4px' }}>MTRX</span>}
            </div>
          </a>
          {/* Chain selector */}
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #241538' }}>
            <button onClick={() => setChain('solana')} style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, cursor: 'pointer', background: chain === 'solana' ? '#b26bff20' : 'transparent', color: chain === 'solana' ? '#b26bff' : '#a99bc4', border: 'none' }}>SOL</button>
            <button onClick={() => setChain('evm')} style={{ padding: '4px 8px', fontSize: 9, fontWeight: 700, cursor: 'pointer', background: chain === 'evm' ? '#c084fc20' : 'transparent', color: chain === 'evm' ? '#c084fc' : '#a99bc4', border: 'none', borderLeft: '1px solid #241538' }}>EVM</button>
          </div>
          {/* Wallet connect based on chain */}
          {wallet ? (<div style={{ display: 'flex', gap: 6 }}><div style={{ background: '#150d24', border: `1px solid ${chain === 'evm' ? '#c084fc40' : 'rgba(178,107,255,0.25)'}`, borderRadius: 6, padding: '4px 8px', fontSize: 9, color: chain === 'evm' ? '#c084fc' : '#b26bff' }}>{wallet.slice(0, 6)}…{wallet.slice(-4)}</div><button onClick={() => chain === 'evm' ? disconnectEvm() : disconnect()} style={{ background: 'rgba(255,92,138,0.08)', border: '1px solid rgba(255,92,138,0.25)', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: '#ff5c8a', cursor: 'pointer' }}>✕</button></div>) : (
            chain === 'evm' ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={connectEvm} style={{ background: 'linear-gradient(135deg,#c084fc,#2563eb)', color: '#000', borderRadius: 6, fontSize: 10, fontWeight: 700, height: 'auto', padding: '6px 12px', cursor: 'pointer', border: 'none' }}>CONNECT EVM</button>
                <button onClick={() => setWalletDebug(p => p.length > 0 ? [] : ['Click CONNECT EVM first, then check console (F12)'])} style={{ background: '#150d24', border: '1px solid #c084fc40', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: '#c084fc', cursor: 'pointer', position: 'relative' }} title="Wallet debug">?
                  {walletDebug.length > 0 && <div style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, borderRadius: '50%', background: '#c084fc', fontSize: 8, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{walletDebug.length}</div>}
                </button>
              </div>
            ) : (
              <WalletMultiButton />
            )
          )}
        </div>
      </div>
      <div className="mobile-vault-status">
        <div className="mobile-vault-heading">
          <span>💎 DECENTERILZIED VAULT</span>
          <span className="mobile-vault-countdown">{lobbyCountdown <= 60 ? '🚀 LAUNCHING' : `NEXT ${fmtTime(lobbyCountdown)}`}</span>
        </div>
        <div className="mobile-vault-content">
          <div className="mobile-vault-graphic">
            <div className="mobile-vault-fill" style={{ height: `${lobbyFill * 100}%` }} />
            <VaultSketch pct={lobbyFill} paid={Math.round(lobbyFill * 1000000)} />
          </div>
          <div className="mobile-vault-stats">
            <div><span>OPERATIVES</span><strong>2,104</strong></div>
            <div><span>SUCCESS</span><strong>92.4%</strong></div>
            <div><span>LAST BREACH</span><strong>+450 SOL</strong></div>
            <div><span>THREAT</span><strong>LOW</strong></div>
          </div>
        </div>
        <div className="mobile-vault-claim">
          <VaultClaimPanel wallet={wallet} announce={announce} />
        </div>
      </div>
      {/* Wallet debug panel */}
      {walletDebug.length > 0 && chain === 'evm' && !wallet && (
        <div style={{ margin: '0 24px', padding: '8px 12px', background: '#0a0f1a', border: '1px solid #c084fc30', borderRadius: 8, maxHeight: 120, overflowY: 'auto' }}>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#c084fc', fontWeight: 700, marginBottom: 4 }}>🔍 WALLET DETECTION LOG</div>
          {walletDebug.map((line, i) => (
            <div key={i} style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: line.includes('error') || line.includes('Error') ? '#ff5c8a' : line.includes('CONNECTED') ? '#a78bfa' : '#a99bc4', lineHeight: 1.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', paddingTop: 56 }}>
        <div className={`lobby-sidebar${mobileMenuOpen ? ' mobile-open' : ''}`} style={{ width: 200, minHeight: 'calc(100vh - 56px)', background: '#150d24', borderRight: '1px solid rgba(178,107,255,0.08)', display: 'flex', flexDirection: 'column', padding: '16px 0', flexShrink: 0 }}>
          <div className="lobby-operative" style={{ padding: '0 16px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 32, height: 32, background: '#1f1330', border: '1px solid rgba(178,107,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🎭</div>
            <div><div style={{ color: '#b26bff', fontWeight: 700, fontSize: 10 }}>OPERATIVE</div><div style={{ color: '#7d6b99', fontSize: 9 }}>{nickname.slice(0, 10).toUpperCase()}</div></div>
          </div>
          {/* Decentralized Vault — mobile only: listed under OPERATIVE (desktop shows the right-extreme vault panel) */}
          <div className="sidebar-vault-card" onClick={() => { setNavTab('vault'); setMobileMenuOpen(false) }} style={{ margin: '0 12px 10px', padding: '8px 10px', cursor: 'pointer', background: '#241538', border: '1px solid rgba(178,107,255,0.14)', borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 11 }}>💎</span>
              <span style={{ fontSize: 8.5, fontWeight: 700, color: '#f8fafc' }}>DECENTERILZIED VAULT</span>
            </div>
            <div style={{ position: 'relative', height: 54, background: '#0e0819', border: '1px solid rgba(36,21,56,0.2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: (lobbyFill * 100) + '%', background: 'linear-gradient(180deg,#d3b0ff,#5b21b6)', opacity: 0.2, transition: 'height 1s linear' }} />
              <VaultSketch pct={lobbyFill} paid={Math.round(lobbyFill * 1000000)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 7, color: '#a99bc4' }}>OPERATIVES <strong style={{ color: '#b26bff' }}>2,104</strong></span>
              <span style={{ fontSize: 7, color: '#a99bc4' }}>NEXT <strong style={{ color: '#fff' }}>{fmtTime(lobbyCountdown)}</strong></span>
            </div>
            <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,209,102,0.15)', paddingTop: 5 }}>
              <VaultClaimPanel wallet={wallet} announce={announce} />
            </div>
          </div>
          {(['💎 VAULT', '📋 MISSIONS', '🕵️ HEIST LIST', '💰 QUICK MINT'] as const).map((item, i) => {
            const tab = (['vault', 'missions', 'heist', 'quick-mint'] as const)[i]
            const active = navTab === tab
            return (<div className={`lobby-nav-item${mobileMenuOpen ? ' is-open' : ''}`} key={item} onClick={() => { setNavTab(tab); setMobileMenuOpen(false) }} style={{ padding: '10px 16px', cursor: 'pointer', color: active ? '#b26bff' : '#7d6b99', fontWeight: active ? 700 : 400, fontSize: 11, borderRight: active ? '2px solid #b26bff' : 'none', background: active ? 'rgba(178,107,255,0.06)' : 'transparent', transition: 'all 0.15s' }}>{['💎 ', '📋 ', '🕵️ ', '💰 '][i]}{item}</div>)
          })}
          {/* Quick Mint Panel */}
          {navTab === 'quick-mint' && (
            <div style={{
              padding: '12px',
              background: 'rgba(17,24,39, 0.88)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(178,107,255,0.3)',
              borderRadius: 8,
              boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
              zIndex: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              <div style={{
                padding: '8px 10px',
                background: 'linear-gradient(180deg, rgba(178,107,255,0.14), rgba(4,18,34,0.95))',
                borderBottom: '1px solid rgba(178,107,255,0.25)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: '#b26bff', letterSpacing: '0.05em' }}>QUICK MINT</span>
                <span style={{ fontSize: 7, color: '#ffd166', background: 'rgba(255,209,102,0.12)', padding: '1px 4px', borderRadius: 3 }}>
                  {mintToken || 'ETH'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="keyboard-key keyboard-key-accent"
                  onClick={() => {
                    mintDevices()
                  }}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 10,
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    boxShadow: '0 4px 20px rgba(178,107,255,0.3)'
                  }}
                >
                  <span>MINT {mintCount}×</span>
                </button>

                {/* Caliber Keys — keyboard-key steppers (scroll wheel still works) */}
                <div
                  onWheel={e => {
                    if (e.deltaY < 0) setMintCount(c => Math.min(20, c + 1))
                    else setMintCount(c => Math.max(1, c - 1))
                  }}
                  style={{
                    width: 46,
                    background: '#150d24',
                    border: '1px solid #b26bff40',
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    padding: '4px 2px',
                    userSelect: 'none'
                  }}
                  title="▲ / ▼ keys or scroll to change amount"
                >
                  <button
                    className="keyboard-key keyboard-key-sm"
                    aria-label="Increase mint amount"
                    onClick={() => setMintCount(c => Math.min(20, c + 1))}
                    disabled={mintCount >= 20}
                    style={{
                      width: 28,
                      height: 16,
                      padding: 0,
                      background: 'linear-gradient(180deg,#2d1f4a,#1f1330)',
                      border: '1px solid #b26bff55',
                      borderTop: '1px solid #b26bffaa',
                      borderRadius: 4,
                      color: '#b26bff',
                      fontSize: 8,
                      fontWeight: 800,
                      lineHeight: 1,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >▲</button>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#b26bff', fontFamily: 'DM Mono,monospace', lineHeight: 1 }}>{mintCount}</div>
                  <button
                    className="keyboard-key keyboard-key-sm"
                    aria-label="Decrease mint amount"
                    onClick={() => setMintCount(c => Math.max(1, c - 1))}
                    disabled={mintCount <= 1}
                    style={{
                      width: 28,
                      height: 16,
                      padding: 0,
                      background: 'linear-gradient(180deg,#2d1f4a,#1f1330)',
                      border: '1px solid #b26bff55',
                      borderBottom: '1px solid #b26bffaa',
                      borderRadius: 4,
                      color: '#b26bff',
                      fontSize: 8,
                      fontWeight: 800,
                      lineHeight: 1,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >▼</button>
                </div>
              </div>
            </div>
          )}
          <div style={{ marginTop: 'auto', padding: '0 12px 16px' }}>
            {(DEV_MODE || lobbyCountdown <= 60) && devices.length > 0 ? (<button onClick={enterGame} className="keyboard-key keyboard-key-danger" style={{ width: '100%', padding: '8px 0', fontSize: 10, animation: DEV_MODE ? 'none' : 'ledBlink 0.6s infinite' }}>ENTER MATRIX</button>) : DEV_MODE ? (<button onClick={enterGame} className="keyboard-key keyboard-key-danger" style={{ width: '100%', padding: '8px 0', fontSize: 10 }}>ENTER MATRIX (DEV)</button>) : (<div style={{ padding: '8px', background: 'rgba(178,107,255,0.06)', border: '1px solid rgba(178,107,255,0.2)', color: '#b26bff', fontSize: 9, textAlign: 'center' }}>INITIALIZE_HEIST</div>)}
          </div>
        </div>
        {navTab === 'operative' && <div className="lobby-operative-layout" style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }}>
          <div className="lobby-hud-container" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <LobbyMapWithOverlays
              nickname={nickname}
              currentHour={currentHour}
              liveBank={liveBank}
              selectedBank={selectedBank}
              setSelectedBank={setSelectedBank}
              lobbyCountdown={lobbyCountdown}
              onEnterGame={enterGame}
              devices={devices}
              mintToken={mintToken}
              setMintToken={setMintToken}
              onQuickMint={(count) => {
                setMintCount(count)
                setTimeout(() => {
                  mintDevices()
                }, 100)
              }}
              mintCostLabel={mintCostLabel}
              chatRooms={chatRooms}
              onCreateRoom={r => setChatRooms(p => [...p, r])}
              onCloseRoom={id => setChatRooms(p => p.filter(r => r.id !== id))}
            />
          </div>
          {/* Right-extreme Decentralized Vault panel (desktop) */}
          <div className="lobby-vault-panel" style={{ background: '#150d24', border: '1px solid rgba(36,21,56,0.2)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ fontSize: 13 }}>💎</span><span style={{ fontSize: 11, fontWeight: 700, color: '#f8fafc' }}>DECENTERILZIED VAULT</span></div>
            <div style={{ position: 'relative', background: '#0e0819', border: '1px solid rgba(36,21,56,0.15)', height: 120, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: (lobbyFill * 100) + '%', background: 'linear-gradient(180deg,#d3b0ff,#5b21b6)', opacity: 0.2, transition: 'height 1s linear' }} />
              <VaultSketch pct={lobbyFill} paid={Math.round(lobbyFill * 1000000)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <div style={{ textAlign: 'center' }}><div style={{ fontSize: 8, color: '#7d6b99' }}>Operatives</div><div style={{ fontSize: 16, fontWeight: 700, color: '#b26bff' }}>2,104</div></div>
              <div style={{ textAlign: 'center' }}><div style={{ fontSize: 8, color: '#7d6b99' }}>Success</div><div style={{ fontSize: 16, fontWeight: 700, color: '#c084fc' }}>92.4%</div></div>
            </div>
            {[{ l: 'LAST BREACH', v: '+450 SOL', c: '#b26bff' }, { l: 'THREAT', v: 'LOW', c: '#ff6daf' }].map(r => (<div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', background: '#1f1330', borderLeft: '2px solid ' + r.c }}><span style={{ fontSize: 8, color: '#a99bc4' }}>{r.l}</span><span style={{ fontSize: 9, color: r.c, fontWeight: 700 }}>{r.v}</span></div>))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: 'rgba(178,107,255,0.08)', border: '1px solid rgba(178,107,255,0.25)', borderRadius: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 8, color: '#a99bc4', fontWeight: 700 }}>VALUE ACQUIRED:</span>
              <span style={{ fontSize: 9, color: '#b26bff', fontWeight: 800 }}>+${(devices.length * 0.50).toFixed(2)} USD</span>
            </div>
            <div style={{ borderTop: '1px solid rgba(255,209,102,0.15)', paddingTop: 8 }}>
              <VaultClaimPanel wallet={wallet} announce={announce} />
            </div>
            <div style={{ textAlign: 'center', padding: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid ' + (lobbyCountdown <= 60 ? 'rgba(255,92,138,0.4)' : 'rgba(36,21,56,0.6)'), animation: lobbyCountdown <= 60 ? 'ledBlink 0.8s infinite' : 'none' }}>
              <div style={{ fontSize: 7.5, color: lobbyCountdown <= 60 ? '#ff5c8a' : '#453071', marginBottom: 2 }}>{lobbyCountdown <= 60 ? '🚀 LAUNCHING' : '⏳ NEXT BATCH'}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: lobbyCountdown <= 60 ? '#ff5c8a' : '#fff' }}>{fmtTime(lobbyCountdown)}</div>
            </div>
          </div>
        </div>}
        {navTab === 'missions' && <MissionsDemo />}
        {navTab === 'heist' && (
          <div style={{ flex: 1, padding: '20px 16px', maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: '#150d24', border: '1px solid rgba(36,21,56,0.2)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 14 }}>🕵️</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>OPERATIVES / HEIST LIST</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {INITIAL_OPERATIVES.map(op => (
                  <div key={op.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#1f1330', border: '1px solid rgba(178,107,255,0.1)', borderRadius: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>🕵️</span>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{op.name}</div>
                        <div style={{ fontSize: 8, color: '#7d6b99' }}>{op.status.toUpperCase()} • LEVEL {op.level} • {op.devices} DEVICES</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {navTab === 'vault' && (
          <div style={{ flex: 1, padding: '20px 16px', maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="lobby-vault-panel" style={{ background: '#150d24', border: '1px solid rgba(36,21,56,0.2)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ fontSize: 14 }}>💎</span><span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>DECENTERILZIED VAULT</span></div>
              <div style={{ position: 'relative', background: '#0e0819', border: '1px solid rgba(36,21,56,0.15)', minHeight: 180 }}>
                <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: (lobbyFill * 100) + '%', background: 'linear-gradient(180deg,#d3b0ff,#5b21b6)', opacity: 0.2, transition: 'height 1s linear' }} />
                <VaultSketch pct={lobbyFill} paid={Math.round(lobbyFill * 1000000)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 8, color: '#7d6b99' }}>Operatives</div><div style={{ fontSize: 18, fontWeight: 700, color: '#b26bff' }}>2,104</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 8, color: '#7d6b99' }}>Success</div><div style={{ fontSize: 18, fontWeight: 700, color: '#c084fc' }}>92.4%</div></div>
              </div>
              {[{ l: 'LAST BREACH', v: '+450 SOL', c: '#b26bff' }, { l: 'STABILITY', v: 'OPTIMAL', c: '#c084fc' }, { l: 'THREAT', v: 'LOW', c: '#ff6daf' }].map(r => (<div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: '#1f1330', borderLeft: '2px solid ' + r.c }}><span style={{ fontSize: 8, color: '#a99bc4' }}>{r.l}</span><span style={{ fontSize: 9, color: r.c, fontWeight: 700 }}>{r.v}</span></div>))}
              {/* Small display reflecting mints acquired value */}
              <div style={{ padding: '6px 8px', background: 'rgba(178,107,255,0.08)', border: '1px solid rgba(178,107,255,0.25)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 8, color: '#a99bc4', fontWeight: 700 }}>VALUE ACQUIRED:</span>
                <span style={{ fontSize: 9, color: '#b26bff', fontWeight: 800 }}>+${(devices.length * 0.50).toFixed(2)} USD</span>
              </div>
              <div style={{ borderTop: '1px solid rgba(255,209,102,0.15)', paddingTop: 8, marginTop: 4 }}>
                <VaultClaimPanel wallet={wallet} announce={announce} />
              </div>
              <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid ' + (lobbyCountdown <= 60 ? 'rgba(255,92,138,0.4)' : 'rgba(36,21,56,0.6)'), animation: lobbyCountdown <= 60 ? 'ledBlink 0.8s infinite' : 'none' }}>
                <div style={{ fontSize: 8, color: lobbyCountdown <= 60 ? '#ff5c8a' : '#453071', marginBottom: 2 }}>{lobbyCountdown <= 60 ? '🚀 LAUNCHING' : '⏳ NEXT BATCH'}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: lobbyCountdown <= 60 ? '#ff5c8a' : '#fff' }}>{fmtTime(lobbyCountdown)}</div>
              </div>
              <div style={{ textAlign: 'center', fontSize: 8, color: '#2d1f4a' }}>{devices.length > 0 ? (<span style={{ color: '#b26bff' }}>⚡ {devices.length} DEVICE{devices.length > 1 ? 'S' : ''} READY</span>) : (<span>MINT TO JOIN</span>)}</div>
              {(DEV_MODE || lobbyCountdown <= 60) && devices.length > 0 && (<button onClick={enterGame} className="keyboard-key keyboard-key-danger" style={{ width: '100%', padding: '9px 0', fontSize: 10, animation: DEV_MODE ? 'none' : 'ledBlink 0.6s infinite' }}>🚀 ENTER HACK MATRIX</button>)}
              {DEV_MODE && !devices.length && (<button onClick={enterGame} className="keyboard-key keyboard-key-danger" style={{ width: '100%', padding: '9px 0', fontSize: 10 }}>🚀 ENTER HACK MATRIX (DEV)</button>)}
              {lobbyCountdown > 60 && devices.length > 0 && (<div style={{ textAlign: 'center', fontSize: 8, color: '#2d1f4a' }}>Entry in {fmtTime(lobbyCountdown - 60)}</div>)}
            </div>
          </div>
        )}

      </div>
      <div style={{ position: 'fixed', bottom: 0, left: 0, width: '100%', zIndex: 50, height: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px', background: '#000', borderTop: '1px solid rgba(178,107,255,0.15)', boxSizing: 'border-box' }}>
        <span style={{ fontSize: 9, color: 'rgba(178,107,255,0.6)' }}>SYSTEM_BREACH_LOGS v2.4.0 · ACCESSING_NODE_01...</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: '#b26bff', animation: 'ledBlink 2s infinite' }} /><span style={{ fontSize: 9, color: '#b26bff' }}>SECURE_TUNNEL_ACTIVE</span></div>
      </div>
      {showEndScreen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(1,8,16,0.96)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 }}>
          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 28, fontWeight: 800, color: '#b26bff', textShadow: '0 0 30px #b26bff80', textAlign: 'center' }}>
            {bankruptCount >= 3 ? '🏆 ALL RANSOMS CLAIMED' : '🚨 DECENTERILZIED VAULT HIJACKED'}
          </div>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 9, color: '#453071', letterSpacing: '0.1em' }}>
            SESSION SUMMARY — RETURNING TO LOBBY
          </div>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#ffd166', letterSpacing: '0.08em' }}>
            ⚿ WINS HELD IN DECENTERILZIED VAULT — CLAIM BEFORE NEXT ROUND (⚿ key on RANSOM button)
          </div>
          <div style={{ width: '100%', maxWidth: 480, background: '#0e0819', border: '1px solid #2e1065', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {winRecords.length > 0 ? (
              winRecords.map((r, i) => (
                <div key={i} style={{ borderBottom: '1px solid #150d24', paddingBottom: 6, marginBottom: 2 }}>
                  <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: LED_COLORS[r.wt], marginBottom: 3 }}>
                    {WIN_LABELS[r.wt]} — Round {r.round}
                  </div>
                  {r.claimers.map((cl, j) => (
                    <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 8px' }}>
                      <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#a99bc4' }}>{cl}</span>
                      <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#f59e0b' }}>{r.heistEach} HEIST</span>
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', textAlign: 'center', padding: 12 }}>
                No ransoms claimed — vault transferred to treasury
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid #2e1065' }}>
              <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>TOTAL CLAIMED</span>
              <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b26bff', fontWeight: 700 }}>${(winRecords.reduce((s, r) => s + r.split * r.claimers.length, 0) / 1000).toFixed(0)}K</span>
            </div>
          </div>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a', animation: 'ledBlink 1s infinite' }}>
            ⬡ ALL DEVICES DEACTIVATED — WIPING SESSION DATA…
          </div>
        </div>
      )}

      {/* Private room windows persist lobby→matrix until the game ends */}
      {chatRooms.map((room, i) => (
        <RoomChatTerminal key={room.id} room={room} nickname={nickname} fixed cascadeIndex={i} onClose={() => setChatRooms(p => p.filter(r => r.id !== room.id))} />
      ))}
      {announcement && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#0e0819', border: '1px solid #b26bff40', borderRadius: 10, padding: '10px 18px', fontFamily: 'DM Mono,monospace', fontSize: 10, color: '#b26bff', zIndex: 999, whiteSpace: 'pre', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', maxWidth: '90vw' }}>
          {announcement}
        </div>
      )}
    </div>
  )

  // ── GAME SCREEN ──────────────────────────────────────────────────────────
  if (devicesExpanded) return (
    <MaximizedDevices devices={devices} currentNum={currentNum} clickWindowOpen={clickWindowOpen}
      calledNums={calledNums} onCellClick={handleCellClick} onClaim={handleClaim} onActivate={handleActivate}
      winStates={winStates} bankruptCount={bankruptCount} timer={timer} totalTimer={totalTimer}
      liveBank={liveBank} onClose={() => setDevicesExpanded(false)} onOpenVault={() => setShowVaultClaim(true)} />
  )

  return (
    <div data-theme={theme} style={{ background: 'linear-gradient(180deg,#0a0612,#0e0819)', color: '#f1f5f9', minHeight: '100vh' }}>
      {/* Header */}
      <div className="app-header" style={{ padding: '7px 12px', borderBottom: '1px solid #1a1029', display: 'flex', alignItems: 'center', background: 'rgba(2,13,26,0.96)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 17, fontWeight: 800, color: '#b26bff', flexShrink: 0 }}>ROBHIN HEIST{DEV_MODE && <span style={{ fontSize: 9, color: '#f59e0b', marginLeft: 6, verticalAlign: 'middle' }}>DEV</span>}</div>
        <div style={{ flex: 1, margin: '0 10px', height: 26, background: 'rgba(178,107,255,0.02)', border: '1px dashed #150d24', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#150d24' }}>AD</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          {preGameSecs > 0 && <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 6, padding: '3px 7px' }}>⏱ {fmtTime(preGameSecs)}</div>}
          {onChainSession && phase === 'game' && <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b26bff', background: 'rgba(178,107,255,0.06)', border: '1px solid rgba(178,107,255,0.2)', borderRadius: 6, padding: '3px 6px' }}>
            ⛓ {onChainSession.drawCount}/{onChainSession.maxDraws || 59} on-chain
          </div>}
          {phase === 'game' && preGameSecs === 0 && <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: sessionSecs >= (57 * 60) ? '#ff5c8a' : '#453071', background: sessionSecs >= (57 * 60) ? 'rgba(255,92,138,0.08)' : 'transparent', border: sessionSecs >= (57 * 60) ? '1px solid rgba(255,92,138,0.25)' : 'none', borderRadius: 6, padding: '3px 6px', transition: 'all 0.5s' }}>
            {sessionSecs >= (57 * 60) ? '🚨' : '⏱'} {String(Math.floor(sessionSecs / 60)).padStart(2, '0')}:{String(sessionSecs % 60).padStart(2, '0')}
          </div>}
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#ff5c8a', background: 'rgba(255,92,138,0.08)', border: '1px solid rgba(255,92,138,0.2)', borderRadius: 6, padding: '3px 7px' }}>🔴 {BANKS[liveBank].name}</div>
          <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Light / dark mode" style={{ background: '#150d24', border: '1px solid #241538', borderRadius: 6, padding: '3px 7px', fontSize: 10, cursor: 'pointer' }}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          {DEV_MODE && <>
            <button onClick={devDrawNext} title="Draw next on-chain number now" style={{ background: '#150d24', border: '1px solid #c084fc55', borderRadius: 6, padding: '3px 7px', fontSize: 8, cursor: 'pointer', color: '#c084fc' }}>⏩ DRAW</button>
            <button onClick={devSettleNow} title="Settle pending claims now (check wallet split)" style={{ background: '#150d24', border: '1px solid #f59e0b55', borderRadius: 6, padding: '3px 7px', fontSize: 8, cursor: 'pointer', color: '#f59e0b' }}>⏭ SETTLE</button>
          </>}
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#a99bc4', background: '#150d24', borderRadius: 6, padding: '3px 7px' }}>👤 {nickname}</div>
          {wallet ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#b26bff', background: '#150d24', border: '1px solid #b26bff30', borderRadius: 6, padding: '3px 7px', display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#a78bfa' }} />
                {wallet.slice(0, 6)}…{wallet.slice(-4)}
              </div>
              <button onClick={() => disconnect()} style={{ background: 'transparent', border: '1px solid rgba(255,92,138,0.2)', borderRadius: 6, padding: '3px 6px', color: '#ff5c8a', cursor: 'pointer', fontSize: 9, lineHeight: 1 }}>✕</button>
            </div>
          ) : (
            <WalletMultiButton style={{ background: 'linear-gradient(to bottom,#b26bff 0%,#7c3aed 100%)', color: '#000', borderRadius: 6, fontFamily: 'DM Mono,monospace', fontSize: 8, fontWeight: 700, height: 'auto', padding: '4px 8px' }} />
          )}
        </div>
      </div>

      {/* Responsive layout: 3-col on wide, stacked on mobile */}
      <div style={{
        padding: '10px 12px 0', display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr)',
        gridTemplateAreas: '"matrix"',
        gap: 10, alignItems: 'start'
      }}
        className="game-grid">
        <div style={{ gridArea: 'matrix', minWidth: 0 }}>
          <HackMatrixDisplay calledNums={calledNums} calledOrder={calledOrder} clickWindowOpen={clickWindowOpen} preGameSecs={preGameSecs} winRecords={winRecords} liveBank={liveBank} contractAddr={contractAddr} timer={timer} totalTimer={totalTimer} deviceCount={devices.filter(d => d.active).length} vaultTotal={onChainSession?.vaultTotal ?? VAULT_ESTIMATE} heistRateUsd={onChainSession?.rates?.HEIST != null ? Number(onChainSession.rates.HEIST) : undefined} />
        </div>
      </div>

      {/* Win strip */}
      <div style={{ margin: '8px 12px 0', padding: '4px 8px', display: 'flex', gap: 4, overflowX: 'auto', borderRadius: 10, background: 'rgba(2,13,26,0.7)', border: '1px solid #1a1029' }}>
        {(Object.entries(WIN_LABELS) as [WinType, string][]).map(([type, label]) => {
          const st = winStates[type]
          return (
            <div key={type} style={{
              display: 'flex', gap: 3, alignItems: 'center', padding: '3px 6px', borderRadius: 6, flexShrink: 0,
              background: st.claimed ? 'rgba(167,139,250,0.08)' : st.claimable ? 'rgba(236,72,153,0.08)' : 'transparent',
              border: st.claimed ? '1px solid rgba(167,139,250,0.25)' : st.expired ? '1px solid rgba(127,0,0,0.3)' : st.claimable ? '1px solid rgba(236,72,153,0.35)' : '1px solid transparent'
            }}>
              <div style={{
                width: 7, height: 5, borderRadius: 1, background: st.expired ? '#50081f' : LED_COLORS[type], opacity: st.claimed ? 0.3 : st.expired ? 0.4 : 1,
                animation: st.broken ? 'none' : st.expired ? 'ledExpire 0.4s ease forwards' : st.flickering ? 'rapidFlicker 0.08s infinite' : st.claimable && !st.claimed ? 'ledBlink 0.6s infinite' : 'none',
                boxShadow: st.claimable && !st.claimed && !st.expired ? `0 0 4px ${LED_COLORS[type]}` : 'none'
              }} />
              <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: st.claimed ? '#a78bfa' : st.claimable ? '#ec4899' : '#2d1f4a', whiteSpace: 'nowrap' }}>
                {st.claimed ? '✓ ' : st.claimable ? '⚡ ' : '○ '}{label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Devices section: 2 cols normal, maximize opens full screen */}
      <div className="devices-section" style={{ padding: '10px 12px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#2d1f4a' }}>
            ◈ NFT DEVICES &nbsp;<span style={{ color: '#453071' }}>{devices.length} total · {devices.filter(d => d.active).length} active</span>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <button onClick={handleActivateAll} style={{ background: '#150d24', border: '1px solid #b26bff30', color: '#b26bff', borderRadius: 7, padding: '4px 9px', fontFamily: 'DM Mono,monospace', fontSize: 8, cursor: 'pointer' }}>
              ⚡ ALL ON
            </button>
            <button onClick={() => setDevicesExpanded(true)} style={{ background: '#150d24', border: '1px solid #241538', color: '#453071', borderRadius: 7, padding: '4px 10px', fontFamily: 'DM Mono,monospace', fontSize: 8, cursor: 'pointer' }}>
              ⊞ MAXIMIZE
            </button>
            <button onClick={() => setShowTerminate(true)} style={{ background: 'rgba(127,0,0,0.25)', border: '1px solid #4a0d26', color: '#ff5c8a', borderRadius: 7, padding: '4px 9px', fontFamily: 'DM Mono,monospace', fontSize: 8, cursor: 'pointer', letterSpacing: '0.05em' }}>
              ⏻ TERMINATE
            </button>
          </div>
        </div>
        {/* 2 columns, ALL devices scroll down */}
        <div className="device-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
          {devices.map(d => (
            <HackingDevice key={d.id} device={d} currentNum={currentNum} clickWindowOpen={clickWindowOpen}
              calledNums={calledNums} onCellClick={handleCellClick} onClaim={handleClaim} onActivate={handleActivate}
              winStates={winStates} bankruptCount={bankruptCount} timer={timer} totalTimer={totalTimer} liveBank={liveBank} onOpenVault={() => setShowVaultClaim(true)} />
          ))}
        </div>
      </div>

      {/* Private room windows remain through the matrix until the game ends */}
      {chatRooms.map((room, i) => (
        <RoomChatTerminal key={room.id} room={room} nickname={nickname} fixed cascadeIndex={i} onClose={() => setChatRooms(p => p.filter(r => r.id !== room.id))} />
      ))}
      {announcement && (
        <div style={{ position: 'fixed', top: 52, left: '50%', transform: 'translateX(-50%)', background: '#0e0819', border: '1px solid #b26bff40', borderRadius: 10, padding: '9px 16px', fontFamily: 'DM Mono,monospace', fontSize: 10, color: '#b26bff', zIndex: 999, whiteSpace: 'pre', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', animation: 'slideDown 0.3s ease', maxWidth: '90vw' }}>
          {announcement}
        </div>
      )}

      {/* ── VAULT CLAIM MODAL (from RANSOM corner key) ── */}
      {showVaultClaim && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(1,8,16,0.92)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setShowVaultClaim(false) }}>
          <div style={{ background: '#0e0819', border: '1px solid rgba(255,209,102,0.35)', borderRadius: 14, padding: 16, maxWidth: 380, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontFamily: 'Syne,sans-serif', fontSize: 13, fontWeight: 800, color: '#ffd166' }}>⚿ DECENTERILZIED VAULT CLAIM</span>
              <button onClick={() => setShowVaultClaim(false)} style={{ background: '#150d24', border: '1px solid #241538', color: '#a99bc4', borderRadius: 5, padding: '3px 8px', fontSize: 8, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ fontSize: 8, color: '#a99bc4', marginBottom: 10 }}>Wins stay in the vault — claim any time before the next round, even after this console is trashed.</div>
            <VaultClaimPanel wallet={wallet} announce={announce} />
          </div>
        </div>
      )}

      {/* ── TERMINATE WARNING MODAL ── */}
      {showTerminate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setShowTerminate(false) }}>
          <div style={{
            background: '#0a0505', border: '2px solid #4a0d26', borderRadius: 16, padding: 28, maxWidth: 360, width: '100%',
            boxShadow: '0 0 60px rgba(255,92,138,0.2),inset 0 0 40px rgba(127,0,0,0.08)'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,92,138,0.12)', border: '2px solid #ff5c8a',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0
              }}>⚠</div>
              <div>
                <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 16, fontWeight: 800, color: '#ff5c8a', letterSpacing: '0.05em' }}>TERMINATE SESSION</div>
                <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#4a0d26', marginTop: 2 }}>WALLET · {wallet || nickname}</div>
              </div>
            </div>
            {/* Warning body */}
            <div style={{ background: 'rgba(127,0,0,0.12)', border: '1px solid rgba(255,92,138,0.2)', borderRadius: 8, padding: '12px 14px', marginBottom: 18 }}>
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#ff5c8a', marginBottom: 8, letterSpacing: '0.1em' }}>⚠ WARNING — IRREVERSIBLE ACTION</div>
              {[
                'All minted NFT devices will be deactivated',
                'Current game session & progress will be wiped',
                'Unclaimed prizes for this wallet are forfeited',
                'Saved state will be cleared from this browser',
                'You will return to the lobby screen',
              ].map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 4 }}>
                  <span style={{ color: '#4a0d26', flexShrink: 0, marginTop: 1 }}>›</span>
                  <span style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#a05050', lineHeight: 1.5 }}>{line}</span>
                </div>
              ))}
            </div>
            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowTerminate(false)}
                style={{
                  flex: 1, background: '#150d24', border: '1px solid #241538', color: '#a99bc4', borderRadius: 8,
                  padding: '10px', fontFamily: 'DM Mono,monospace', fontSize: 8, cursor: 'pointer', letterSpacing: '0.05em'
                }}>
                ABORT
              </button>
              <button onClick={terminateGame}
                style={{
                  flex: 1, background: 'linear-gradient(135deg,#3f0000,#200000)', border: '2px solid #ff5c8a', color: '#ff5c8a',
                  borderRadius: 8, padding: '10px', fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                  letterSpacing: '0.1em', boxShadow: '0 0 16px rgba(255,92,138,0.25)', animation: 'ransomPulse 2s infinite'
                }}>
                ⏻ CONFIRM TERMINATE
              </button>
            </div>
            <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: '#50081f', textAlign: 'center', marginTop: 10 }}>
              click outside to dismiss · this action cannot be undone
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// tiny clamp helper (returns px string)
function clamp(min: number, val: number, unit: string) { return `clamp(${min}px,${val}${unit},${min + 8}px)` }
// HEIST tokens allocated per win type (split equally among winning devices for that round)
const HEIST_ALLOC: Record<WinType, number> = { EARLY_FIVE: 500, TOP_LINE: 1000, MIDDLE_LINE: 1000, BOTTOM_LINE: 1000, FULL_HOUSE_1: 2500, FULL_HOUSE_2: 2500, FULL_HOUSE_3: 1500 }
