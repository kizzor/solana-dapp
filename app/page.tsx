'use client'
import './globals.css'
import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────
type Cell = { num: number | null; matched: boolean; clicked: boolean; justCalled: boolean }
type Device = {
  id: number
  grid: Cell[][]
  claimed: Set<string>
  corrupted: boolean
  active: boolean
}
type WinType = 'EARLY_FIVE' | 'TOP_LINE' | 'MIDDLE_LINE' | 'BOTTOM_LINE' | 'FULL_HOUSE_1' | 'FULL_HOUSE_2' | 'FULL_HOUSE_3'

const WIN_LABELS: Record<WinType, string> = {
  EARLY_FIVE:   '5 Digit Accounts Hacked',
  TOP_LINE:     'Top Accounts Hacked',
  MIDDLE_LINE:  'Central System Hacked',
  BOTTOM_LINE:  'Basement Hacked',
  FULL_HOUSE_1: 'Bankrupt Ransome I',
  FULL_HOUSE_2: 'Bankrupt Ransome II',
  FULL_HOUSE_3: 'Bankrupt Ransome III',
}

const ANTENNA_COLORS: Record<WinType, string> = {
  EARLY_FIVE:   '#f59e0b',
  TOP_LINE:     '#0ea5e9',
  MIDDLE_LINE:  '#22c55e',
  BOTTOM_LINE:  '#92400e',
  FULL_HOUSE_1: '#f472b6',
  FULL_HOUSE_2: '#ec4899',
  FULL_HOUSE_3: '#db2777',
}

const BANKS = [
  { id: 0,  name: 'Pacific Reserve',   city: 'Auckland',      tz: 12,  x: 88, y: 72 },
  { id: 1,  name: 'Sakura Central',    city: 'Tokyo',         tz: 9,   x: 80, y: 30 },
  { id: 2,  name: 'Dragon Vault',      city: 'Shanghai',      tz: 8,   x: 76, y: 34 },
  { id: 3,  name: 'Tiger Bank',        city: 'Singapore',     tz: 8,   x: 74, y: 53 },
  { id: 4,  name: 'Indus Capital',     city: 'Mumbai',        tz: 5.5, x: 65, y: 40 },
  { id: 5,  name: 'Gulf Reserve',      city: 'Dubai',         tz: 4,   x: 61, y: 39 },
  { id: 6,  name: 'Nile Treasury',     city: 'Cairo',         tz: 2,   x: 53, y: 36 },
  { id: 7,  name: 'Savanna Vault',     city: 'Nairobi',       tz: 3,   x: 56, y: 57 },
  { id: 8,  name: 'Cape Reserve',      city: 'Cape Town',     tz: 2,   x: 52, y: 74 },
  { id: 9,  name: 'Colosseum Bank',    city: 'Rome',          tz: 1,   x: 49, y: 28 },
  { id: 10, name: 'Rhine Vault',       city: 'Frankfurt',     tz: 1,   x: 49, y: 22 },
  { id: 11, name: 'Thames Capital',    city: 'London',        tz: 0,   x: 46, y: 22 },
  { id: 12, name: 'Nordic Reserve',    city: 'Oslo',          tz: 1,   x: 49, y: 16 },
  { id: 13, name: 'Kremlin Bank',      city: 'Moscow',        tz: 3,   x: 57, y: 19 },
  { id: 14, name: 'Azores Vault',      city: 'Lisbon',        tz: 0,   x: 44, y: 28 },
  { id: 15, name: 'Atlas Treasury',    city: 'Casablanca',    tz: 1,   x: 44, y: 34 },
  { id: 16, name: 'Amazon Reserve',    city: 'São Paulo',     tz: -3,  x: 32, y: 67 },
  { id: 17, name: 'Andes Vault',       city: 'Bogotá',        tz: -5,  x: 25, y: 54 },
  { id: 18, name: 'Manhattan Capital', city: 'New York',      tz: -5,  x: 22, y: 28 },
  { id: 19, name: 'Silicon Reserve',   city: 'San Francisco', tz: -8,  x: 10, y: 31 },
  { id: 20, name: 'Maple Treasury',    city: 'Toronto',       tz: -5,  x: 21, y: 24 },
  { id: 21, name: 'Red Sea Bank',      city: 'Riyadh',        tz: 3,   x: 58, y: 39 },
  { id: 22, name: 'Carnival Bank',     city: 'Rio',           tz: -3,  x: 33, y: 68 },
]

const TERMINAL_CMDS = [
  'INIT PAYLOAD INJECTION', 'BYPASSING FIREWALL LAYER 3', 'SCANNING PORT 8443',
  'BRUTE FORCE SHA-256', 'DECRYPTING TLS HANDSHAKE', 'EXPLOITING CVE-2024-1337',
  'INJECTING SQL PAYLOAD', 'PIVOTING THROUGH SUBNET', 'EXFILTRATING VAULT KEYS',
  'SPOOFING MAC ADDRESS', 'ARP POISONING GATEWAY', 'DUMPING LSASS MEMORY',
  'ESCALATING PRIVILEGES', 'DEPLOYING ROOTKIT', 'TUNNELING THROUGH SSH',
  'SNIFFING PACKETS ETH0', 'CRACKING WPA2 HANDSHAKE', 'BUFFER OVERFLOW EXPLOIT',
  'UPLOADING RANSOMWARE', 'COVERING TRACKS', 'KERNEL PANIC INJECTED',
]

function getLiveBank(hour: number) { return hour % 23 }

function generateDevice(id: number): Device {
  const cols = [[1,10],[11,20],[21,30],[31,40],[41,50],[51,60],[61,70],[71,80],[81,90]]
  const grid: Cell[][] = Array.from({length:3}, () =>
    Array(9).fill(null).map(() => ({num:null,matched:false,clicked:false,justCalled:false}))
  )
  for (let row = 0; row < 3; row++) {
    const chosen = Array.from({length:9},(_,i)=>i).sort(()=>Math.random()-0.5).slice(0,5).sort((a,b)=>a-b)
    for (const ci of chosen) {
      const [lo, hi] = cols[ci]
      let num: number
      do { num = Math.floor(Math.random()*(hi-lo+1))+lo } while (grid.some(r => r[ci].num === num))
      grid[row][ci] = { num, matched: false, clicked: false, justCalled: false }
    }
  }
  return { id, grid, claimed: new Set(), corrupted: false, active: true }
}

// ─── World Map ───────────────────────────────────────────────────────────────
function WorldMap({ selectedBank, onSelect, currentHour }: {
  selectedBank: number | null; onSelect:(id:number)=>void; currentHour: number
}) {
  const liveBank = getLiveBank(currentHour)
  return (
    <div style={{ position:'relative', width:'100%', paddingTop:'48%', borderRadius:14, overflow:'hidden', background:'rgba(14,30,54,0.12)', border:'1px solid rgba(14,30,54,0.15)' }}>
      <div style={{ position:'absolute', inset:0 }}>
        <svg viewBox="0 0 100 100" style={{ width:'100%', height:'100%' }}>
          {/* Grid */}
          {Array.from({length:13},(_,i)=>(
            <line key={`v${i}`} x1={i*100/12} y1="0" x2={i*100/12} y2="100" stroke="rgba(14,30,54,0.08)" strokeWidth="0.3"/>
          ))}
          {Array.from({length:7},(_,i)=>(
            <line key={`h${i}`} x1="0" y1={i*100/6} x2="100" y2={i*100/6} stroke="rgba(14,30,54,0.08)" strokeWidth="0.3"/>
          ))}
          {/* Continent shapes */}
          <ellipse cx="18" cy="28" rx="12" ry="14" fill="rgba(14,30,54,0.12)" stroke="rgba(14,30,54,0.2)" strokeWidth="0.4"/>
          <ellipse cx="28" cy="63" rx="7" ry="13" fill="rgba(14,30,54,0.12)" stroke="rgba(14,30,54,0.2)" strokeWidth="0.4"/>
          <ellipse cx="49" cy="23" rx="6" ry="8" fill="rgba(14,30,54,0.12)" stroke="rgba(14,30,54,0.2)" strokeWidth="0.4"/>
          <ellipse cx="50" cy="53" rx="7" ry="16" fill="rgba(14,30,54,0.12)" stroke="rgba(14,30,54,0.2)" strokeWidth="0.4"/>
          <ellipse cx="70" cy="29" rx="18" ry="14" fill="rgba(14,30,54,0.12)" stroke="rgba(14,30,54,0.2)" strokeWidth="0.4"/>
          <ellipse cx="82" cy="65" rx="7" ry="6" fill="rgba(14,30,54,0.12)" stroke="rgba(14,30,54,0.2)" strokeWidth="0.4"/>
          {/* Bank dots */}
          {BANKS.map(bank => {
            const isLive = bank.id === liveBank
            const isSel = bank.id === selectedBank
            return (
              <g key={bank.id} onClick={()=>onSelect(bank.id)} style={{cursor:'pointer'}}>
                {isLive && <circle cx={bank.x} cy={bank.y} r="3" fill="rgba(239,68,68,0.2)"><animate attributeName="r" values="2;4;2" dur="1.5s" repeatCount="indefinite"/></circle>}
                <circle cx={bank.x} cy={bank.y} r={isLive?2.2:isSel?1.8:1.2}
                  fill={isLive?'#ef4444':isSel?'#0ea5e9':'rgba(14,30,54,0.4)'}
                  stroke={isLive?'#fca5a5':isSel?'#7dd3fc':'rgba(14,30,54,0.3)'}
                  strokeWidth="0.4"
                />
                {isSel && <text x={bank.x} y={bank.y-3} textAnchor="middle" fontSize="2.5" fill="#0369a1">{bank.city}</text>}
              </g>
            )
          })}
          {/* Live label */}
          {(() => {
            const b = BANKS[liveBank]
            return <text x={b.x} y={b.y-3.5} textAnchor="middle" fontSize="2.8" fill="#ef4444" fontWeight="bold">● {b.city}</text>
          })()}
        </svg>
      </div>
    </div>
  )
}

// ─── Antenna SVG ─────────────────────────────────────────────────────────────
function AntennaIcon({ color, broken, blinking, size=18 }: { color:string; broken:boolean; blinking:boolean; size?:number }) {
  if (broken) return (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <line x1="9" y1="16" x2="6" y2="8" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="6" y1="8" x2="10" y2="4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="9" y1="5" x2="13" y2="2" stroke="#94a3b8" strokeWidth="1" strokeLinecap="round" opacity="0.4"/>
    </svg>
  )
  return (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <line x1="9" y1="16" x2="9" y2="6" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity={blinking ? undefined : '0.7'}>
        {blinking && <animate attributeName="opacity" values="1;0.1;1" dur="0.6s" repeatCount="indefinite"/>}
      </line>
      {/* Rings */}
      <path d="M6,8 Q9,5 12,8" stroke={color} strokeWidth="1" fill="none" opacity="0.8"/>
      <path d="M4,11 Q9,6 14,11" stroke={color} strokeWidth="0.8" fill="none" opacity="0.5"/>
      {/* Tip bulb */}
      <circle cx="9" cy="5" r="1.8" fill={color} opacity={blinking ? undefined : '0.8'}>
        {blinking && <animate attributeName="opacity" values="1;0.2;1" dur="0.6s" repeatCount="indefinite"/>}
        {blinking && <animate attributeName="r" values="1.8;2.6;1.8" dur="0.6s" repeatCount="indefinite"/>}
      </circle>
      {blinking && <circle cx="9" cy="5" r="3" fill={color} opacity="0.2"><animate attributeName="r" values="2;5;2" dur="0.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.3;0;0.3" dur="0.6s" repeatCount="indefinite"/></circle>}
    </svg>
  )
}

// ─── Hacking Device ──────────────────────────────────────────────────────────
function HackingDevice({ device, currentNum, clickWindowOpen, calledNums, onCellClick, onClaim, winStates, bankruptCount }: {
  device: Device
  currentNum: number | null
  clickWindowOpen: boolean
  calledNums: Set<number>
  onCellClick: (deviceId:number, row:number, col:number) => void
  onClaim: (deviceId:number, winType:WinType) => void
  winStates: Record<WinType,{claimed:boolean;claimable:boolean}>
  bankruptCount: number
}) {
  const clicked = device.grid.flat().filter(c=>c.clicked).length
  const row0Done = device.grid[0].filter(c=>c.num).every(c=>c.clicked)
  const row1Done = device.grid[1].filter(c=>c.num).every(c=>c.clicked)
  const row2Done = device.grid[2].filter(c=>c.num).every(c=>c.clicked)
  const allDone  = device.grid.flat().filter(c=>c.num).every(c=>c.clicked)
  const fhKey    = `FULL_HOUSE_${Math.min(bankruptCount+1,3)}` as WinType

  const canClaim = (
    (clicked >= 5 && !device.claimed.has('EARLY_FIVE') && winStates.EARLY_FIVE.claimable && !winStates.EARLY_FIVE.claimed) ||
    (row0Done && !device.claimed.has('TOP_LINE') && winStates.TOP_LINE.claimable && !winStates.TOP_LINE.claimed) ||
    (row1Done && !device.claimed.has('MIDDLE_LINE') && winStates.MIDDLE_LINE.claimable && !winStates.MIDDLE_LINE.claimed) ||
    (row2Done && !device.claimed.has('BOTTOM_LINE') && winStates.BOTTOM_LINE.claimable && !winStates.BOTTOM_LINE.claimed) ||
    (allDone && winStates[fhKey]?.claimable && !winStates[fhKey]?.claimed && !device.claimed.has(fhKey))
  )

  const antennae: WinType[] = ['EARLY_FIVE','TOP_LINE','MIDDLE_LINE','BOTTOM_LINE','FULL_HOUSE_1','FULL_HOUSE_2','FULL_HOUSE_3']

  const doClaim = () => {
    if (clicked >= 5 && !device.claimed.has('EARLY_FIVE') && winStates.EARLY_FIVE.claimable && !winStates.EARLY_FIVE.claimed) { onClaim(device.id,'EARLY_FIVE'); return }
    if (row0Done && !device.claimed.has('TOP_LINE') && winStates.TOP_LINE.claimable && !winStates.TOP_LINE.claimed) { onClaim(device.id,'TOP_LINE'); return }
    if (row1Done && !device.claimed.has('MIDDLE_LINE') && winStates.MIDDLE_LINE.claimable && !winStates.MIDDLE_LINE.claimed) { onClaim(device.id,'MIDDLE_LINE'); return }
    if (row2Done && !device.claimed.has('BOTTOM_LINE') && winStates.BOTTOM_LINE.claimable && !winStates.BOTTOM_LINE.claimed) { onClaim(device.id,'BOTTOM_LINE'); return }
    if (allDone && winStates[fhKey]?.claimable) onClaim(device.id, fhKey)
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.72)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: canClaim ? '2px solid #ec4899' : '1.5px solid rgba(14,30,54,0.15)',
      borderRadius: 16,
      padding: '10px 8px 8px',
      boxShadow: canClaim
        ? '0 0 0 3px rgba(236,72,153,0.2), 0 8px 24px rgba(14,30,54,0.12)'
        : '0 4px 16px rgba(14,30,54,0.08)',
      display: 'flex', flexDirection: 'column', gap: 6,
      position: 'relative',
    }}>
      {/* Antennae row — top of device like the image */}
      <div style={{ display:'flex', justifyContent:'space-around', paddingBottom:6, borderBottom:'1px solid rgba(14,30,54,0.1)' }}>
        {antennae.map(a => (
          <AntennaIcon key={a}
            color={ANTENNA_COLORS[a]}
            broken={winStates[a]?.claimed && !device.claimed.has(a)}
            blinking={winStates[a]?.claimable && !winStates[a]?.claimed}
            size={20}
          />
        ))}
      </div>

      {/* Device ID */}
      <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#94a3b8', textAlign:'center', letterSpacing:'0.1em' }}>
        DEV-{String(device.id).padStart(5,'0')}
      </div>

      {/* RANSOM button (big red button like the image) */}
      <button onClick={doClaim} disabled={!canClaim} style={{
        background: canClaim
          ? 'linear-gradient(180deg,#f87171 0%,#dc2626 60%,#b91c1c 100%)'
          : 'linear-gradient(180deg,#cbd5e1 0%,#94a3b8 100%)',
        color: '#fff',
        border: 'none',
        borderRadius: 10,
        padding: '10px 0',
        fontFamily: '"Syne",sans-serif',
        fontSize: 13,
        fontWeight: 800,
        letterSpacing: '0.12em',
        cursor: canClaim ? 'pointer' : 'default',
        boxShadow: canClaim
          ? 'inset 0 -3px 0 rgba(0,0,0,0.3), 0 4px 12px rgba(220,38,38,0.4)'
          : 'inset 0 -2px 0 rgba(0,0,0,0.15)',
        transition: 'all 0.15s',
      }}>
        RANSOME
      </button>

      {/* Number grid */}
      {device.grid.map((row, ri) => (
        <div key={ri} style={{ display:'grid', gridTemplateColumns:'repeat(9,1fr)', gap:2 }}>
          {row.map((cell, ci) => {
            const isCurrentNum = cell.num !== null && cell.num === currentNum
            const isClickable  = isCurrentNum && clickWindowOpen && !cell.clicked
            const isClicked    = cell.clicked
            const isEmpty      = cell.num === null
            const glitchAnim   = `glitch${(ri*9+ci)%3} ${2+((ri*9+ci)%3)}s ${(ri*9+ci)*0.07}s infinite`

            return (
              <button key={ci}
                onClick={() => isClickable && onCellClick(device.id, ri, ci)}
                style={{
                  height: 24,
                  borderRadius: 5,
                  border: isClicked ? 'none' : isClickable ? '1.5px solid #22c55e' : '1px solid rgba(14,30,54,0.12)',
                  cursor: isClickable ? 'pointer' : 'default',
                  background: isEmpty ? 'transparent'
                    : isClicked ? 'linear-gradient(135deg,#22c55e,#16a34a)'
                    : isClickable ? 'rgba(34,197,94,0.1)'
                    : 'rgba(14,30,54,0.06)',
                  color: isEmpty ? 'transparent'
                    : isClicked ? '#fff'
                    : isClickable ? '#15803d'
                    : '#64748b',
                  fontFamily: '"DM Mono",monospace',
                  fontSize: 9,
                  fontWeight: isClicked ? 700 : 400,
                  boxShadow: isClicked ? '0 2px 6px rgba(34,197,94,0.35)' : 'none',
                  // Glitch ONLY on non-clickable non-empty non-clicked cells
                  animation: (!isEmpty && !isClickable && !isClicked) ? glitchAnim : 'none',
                  padding: 0,
                }}
              >
                {cell.num ?? ''}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─── Hacking Matrix (centre panel) ───────────────────────────────────────────
function HackingMatrix({ calledNums, calledOrder, timer, clickWindowOpen }: {
  calledNums: Set<number>; calledOrder: number[]; timer: number; clickWindowOpen: boolean
}) {
  const lastNum = calledOrder[calledOrder.length - 1]
  const prev5   = calledOrder.slice(-6,-1).reverse()

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, height:'100%' }}>
      {/* Big broadcast number */}
      <div style={{
        background: 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1.5px solid rgba(14,30,54,0.12)',
        borderRadius: 16,
        padding: '20px 16px',
        textAlign: 'center',
        position: 'relative',
      }}>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#94a3b8', letterSpacing:'0.2em', marginBottom:4 }}>RANSOME BANK BROADCAST</div>
        <div key={lastNum} style={{
          fontFamily: '"Syne",sans-serif', fontSize: 72, fontWeight: 800,
          color: '#0f172a', lineHeight: 1,
          animation: 'numDrop 0.35s cubic-bezier(.34,1.56,.64,1)',
        }}>
          {lastNum ?? '—'}
        </div>
        {/* Click window indicator */}
        <div style={{
          marginTop: 8,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: clickWindowOpen ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${clickWindowOpen ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.2)'}`,
          borderRadius: 20, padding: '3px 10px',
        }}>
          <div style={{ width:6, height:6, borderRadius:'50%', background: clickWindowOpen ? '#22c55e' : '#ef4444' }} />
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color: clickWindowOpen ? '#15803d' : '#dc2626' }}>
            {clickWindowOpen ? `CLICK WINDOW OPEN — ${timer}s` : 'WINDOW CLOSED'}
          </div>
        </div>
        {/* Last 5 numbers */}
        <div style={{ display:'flex', gap:6, justifyContent:'center', marginTop:10 }}>
          {prev5.map((n,i) => (
            <div key={i} style={{
              width:28, height:28, borderRadius:6,
              background:'rgba(14,30,54,0.06)', border:'1px solid rgba(14,30,54,0.12)',
              fontFamily:'"DM Mono",monospace', fontSize:10, color:'#64748b',
              display:'flex', alignItems:'center', justifyContent:'center',
              opacity: 1 - i*0.15,
            }}>{n}</div>
          ))}
        </div>
      </div>

      {/* Number board 1-90 */}
      <div style={{
        background: 'rgba(255,255,255,0.7)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1.5px solid rgba(14,30,54,0.1)',
        borderRadius: 14, padding: 10, flex: 1,
      }}>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#94a3b8', marginBottom:6, letterSpacing:'0.1em' }}>NUMBERS BROADCAST</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(10,1fr)', gap:3 }}>
          {Array.from({length:90},(_,i)=>i+1).map(n => (
            <div key={n} style={{
              height:20, borderRadius:4,
              background: n===lastNum ? '#0f172a' : calledNums.has(n) ? 'rgba(14,30,54,0.15)' : 'transparent',
              border: n===lastNum ? 'none' : calledNums.has(n) ? '1px solid rgba(14,30,54,0.2)' : '1px solid rgba(14,30,54,0.06)',
              color: n===lastNum ? '#fff' : calledNums.has(n) ? '#475569' : '#cbd5e1',
              fontFamily: '"DM Mono",monospace', fontSize: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: n===lastNum ? 700 : 400,
            }}>{n}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Chat Terminal ───────────────────────────────────────────────────────────
function ChatTerminal({ nickname }: { nickname: string }) {
  const [lines, setLines] = useState<{text:string;type:'sys'|'user'|'cmd'}[]>([
    {text:'HACKING MATRIX v3.7.1 INITIALIZED',type:'sys'},
    {text:'SECURE CHANNEL ACTIVE',type:'sys'},
    {text:`AGENT ${nickname.toUpperCase()} CONNECTED`,type:'sys'},
  ])
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({behavior:'smooth'}) }, [lines])

  useEffect(() => {
    const t = setInterval(() => {
      const cmd = TERMINAL_CMDS[Math.floor(Math.random()*TERMINAL_CMDS.length)]
      const hex  = Math.random().toString(16).slice(2,8).toUpperCase()
      setLines(p => [...p.slice(-50), {text:`> ${cmd}... [0x${hex}]`,type:'cmd'}])
    }, 2000 + Math.random()*3000)
    return () => clearInterval(t)
  }, [])

  const send = () => {
    if (!input.trim()) return
    setLines(p => [...p, {text:`${nickname}: ${input}`,type:'user'}])
    setInput('')
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%',
      background:'rgba(255,255,255,0.75)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
      border:'1.5px solid rgba(14,30,54,0.12)', borderRadius:14, overflow:'hidden' }}>
      <div style={{ padding:'8px 12px', borderBottom:'1px solid rgba(14,30,54,0.08)',
        fontFamily:'"DM Mono",monospace', fontSize:9, color:'#475569', letterSpacing:'0.12em',
        display:'flex', alignItems:'center', gap:6 }}>
        <div style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e' }} />
        HACKING MATRIX — SECURE CHAT
      </div>
      <div style={{ flex:1, overflow:'auto', padding:'8px 10px', display:'flex', flexDirection:'column', gap:3 }}>
        {lines.map((l,i) => (
          <div key={i} style={{
            fontFamily:'"DM Mono",monospace', fontSize:9,
            color: l.type==='sys'?'#0369a1' : l.type==='user'?'#0f172a' : '#94a3b8',
            fontWeight: l.type==='user'?600:400,
          }}>{l.text}</div>
        ))}
        <div ref={endRef}/>
      </div>
      <div style={{ display:'flex', borderTop:'1px solid rgba(14,30,54,0.08)' }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}
          placeholder="TYPE COMMAND..."
          style={{ flex:1, background:'transparent', border:'none', padding:'8px 12px',
            fontFamily:'"DM Mono",monospace', fontSize:9, color:'#0f172a', outline:'none' }}
        />
        <button onClick={send} style={{ background:'rgba(14,30,54,0.05)', border:'none', borderLeft:'1px solid rgba(14,30,54,0.08)',
          padding:'8px 12px', color:'#475569', cursor:'pointer', fontFamily:'"DM Mono",monospace', fontSize:9 }}>
          SEND
        </button>
      </div>
    </div>
  )
}

// ─── Game Stats Panel ─────────────────────────────────────────────────────────
function GameStats({ devices, calledNums, bankruptCount, liveBank, nickname }: {
  devices:Device[]; calledNums:Set<number>; bankruptCount:number; liveBank:number; nickname:string
}) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, height:'100%' }}>
      <div style={{ background:'rgba(255,255,255,0.8)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
        border:'1.5px solid rgba(14,30,54,0.12)', borderRadius:14, padding:14, flex:1 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#94a3b8', letterSpacing:'0.12em' }}>GAME STATS</div>
          <div style={{ width:28, height:28, borderRadius:'50%', background:'rgba(14,30,54,0.08)',
            display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>💬</div>
        </div>
        {[
          ['AGENT', nickname.toUpperCase()],
          ['TARGET BANK', BANKS[liveBank].name],
          ['NUMBERS DRAWN', `${calledNums.size}/90`],
          ['YOUR DEVICES', devices.length],
          ['ACTIVE', devices.filter(d=>d.active&&!d.corrupted).length],
          ['BANKRUPTS', `${bankruptCount}/3`],
          ['VAULT', bankruptCount>=3?'💀 BANKRUPT':'🔴 LIVE'],
        ].map(([k,v]) => (
          <div key={k as string} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid rgba(14,30,54,0.06)' }}>
            <span style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#94a3b8' }}>{k}</span>
            <span style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#0f172a', fontWeight:600 }}>{v as string}</span>
          </div>
        ))}
      </div>

      {/* Win conditions legend */}
      <div style={{ background:'rgba(255,255,255,0.75)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
        border:'1.5px solid rgba(14,30,54,0.1)', borderRadius:12, padding:10 }}>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#94a3b8', marginBottom:8, letterSpacing:'0.1em' }}>ANTENNA KEY</div>
        {(Object.entries(ANTENNA_COLORS) as [WinType,string][]).map(([type,color]) => (
          <div key={type} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:color, flexShrink:0 }}/>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:7.5, color:'#475569' }}>{WIN_LABELS[type]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Nickname Modal ───────────────────────────────────────────────────────────
function NicknameModal({ onConfirm }: { onConfirm: (name:string)=>void }) {
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const submit = () => {
    if (name.trim().length < 3) { setErr('Min 3 characters'); return }
    if (name.trim().length > 16) { setErr('Max 16 characters'); return }
    onConfirm(name.trim())
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(248,250,252,0.85)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'rgba(255,255,255,0.95)', border:'1.5px solid rgba(14,30,54,0.12)', borderRadius:20, padding:32, maxWidth:360, width:'90%',
        boxShadow:'0 24px 48px rgba(14,30,54,0.12)' }}>
        <div style={{ fontFamily:'"Syne",sans-serif', fontSize:22, fontWeight:800, color:'#0f172a', marginBottom:6 }}>RANSOME</div>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#94a3b8', letterSpacing:'0.15em', marginBottom:24 }}>HACK THE BANKS — CLAIM THE VAULT</div>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:10, color:'#475569', marginBottom:8 }}>CHOOSE YOUR AGENT NAME</div>
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
          placeholder="e.g. GHOST_ZERO"
          maxLength={16}
          style={{ width:'100%', background:'rgba(14,30,54,0.04)', border:'1.5px solid rgba(14,30,54,0.15)', borderRadius:10, padding:'10px 14px',
            fontFamily:'"DM Mono",monospace', fontSize:13, color:'#0f172a', outline:'none', boxSizing:'border-box', marginBottom:6 }}
        />
        {err && <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#ef4444', marginBottom:8 }}>{err}</div>}
        <button onClick={submit} style={{ width:'100%', background:'#0f172a', color:'#fff', border:'none', borderRadius:10,
          padding:'12px', fontFamily:'"Syne",sans-serif', fontSize:14, fontWeight:700, cursor:'pointer', marginTop:4 }}>
          ENTER THE MATRIX
        </button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Ransome() {
  const [phase, setPhase] = useState<string>('setup')  // setup | lobby | game
  const [nickname, setNickname] = useState('')
  const [wallet, setWallet] = useState<string|null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [calledNums, setCalledNums] = useState<Set<number>>(new Set())
  const [calledOrder, setCalledOrder] = useState<number[]>([])
  const [timer, setTimer] = useState(60)
  const [clickWindowOpen, setClickWindowOpen] = useState(false)
  const [announcement, setAnnouncement] = useState<string|null>(null)
  const [bankruptCount, setBankruptCount] = useState(0)
  const [mintCount, setMintCount] = useState(1)
  const [mintToken, setMintToken] = useState('USDT')
  const [selectedBank, setSelectedBank] = useState<number|null>(null)
  const [devicesExpanded, setDevicesExpanded] = useState(false)
  const [winStates, setWinStates] = useState<Record<WinType,{claimed:boolean;claimable:boolean}>>({
    EARLY_FIVE:   {claimed:false,claimable:false},
    TOP_LINE:     {claimed:false,claimable:false},
    MIDDLE_LINE:  {claimed:false,claimable:false},
    BOTTOM_LINE:  {claimed:false,claimable:false},
    FULL_HOUSE_1: {claimed:false,claimable:false},
    FULL_HOUSE_2: {claimed:false,claimable:false},
    FULL_HOUSE_3: {claimed:false,claimable:false},
  })

  const timerRef   = useRef<ReturnType<typeof setInterval>|null>(null)
  const currentHour = new Date().getUTCHours()
  const liveBank   = getLiveBank(currentHour)
  const currentNum = calledOrder[calledOrder.length - 1] ?? null

  const announce = (msg: string) => { setAnnouncement(msg); setTimeout(()=>setAnnouncement(null), 4000) }

  const drawNumber = useCallback(() => {
    setClickWindowOpen(false)
    setCalledNums(prev => {
      if (prev.size >= 90) return prev
      const remaining = Array.from({length:90},(_,i)=>i+1).filter(n=>!prev.has(n))
      if (!remaining.length) return prev
      const num = remaining[Math.floor(Math.random()*remaining.length)]
      setCalledOrder(o => [...o, num])
      // Mark matched on devices
      setDevices(ds => ds.map(d => {
        if (!d.active || d.corrupted) return d
        const newGrid = d.grid.map(row => row.map(cell => {
          if (cell.num === num) return {...cell, matched:true, justCalled:true}
          return {...cell, justCalled:false}
        }))
        return {...d, grid:newGrid}
      }))
      // Open click window
      setTimeout(() => setClickWindowOpen(true), 100)
      return new Set(Array.from(prev).concat([num]))
    })
  }, [])

  // Close click window when timer expires (next number draws)
  const handleTimerTick = useCallback(() => {
    setTimer(t => {
      if (t <= 1) {
        setClickWindowOpen(false)
        drawNumber()
        return 60 + Math.floor(Math.random()*30)
      }
      return t - 1
    })
  }, [drawNumber])

  useEffect(() => {
    if (phase !== 'game') return
    timerRef.current = setInterval(handleTimerTick, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [phase, handleTimerTick])

  // Check win conditions whenever devices change
  useEffect(() => {
    if (phase !== 'game') return
    setWinStates(prev => {
      const next = {...prev}
      devices.forEach(d => {
        if (!d.active || d.corrupted) return
        const allCells = d.grid.flat()
        const clicked = allCells.filter(c=>c.clicked)
        if (clicked.length >= 5) next.EARLY_FIVE = {...next.EARLY_FIVE, claimable:true}
        if (d.grid[0].filter(c=>c.num).every(c=>c.clicked)) next.TOP_LINE = {...next.TOP_LINE, claimable:true}
        if (d.grid[1].filter(c=>c.num).every(c=>c.clicked)) next.MIDDLE_LINE = {...next.MIDDLE_LINE, claimable:true}
        if (d.grid[2].filter(c=>c.num).every(c=>c.clicked)) next.BOTTOM_LINE = {...next.BOTTOM_LINE, claimable:true}
        if (allCells.filter(c=>c.num).every(c=>c.clicked)) {
          const fhKey = `FULL_HOUSE_${Math.min(bankruptCount+1,3)}` as WinType
          next[fhKey] = {...next[fhKey], claimable:true}
        }
      })
      return next
    })
  }, [devices, phase])

  const handleCellClick = (deviceId:number, row:number, col:number) => {
    if (!clickWindowOpen) return
    setDevices(ds => ds.map(d => {
      if (d.id !== deviceId) return d
      const cell = d.grid[row][col]
      if (!cell.num || cell.num !== currentNum || cell.clicked) return d
      const newGrid = d.grid.map((r,ri) => r.map((c,ci) =>
        ri===row && ci===col ? {...c, clicked:true, justCalled:false} : c
      ))
      return {...d, grid:newGrid}
    }))
  }

  const handleClaim = (deviceId:number, winType:WinType) => {
    if (winStates[winType].claimed) return
    setDevices(ds => ds.map(d => {
      if (d.id !== deviceId) return d
      return {...d, claimed: new Set(Array.from(d.claimed).concat([winType]))}
    }))
    setWinStates(prev => ({...prev, [winType]: {...prev[winType], claimed:true}}))
    announce(`✅ ${WIN_LABELS[winType]} — CLAIMED!`)
    if (winType.startsWith('FULL_HOUSE')) setBankruptCount(b=>Math.min(b+1,3))
  }

  const startGame = () => {
    setPhase('game')
    drawNumber()
    announce('🔴 HACK INITIATED — RANSOME BANK BROADCAST LIVE')
  }

  const mintDevices = () => {
    const newDevices = Array.from({length:mintCount},(_,i)=>generateDevice(devices.length+i))
    setDevices(prev => [...prev, ...newDevices])
    announce(`⚡ ${mintCount} DEVICE${mintCount>1?'S':''} MINTED — TARGET: ${BANKS[selectedBank??liveBank].name}`)
  }

  // ── Setup / Nickname screen ───────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#f0f4f8 0%,#e8eef7 100%)' }}>
        <NicknameModal onConfirm={name => { setNickname(name); setPhase('lobby') }} />
      </div>
    )
  }

  // ── Lobby ────────────────────────────────────────────────────────────────
  if (phase === 'lobby') {
    return (
      <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#f0f4f8 0%,#e8eef7 100%)', color:'#0f172a', padding:'20px 16px' }}>
        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div>
            <div style={{ fontFamily:'"Syne",sans-serif', fontSize:26, fontWeight:800, color:'#0f172a' }}>RANSOME</div>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#94a3b8', letterSpacing:'0.18em' }}>HACK THE BANKS — CLAIM THE VAULT</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#475569', background:'rgba(14,30,54,0.06)', border:'1px solid rgba(14,30,54,0.1)', borderRadius:8, padding:'5px 10px' }}>
              👤 {nickname}
            </div>
            <button onClick={()=>setWallet('HaCk...3r0x')} style={{
              background: wallet ? 'rgba(34,197,94,0.1)' : '#0f172a', color: wallet ? '#15803d' : '#fff',
              border: wallet ? '1px solid rgba(34,197,94,0.3)' : 'none',
              borderRadius:8, padding:'6px 14px', fontFamily:'"DM Mono",monospace', fontSize:9, cursor:'pointer', fontWeight:600,
            }}>
              {wallet ? `✓ ${wallet}` : 'CONNECT WALLET'}
            </button>
          </div>
        </div>

        {/* Live bank */}
        <div style={{ background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:14, padding:'14px 16px', marginBottom:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#ef4444', letterSpacing:'0.15em', marginBottom:2 }}>🔴 LIVE NOW — 1 HOUR WINDOW</div>
            <div style={{ fontFamily:'"Syne",sans-serif', fontSize:20, fontWeight:800, color:'#0f172a' }}>{BANKS[liveBank].name}</div>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#94a3b8' }}>{BANKS[liveBank].city} · UTC{BANKS[liveBank].tz>=0?'+':''}{BANKS[liveBank].tz}</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#94a3b8' }}>VAULT</div>
            <div style={{ fontFamily:'"Syne",sans-serif', fontSize:22, fontWeight:800, color:'#0f172a' }}>$1,000,000</div>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:7, color:'#94a3b8' }}>1M DEVICES @ $1</div>
          </div>
        </div>

        {/* World map */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#94a3b8', letterSpacing:'0.12em', marginBottom:6 }}>GLOBAL BANK NETWORK — TAP TO SELECT TARGET</div>
          <WorldMap selectedBank={selectedBank} onSelect={setSelectedBank} currentHour={currentHour} />
        </div>

        {/* Mint */}
        {wallet && (
          <div style={{ background:'rgba(255,255,255,0.8)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', border:'1.5px solid rgba(14,30,54,0.1)', borderRadius:14, padding:14, marginBottom:14 }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#94a3b8', letterSpacing:'0.12em', marginBottom:10 }}>MINT HACKING DEVICES</div>
            <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
              {['USDT','USDC','SOL','RNSM'].map(t=>(
                <button key={t} onClick={()=>setMintToken(t)} style={{
                  background:mintToken===t?'#0f172a':'transparent', color:mintToken===t?'#fff':'#64748b',
                  border:`1px solid ${mintToken===t?'#0f172a':'rgba(14,30,54,0.15)'}`,
                  borderRadius:7, padding:'5px 12px', fontFamily:'"DM Mono",monospace', fontSize:9, cursor:'pointer',
                }}>{t}</button>
              ))}
            </div>
            <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:10, flexWrap:'wrap' }}>
              <span style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#94a3b8' }}>QTY:</span>
              {[1,3,5,10].map(n=>(
                <button key={n} onClick={()=>setMintCount(n)} style={{
                  background:mintCount===n?'#0f172a':'transparent', color:mintCount===n?'#fff':'#64748b',
                  border:`1px solid ${mintCount===n?'#0f172a':'rgba(14,30,54,0.15)'}`,
                  borderRadius:7, padding:'4px 10px', fontFamily:'"DM Mono",monospace', fontSize:9, cursor:'pointer',
                }}>{n}</button>
              ))}
              <input type="number" value={mintCount} onChange={e=>setMintCount(Math.max(1,parseInt(e.target.value)||1))}
                style={{ width:56, background:'transparent', border:'1px solid rgba(14,30,54,0.15)', borderRadius:7, padding:'4px 8px', fontFamily:'"DM Mono",monospace', fontSize:9, color:'#0f172a', outline:'none' }}
              />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#0f172a', fontWeight:600 }}>
                {mintCount} {mintToken}
              </div>
              <button onClick={mintDevices} style={{ background:'#0f172a', color:'#fff', border:'none', borderRadius:9, padding:'9px 20px', fontFamily:'"DM Mono",monospace', fontSize:10, cursor:'pointer', fontWeight:600 }}>
                MINT DEVICES →
              </button>
            </div>
          </div>
        )}

        {devices.length > 0 && (
          <button onClick={startGame} style={{ width:'100%', background:'#ef4444', color:'#fff', border:'none', borderRadius:12, padding:'14px', fontFamily:'"Syne",sans-serif', fontSize:16, fontWeight:800, cursor:'pointer', boxShadow:'0 4px 16px rgba(239,68,68,0.3)' }}>
            🔴 INITIATE HACK — {devices.length} DEVICE{devices.length>1?'S':''} READY
          </button>
        )}

        {announcement && (
          <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background:'rgba(255,255,255,0.95)', border:'1px solid rgba(14,30,54,0.12)', borderRadius:10, padding:'10px 20px', fontFamily:'"DM Mono",monospace', fontSize:10, color:'#0f172a', zIndex:999, whiteSpace:'nowrap', boxShadow:'0 8px 24px rgba(14,30,54,0.12)' }}>
            {announcement}
          </div>
        )}
      </div>
    )
  }

  // ── Game ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#f0f4f8 0%,#e8eef7 100%)', color:'#0f172a' }}>
      {/* Header */}
      <div style={{ padding:'8px 16px', borderBottom:'1px solid rgba(14,30,54,0.08)', display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(255,255,255,0.6)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)' }}>
        <div style={{ fontFamily:'"Syne",sans-serif', fontSize:18, fontWeight:800, color:'#0f172a' }}>RANSOME</div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#ef4444', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:6, padding:'3px 8px' }}>
            🔴 {BANKS[liveBank].name}
          </div>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#64748b', background:'rgba(14,30,54,0.06)', borderRadius:6, padding:'3px 8px' }}>
            👤 {nickname}
          </div>
        </div>
      </div>

      {/* 3-column layout */}
      <div style={{ padding:'12px 14px', display:'grid', gridTemplateColumns:'1fr 1.8fr 1fr', gap:12, height:'calc(60vh - 48px)', minHeight:380 }}>
        {/* Left: Game stats */}
        <GameStats devices={devices} calledNums={calledNums} bankruptCount={bankruptCount} liveBank={liveBank} nickname={nickname} />

        {/* Centre: Matrix numbers */}
        <HackingMatrix calledNums={calledNums} calledOrder={calledOrder} timer={timer} clickWindowOpen={clickWindowOpen} />

        {/* Right: Minted devices list + chat */}
        <div style={{ display:'flex', flexDirection:'column', gap:10, height:'100%' }}>
          {/* Devices summary */}
          <div style={{ background:'rgba(255,255,255,0.8)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', border:'1.5px solid rgba(14,30,54,0.1)', borderRadius:12, padding:10 }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#94a3b8', marginBottom:6, letterSpacing:'0.1em' }}>MINTED DEVICES</div>
            <div style={{ display:'flex', flexDirection:'column', gap:4, maxHeight:100, overflow:'auto' }}>
              {devices.map(d => (
                <div key={d.id} style={{ display:'flex', justifyContent:'space-between', fontFamily:'"DM Mono",monospace', fontSize:8 }}>
                  <span style={{ color:'#64748b' }}>DEV-{String(d.id).padStart(5,'0')}</span>
                  <span style={{ color:'#22c55e' }}>{d.grid.flat().filter(c=>c.clicked).length} clicked</span>
                </div>
              ))}
            </div>
            <button onClick={() => {
              const d = generateDevice(devices.length)
              setDevices(prev => [...prev, d])
            }} style={{ marginTop:8, width:'100%', background:'rgba(14,30,54,0.06)', border:'1px solid rgba(14,30,54,0.1)', borderRadius:7, padding:'5px', fontFamily:'"DM Mono",monospace', fontSize:8, color:'#475569', cursor:'pointer' }}>
              + MINT DEVICE
            </button>
          </div>
          {/* Chat */}
          <div style={{ flex:1 }}>
            <ChatTerminal nickname={nickname} />
          </div>
        </div>
      </div>

      {/* Win conditions strip */}
      <div style={{ padding:'6px 14px', display:'flex', gap:6, overflowX:'auto', borderTop:'1px solid rgba(14,30,54,0.06)', borderBottom:'1px solid rgba(14,30,54,0.06)', background:'rgba(255,255,255,0.5)' }}>
        {(Object.entries(WIN_LABELS) as [WinType,string][]).map(([type, label]) => {
          const st = winStates[type]
          return (
            <div key={type} style={{ display:'flex', gap:5, alignItems:'center', padding:'4px 10px', borderRadius:8, flexShrink:0,
              background: st.claimed?'rgba(34,197,94,0.08)' : st.claimable?'rgba(236,72,153,0.08)' : 'transparent',
              border: st.claimed?'1px solid rgba(34,197,94,0.25)' : st.claimable?'1px solid rgba(236,72,153,0.35)' : '1px solid rgba(14,30,54,0.08)',
            }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:ANTENNA_COLORS[type], opacity: st.claimed?0.4:1 }}/>
              <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color: st.claimed?'#22c55e' : st.claimable?'#ec4899' : '#94a3b8' }}>
                {st.claimed?'✓ ':st.claimable?'⚡ ':'○ '}{label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Hacking devices — 2-column grid, no auto-scroll */}
      <div style={{ padding:'12px 14px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#94a3b8', letterSpacing:'0.1em' }}>
            HACKING DEVICES ({devices.length})
          </div>
          <button onClick={()=>setDevicesExpanded(e=>!e)} style={{ background:'rgba(14,30,54,0.06)', border:'1px solid rgba(14,30,54,0.1)', color:'#475569', borderRadius:7, padding:'4px 10px', fontFamily:'"DM Mono",monospace', fontSize:8, cursor:'pointer' }}>
            {devicesExpanded ? '⊟ COLLAPSE' : '⊞ SWIPE MODE'}
          </button>
        </div>

        {devicesExpanded ? (
          // Horizontal swipe, ~10 devices visible
          <div style={{ overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
            <div style={{ display:'flex', gap:10, paddingBottom:8, width:'max-content' }}>
              {devices.map(device => (
                <div key={device.id} style={{ width:'min(44vw,200px)', flexShrink:0 }}>
                  <HackingDevice device={device} currentNum={currentNum} clickWindowOpen={clickWindowOpen}
                    calledNums={calledNums} onCellClick={handleCellClick} onClaim={handleClaim}
                    winStates={winStates} bankruptCount={bankruptCount} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          // 2-column grid
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10 }}>
            {devices.map(device => (
              <HackingDevice key={device.id} device={device} currentNum={currentNum} clickWindowOpen={clickWindowOpen}
                calledNums={calledNums} onCellClick={handleCellClick} onClaim={handleClaim}
                winStates={winStates} bankruptCount={bankruptCount} />
            ))}
          </div>
        )}
      </div>

      {/* Announcement */}
      {announcement && (
        <div style={{ position:'fixed', top:60, left:'50%', transform:'translateX(-50%)', background:'rgba(255,255,255,0.95)', border:'1px solid rgba(14,30,54,0.1)', borderRadius:10, padding:'10px 20px', fontFamily:'"DM Mono",monospace', fontSize:10, color:'#0f172a', zIndex:999, whiteSpace:'nowrap', boxShadow:'0 8px 24px rgba(14,30,54,0.12)' }}>
          {announcement}
        </div>
      )}
    </div>
  )
}
