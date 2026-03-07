'use client'
import './globals.css'
import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────
type Cell = { num: number | null; matched: boolean; clicked: boolean }
type Device = {
  id: number
  grid: Cell[][]
  claimed: Set<string>
  corrupted: boolean
  active: boolean
  matchCount: number
  clickedCount: number
}
type WinType = 'EARLY_FIVE' | 'TOP_LINE' | 'MIDDLE_LINE' | 'BOTTOM_LINE' | 'FULL_HOUSE_1' | 'FULL_HOUSE_2' | 'FULL_HOUSE_3'
type Phase = string

// ─── 23 World Banks ──────────────────────────────────────────────────────────
const BANKS = [
  { id: 0,  name: 'Pacific Reserve',     city: 'Auckland',      tz: 12,  x: 88, y: 75 },
  { id: 1,  name: 'Sakura Central',      city: 'Tokyo',         tz: 9,   x: 80, y: 30 },
  { id: 2,  name: 'Dragon Vault',        city: 'Shanghai',      tz: 8,   x: 76, y: 33 },
  { id: 3,  name: 'Tiger Bank',          city: 'Singapore',     tz: 8,   x: 74, y: 52 },
  { id: 4,  name: 'Indus Capital',       city: 'Mumbai',        tz: 5.5, x: 65, y: 38 },
  { id: 5,  name: 'Gulf Reserve',        city: 'Dubai',         tz: 4,   x: 60, y: 38 },
  { id: 6,  name: 'Red Sea Bank',        city: 'Riyadh',        tz: 3,   x: 57, y: 38 },
  { id: 7,  name: 'Nile Treasury',       city: 'Cairo',         tz: 2,   x: 53, y: 35 },
  { id: 8,  name: 'Savanna Vault',       city: 'Nairobi',       tz: 3,   x: 56, y: 56 },
  { id: 9,  name: 'Cape Reserve',        city: 'Cape Town',     tz: 2,   x: 52, y: 73 },
  { id: 10, name: 'Colosseum Bank',      city: 'Rome',          tz: 1,   x: 49, y: 27 },
  { id: 11, name: 'Rhine Vault',         city: 'Frankfurt',     tz: 1,   x: 49, y: 22 },
  { id: 12, name: 'Thames Capital',      city: 'London',        tz: 0,   x: 46, y: 21 },
  { id: 13, name: 'Nordic Reserve',      city: 'Oslo',          tz: 1,   x: 49, y: 16 },
  { id: 14, name: 'Kremlin Bank',        city: 'Moscow',        tz: 3,   x: 56, y: 18 },
  { id: 15, name: 'Azores Vault',        city: 'Lisbon',        tz: 0,   x: 44, y: 27 },
  { id: 16, name: 'Atlas Treasury',      city: 'Casablanca',    tz: 1,   x: 44, y: 33 },
  { id: 17, name: 'Amazon Reserve',      city: 'São Paulo',     tz: -3,  x: 32, y: 66 },
  { id: 18, name: 'Carnival Bank',       city: 'Rio',           tz: -3,  x: 33, y: 68 },
  { id: 19, name: 'Andes Vault',         city: 'Bogotá',        tz: -5,  x: 25, y: 54 },
  { id: 20, name: 'Manhattan Capital',   city: 'New York',      tz: -5,  x: 22, y: 28 },
  { id: 21, name: 'Silicon Reserve',     city: 'San Francisco', tz: -8,  x: 10, y: 30 },
  { id: 22, name: 'Maple Treasury',      city: 'Toronto',       tz: -5,  x: 21, y: 24 },
]

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
  EARLY_FIVE:   '#ffe600',
  TOP_LINE:     '#00cfff',
  MIDDLE_LINE:  '#39ff14',
  BOTTOM_LINE:  '#8b4513',
  FULL_HOUSE_1: '#ff69b4',
  FULL_HOUSE_2: '#ff1493',
  FULL_HOUSE_3: '#ff007f',
}

const TERMINAL_CMDS = [
  'INIT PAYLOAD INJECTION...', 'BYPASSING FIREWALL LAYER 3...', 'SCANNING PORT 8443...',
  'BRUTE FORCE SHA-256 HASH...', 'DECRYPTING TLS HANDSHAKE...', 'EXPLOITING CVE-2024-1337...',
  'INJECTING SQL PAYLOAD...', 'PIVOTING THROUGH SUBNET...', 'EXFILTRATING VAULT KEYS...',
  'SPOOFING MAC ADDRESS...', 'ARP POISONING GATEWAY...', 'DUMPING LSASS MEMORY...',
  'LATERAL MOVEMENT DETECTED...', 'ESCALATING PRIVILEGES...', 'DEPLOYING ROOTKIT...',
  'TUNNELING THROUGH SSH...', 'SNIFFING PACKETS ON ETH0...', 'CRACKING WPA2 HANDSHAKE...',
  'EXPLOITING BUFFER OVERFLOW...', 'UPLOADING RANSOMWARE PAYLOAD...', 'COVERING TRACKS...',
]

// ─── Ticket Generator ────────────────────────────────────────────────────────
function generateDevice(id: number): Device {
  const cols = [[1,10],[11,20],[21,30],[31,40],[41,50],[51,60],[61,70],[71,80],[81,90]]
  const grid: Cell[][] = Array.from({length:3}, () => Array(9).fill(null).map(() => ({num:null,matched:false,clicked:false})))
  for (let row = 0; row < 3; row++) {
    const colIndices = Array.from({length:9},(_,i)=>i)
    const chosen = colIndices.sort(() => Math.random()-0.5).slice(0,5).sort((a,b)=>a-b)
    for (const ci of chosen) {
      const [lo, hi] = cols[ci]
      let num: number
      do { num = Math.floor(Math.random()*(hi-lo+1))+lo } while (
        grid.some(r => r[ci].num === num)
      )
      grid[row][ci] = { num, matched: false, clicked: false }
    }
  }
  return { id, grid, claimed: new Set(), corrupted: false, active: false, matchCount: 0, clickedCount: 0 }
}

// ─── World Map SVG ───────────────────────────────────────────────────────────
function WorldMap({ activeBank, onSelectBank, currentHour }: {
  activeBank: number | null
  onSelectBank: (id: number) => void
  currentHour: number
}) {
  return (
    <div style={{ position:'relative', width:'100%', background:'#020d1a', border:'1px solid #0a3a5a', borderRadius:16, overflow:'hidden', paddingTop:'50%' }}>
      <div style={{ position:'absolute', inset:0 }}>
        {/* Grid lines */}
        {Array.from({length:12},(_,i) => (
          <div key={i} style={{ position:'absolute', left:`${(i/12)*100}%`, top:0, bottom:0, borderLeft:'1px solid #0a2535', width:1 }} />
        ))}
        {Array.from({length:6},(_,i) => (
          <div key={i} style={{ position:'absolute', top:`${(i/6)*100}%`, left:0, right:0, borderTop:'1px solid #0a2535', height:1 }} />
        ))}
        {/* Continent blobs (simplified SVG paths as background) */}
        <svg viewBox="0 0 100 100" style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity:0.15 }}>
          {/* North America */}
          <ellipse cx="18" cy="28" rx="12" ry="14" fill="#1e4a7a" />
          {/* South America */}
          <ellipse cx="28" cy="62" rx="7" ry="14" fill="#1e4a7a" />
          {/* Europe */}
          <ellipse cx="49" cy="22" rx="6" ry="8" fill="#1e4a7a" />
          {/* Africa */}
          <ellipse cx="50" cy="52" rx="7" ry="16" fill="#1e4a7a" />
          {/* Asia */}
          <ellipse cx="70" cy="28" rx="18" ry="14" fill="#1e4a7a" />
          {/* Australia */}
          <ellipse cx="82" cy="65" rx="7" ry="6" fill="#1e4a7a" />
        </svg>
        {/* Bank dots */}
        {BANKS.map(bank => {
          const bankHour = ((currentHour + bank.tz) % 24 + 24) % 24
          const isActive = Math.floor(bankHour) === activeBank ? true : bank.id === activeBank
          const isLive = bank.id === getLiveBank(currentHour)
          return (
            <button key={bank.id} onClick={() => onSelectBank(bank.id)} style={{
              position:'absolute', left:`${bank.x}%`, top:`${bank.y}%`,
              transform:'translate(-50%,-50%)',
              width: isLive ? 14 : 10,
              height: isLive ? 14 : 10,
              borderRadius:'50%',
              background: isLive ? '#ff0040' : bank.id === activeBank ? '#00e5a0' : '#1e4a7a',
              border: isLive ? '2px solid #ff4060' : '1px solid #00b8ff',
              cursor:'pointer', padding:0,
              boxShadow: isLive ? '0 0 12px #ff0040, 0 0 24px #ff004060' : bank.id === activeBank ? '0 0 8px #00e5a0' : 'none',
              animation: isLive ? 'pulse 1s infinite' : 'none',
              zIndex: isLive ? 10 : 1,
            }} title={`${bank.name} - ${bank.city}`} />
          )
        })}
        {/* Live bank label */}
        {(() => {
          const live = BANKS[getLiveBank(currentHour)]
          return (
            <div style={{ position:'absolute', left:`${live.x}%`, top:`${live.y - 8}%`, transform:'translateX(-50%)', whiteSpace:'nowrap', fontFamily:'"DM Mono",monospace', fontSize:9, color:'#ff4060', background:'#020d1a', padding:'2px 6px', borderRadius:4, border:'1px solid #ff004040' }}>
              🔴 LIVE: {live.name}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function getLiveBank(hour: number): number {
  return hour % 23
}

// ─── Antenna Component ───────────────────────────────────────────────────────
function Antenna({ color, broken, blinking }: { color: string; broken: boolean; blinking: boolean }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
      {broken ? (
        <div style={{ display:'flex', gap:1, alignItems:'flex-end' }}>
          <div style={{ width:2, height:6, background:'#444', transform:'rotate(20deg)' }} />
          <div style={{ width:2, height:4, background:'#444', transform:'rotate(-15deg)' }} />
        </div>
      ) : (
        <>
          <div style={{
            width:6, height:6, borderRadius:'50%',
            background: color,
            boxShadow: blinking ? `0 0 8px ${color}, 0 0 16px ${color}60` : 'none',
            animation: blinking ? 'antennaBlink 0.5s infinite' : 'none',
          }} />
          <div style={{ width:2, height:8, background: color, opacity: broken ? 0.2 : 0.8 }} />
        </>
      )}
    </div>
  )
}

// ─── Hacking Device ──────────────────────────────────────────────────────────
function HackingDevice({ device, calledNums, onCellClick, onClaim, winStates, bankruptCount }: {
  device: Device
  calledNums: Set<number>
  onCellClick: (deviceId: number, row: number, col: number) => void
  onClaim: (deviceId: number, winType: WinType) => void
  winStates: Record<WinType, { claimed: boolean; claimable: boolean }>
  bankruptCount: number
}) {
  const clickedCount = device.grid.flat().filter(c => c.clicked).length
  const canClaimEarly = clickedCount >= 5 && !device.claimed.has('EARLY_FIVE') && winStates.EARLY_FIVE.claimable && !winStates.EARLY_FIVE.claimed
  const row0All = device.grid[0].filter(c=>c.num).every(c=>c.clicked)
  const row1All = device.grid[1].filter(c=>c.num).every(c=>c.clicked)
  const row2All = device.grid[2].filter(c=>c.num).every(c=>c.clicked)
  const allClicked = device.grid.flat().filter(c=>c.num).every(c=>c.clicked)

  const canClaimTop = row0All && !device.claimed.has('TOP_LINE') && winStates.TOP_LINE.claimable && !winStates.TOP_LINE.claimed
  const canClaimMid = row1All && !device.claimed.has('MIDDLE_LINE') && winStates.MIDDLE_LINE.claimable && !winStates.MIDDLE_LINE.claimed
  const canClaimBot = row2All && !device.claimed.has('BOTTOM_LINE') && winStates.BOTTOM_LINE.claimable && !winStates.BOTTOM_LINE.claimed
  const canClaimFH = allClicked && !device.claimed.has(`FULL_HOUSE_${bankruptCount+1}`) && winStates[`FULL_HOUSE_${Math.min(bankruptCount+1,3)}` as WinType]?.claimable

  const anyClaim = canClaimEarly || canClaimTop || canClaimMid || canClaimBot || canClaimFH

  // Determine which antennae to show
  const antennae: { type: WinType; color: string }[] = [
    { type: 'EARLY_FIVE', color: '#ffe600' },
    { type: 'TOP_LINE', color: '#00cfff' },
    { type: 'MIDDLE_LINE', color: '#39ff14' },
    { type: 'BOTTOM_LINE', color: '#8b4513' },
    { type: 'FULL_HOUSE_1', color: '#ff69b4' },
    { type: 'FULL_HOUSE_2', color: '#ff1493' },
    { type: 'FULL_HOUSE_3', color: '#ff007f' },
  ]

  return (
    <div style={{
      background: device.corrupted ? '#1a0808' : '#040f1e',
      border: anyClaim ? '2px solid #ff69b4' : device.corrupted ? '1px solid #5a0010' : '1px solid #0a2a4a',
      borderRadius:12, padding:'10px 8px',
      boxShadow: anyClaim ? '0 0 20px #ff69b460' : device.corrupted ? '0 0 10px #5a001040' : '0 4px 16px #00000080',
      display:'flex', flexDirection:'column', gap:6,
      opacity: device.corrupted ? 0.6 : 1,
      position:'relative', overflow:'hidden',
    }}>
      {/* Antennae row */}
      <div style={{ display:'flex', justifyContent:'space-around', paddingBottom:4, borderBottom:'1px solid #0a2a4a' }}>
        {antennae.map(a => (
          <Antenna key={a.type}
            color={a.color}
            broken={winStates[a.type]?.claimed && !device.claimed.has(a.type)}
            blinking={winStates[a.type]?.claimable && !winStates[a.type]?.claimed}
          />
        ))}
      </div>

      {/* Device ID */}
      <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#2a5a7a', textAlign:'center' }}>
        DEV#{String(device.id).padStart(6,'0')}
      </div>

      {/* Grid */}
      {device.grid.map((row, ri) => (
        <div key={ri} style={{ display:'grid', gridTemplateColumns:'repeat(9,1fr)', gap:2 }}>
          {row.map((cell, ci) => {
            const isClickable = cell.num !== null && calledNums.has(cell.num) && !cell.clicked
            const isClicked = cell.clicked
            const isEmpty = cell.num === null
            return (
              <button key={ci} onClick={() => !isEmpty && !isClicked && onCellClick(device.id, ri, ci)}
                style={{
                  height:22, borderRadius:3, border:'none', cursor: isClickable ? 'pointer' : 'default',
                  background: isEmpty ? 'transparent' :
                    isClicked ? '#00e5a0' :
                    isClickable ? '#0a3a2a' : '#040f1e',
                  color: isEmpty ? 'transparent' :
                    isClicked ? '#000' :
                    isClickable ? '#00e5a0' : '#1a3a5a',
                  fontFamily:'"DM Mono",monospace',
                  fontSize: 9,
                  fontWeight: isClicked ? 700 : 400,
                  position:'relative', overflow:'hidden',
                  boxShadow: isClicked ? '0 0 6px #00e5a060' : 'none',
                  // Glitch effect only on non-clickable non-empty cells
                  animation: (!isEmpty && !isClickable && !isClicked) ? `glitch${(ri*9+ci)%3} 3s ${(ri*9+ci)*0.1}s infinite` : 'none',
                }}
              >
                {cell.num ?? ''}
              </button>
            )
          })}
        </div>
      ))}

      {/* Claim button */}
      <button onClick={() => {
        if (canClaimEarly) onClaim(device.id, 'EARLY_FIVE')
        else if (canClaimTop) onClaim(device.id, 'TOP_LINE')
        else if (canClaimMid) onClaim(device.id, 'MIDDLE_LINE')
        else if (canClaimBot) onClaim(device.id, 'BOTTOM_LINE')
        else if (canClaimFH) onClaim(device.id, `FULL_HOUSE_${Math.min(bankruptCount+1,3)}` as WinType)
      }} disabled={!anyClaim} style={{
        background: anyClaim ? 'linear-gradient(135deg,#ff69b4,#ff1493)' : '#0a1a2a',
        color: anyClaim ? '#fff' : '#1a4a6a',
        border: anyClaim ? '1px solid #ff69b4' : '1px solid #0a2a4a',
        borderRadius:6, padding:'5px 0',
        fontFamily:'"DM Mono",monospace', fontSize:9, letterSpacing:'0.1em',
        cursor: anyClaim ? 'pointer' : 'default',
        boxShadow: anyClaim ? '0 0 12px #ff69b460' : 'none',
        fontWeight: 700,
      }}>
        {anyClaim ? '⚡ CLAIM RANSOME' : 'RANSOME'}
      </button>
    </div>
  )
}

// ─── Hacking Matrix Terminal ─────────────────────────────────────────────────
function HackingMatrix({ calledNums, calledOrder, timer }: {
  calledNums: Set<number>
  calledOrder: number[]
  timer: number
}) {
  const [termLines, setTermLines] = useState<string[]>([])
  const [displayNum, setDisplayNum] = useState<number | null>(null)
  const termRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const interval = setInterval(() => {
      const cmd = TERMINAL_CMDS[Math.floor(Math.random() * TERMINAL_CMDS.length)]
      const hex = Math.random().toString(16).slice(2,10).toUpperCase()
      setTermLines(prev => [...prev.slice(-20), `> ${cmd} [${hex}]`])
      if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
    }, 600 + Math.random() * 800)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Random number popup 60-90s
    const delay = (60 + Math.random() * 30) * 1000
    const t = setTimeout(() => {
      const n = calledOrder[calledOrder.length - 1]
      if (n) { setDisplayNum(n); setTimeout(() => setDisplayNum(null), 3000) }
    }, delay)
    return () => clearTimeout(t)
  }, [calledOrder])

  const lastNum = calledOrder[calledOrder.length - 1]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8, height:'100%' }}>
      {/* Main number display */}
      <div style={{
        background:'#020d1a', border:'2px solid #00e5a0', borderRadius:12,
        padding:'16px', textAlign:'center', position:'relative', overflow:'hidden',
      }}>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5', letterSpacing:'0.2em', marginBottom:4 }}>RANSOME BANK BROADCAST</div>
        <div style={{
          fontFamily:'"Syne",sans-serif', fontSize:64, fontWeight:800,
          color:'#00e5a0', lineHeight:1,
          textShadow:'0 0 20px #00e5a0, 0 0 40px #00e5a060',
          animation:'numberPulse 0.3s ease',
        }}>
          {lastNum ?? '--'}
        </div>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5', marginTop:4 }}>
          NEXT IN: <span style={{ color:'#ff5722' }}>{timer}s</span>
        </div>
        {/* Popup number */}
        {displayNum && (
          <div style={{
            position:'absolute', top:'10%', right:'10%',
            background:'#ff004040', border:'1px solid #ff0040',
            borderRadius:8, padding:'4px 10px',
            fontFamily:'"DM Mono",monospace', fontSize:14, color:'#ff4060',
            animation:'popIn 0.3s ease',
          }}>
            {displayNum}
          </div>
        )}
      </div>

      {/* Called numbers */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:3, justifyContent:'center' }}>
        {Array.from({length:90},(_,i)=>i+1).map(n => (
          <div key={n} style={{
            width:20, height:20, borderRadius:3,
            background: calledNums.has(n) ? '#00e5a020' : '#020d1a',
            border: calledNums.has(n) ? '1px solid #00e5a060' : '1px solid #0a2535',
            color: calledNums.has(n) ? '#00e5a0' : '#0a2535',
            fontFamily:'"DM Mono",monospace', fontSize:7,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            {n}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Terminal Chat ───────────────────────────────────────────────────────────
function TerminalChat() {
  const [lines, setLines] = useState<{text:string;type:'system'|'user'|'cmd'}[]>([
    { text:'HACKING MATRIX v3.7.1 INITIALIZED', type:'system' },
    { text:'SECURE CHANNEL ESTABLISHED', type:'system' },
    { text:'23 BANK NODES DETECTED', type:'system' },
  ])
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior:'smooth' })
  }, [lines])

  useEffect(() => {
    const interval = setInterval(() => {
      const cmd = TERMINAL_CMDS[Math.floor(Math.random() * TERMINAL_CMDS.length)]
      setLines(prev => [...prev.slice(-40), { text: cmd, type:'cmd' }])
    }, 3000 + Math.random() * 4000)
    return () => clearInterval(interval)
  }, [])

  const send = () => {
    if (!input.trim()) return
    setLines(prev => [...prev, { text: `USER: ${input}`, type:'user' }])
    setInput('')
    setTimeout(() => {
      setLines(prev => [...prev, { text: `> ${TERMINAL_CMDS[Math.floor(Math.random()*TERMINAL_CMDS.length)]}`, type:'cmd' }])
    }, 500)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'#010810', border:'1px solid #0a2535', borderRadius:12, overflow:'hidden' }}>
      <div style={{ padding:'8px 12px', borderBottom:'1px solid #0a2535', fontFamily:'"DM Mono",monospace', fontSize:9, color:'#00e5a0', letterSpacing:'0.15em' }}>
        ⬡ HACKING MATRIX — SECURE CHANNEL
      </div>
      <div style={{ flex:1, overflow:'auto', padding:10, display:'flex', flexDirection:'column', gap:4 }}>
        {lines.map((l, i) => (
          <div key={i} style={{
            fontFamily:'"DM Mono",monospace', fontSize:9,
            color: l.type==='system' ? '#00e5a0' : l.type==='user' ? '#00b8ff' : '#ff5722',
            opacity: l.type==='cmd' ? 0.7 : 1,
          }}>{l.text}</div>
        ))}
        <div ref={endRef} />
      </div>
      <div style={{ display:'flex', borderTop:'1px solid #0a2535' }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}
          placeholder="ENTER COMMAND..."
          style={{ flex:1, background:'transparent', border:'none', padding:'8px 12px', fontFamily:'"DM Mono",monospace', fontSize:9, color:'#00b8ff', outline:'none' }}
        />
        <button onClick={send} style={{ background:'#00e5a020', border:'none', borderLeft:'1px solid #0a2535', padding:'8px 12px', color:'#00e5a0', cursor:'pointer', fontFamily:'"DM Mono",monospace', fontSize:9 }}>
          SEND
        </button>
      </div>
    </div>
  )
}

// ─── Server Stats Panel ──────────────────────────────────────────────────────
function ServerStats({ devices, calledNums, bankruptCount }: { devices: Device[]; calledNums: Set<number>; bankruptCount: number }) {
  const activeDevices = devices.filter(d => d.active && !d.corrupted).length
  const totalClaims = devices.reduce((a, d) => a + d.claimed.size, 0)
  return (
    <div style={{ background:'#010810', border:'1px solid #0a2535', borderRadius:12, padding:12, fontFamily:'"DM Mono",monospace' }}>
      <div style={{ fontSize:9, color:'#00e5a0', letterSpacing:'0.15em', marginBottom:8 }}>⬡ SERVER STATS</div>
      {[
        ['NUMBERS DRAWN', `${calledNums.size}/90`],
        ['ACTIVE DEVICES', `${activeDevices}/${devices.length}`],
        ['TOTAL CLAIMS', totalClaims],
        ['BANKRUPTS', `${bankruptCount}/3`],
        ['VAULT STATUS', bankruptCount>=3 ? '💀 BANKRUPT' : '🔴 LIVE'],
      ].map(([k,v]) => (
        <div key={k as string} style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:8 }}>
          <span style={{ color:'#4a7fa5' }}>{k}</span>
          <span style={{ color:'#00e5a0' }}>{v}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function Ransome() {
  const [phase, setPhase] = useState<string>('lobby')
  const [wallet, setWallet] = useState<string|null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [calledNums, setCalledNums] = useState<Set<number>>(new Set())
  const [calledOrder, setCalledOrder] = useState<number[]>([])
  const [timer, setTimer] = useState(60)
  const [announcement, setAnnouncement] = useState<string|null>(null)
  const [bankruptCount, setBankruptCount] = useState(0)
  const [mintCount, setMintCount] = useState(1)
  const [devicesExpanded, setDevicesExpanded] = useState(false)
  const [selectedBank, setSelectedBank] = useState<number | null>(null)
  const [mintToken, setMintToken] = useState('USDT')
  const [winStates, setWinStates] = useState<Record<WinType, {claimed:boolean;claimable:boolean}>>({
    EARLY_FIVE:   {claimed:false,claimable:false},
    TOP_LINE:     {claimed:false,claimable:false},
    MIDDLE_LINE:  {claimed:false,claimable:false},
    BOTTOM_LINE:  {claimed:false,claimable:false},
    FULL_HOUSE_1: {claimed:false,claimable:false},
    FULL_HOUSE_2: {claimed:false,claimable:false},
    FULL_HOUSE_3: {claimed:false,claimable:false},
  })

  const gameRunning = useRef(false)
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null)
  const currentHour = new Date().getUTCHours()
  const liveBank = getLiveBank(currentHour)

  const announce = (msg: string) => {
    setAnnouncement(msg)
    setTimeout(() => setAnnouncement(null), 4000)
  }

  const drawNumber = useCallback(() => {
    setCalledNums(prev => {
      if (prev.size >= 90) return prev
      const remaining = Array.from({length:90},(_,i)=>i+1).filter(n => !prev.has(n))
      if (!remaining.length) return prev
      const num = remaining[Math.floor(Math.random()*remaining.length)]
      setCalledOrder(o => [...o, num])

      // Update devices for matches
      setDevices(ds => ds.map(d => {
        if (!d.active || d.corrupted) return d
        const newGrid = d.grid.map(row => row.map(cell => {
          if (cell.num === num) return { ...cell, matched: true }
          return cell
        }))
        return { ...d, grid: newGrid }
      }))

      return new Set(Array.from(prev).concat([num]))
    })
  }, [])

  // Check win conditions
  useEffect(() => {
    if (phase !== 'game') return
    setDevices(ds => {
      const newWinStates = { ...winStates }
      ds.forEach(d => {
        if (!d.active || d.corrupted) return
        const clicked = d.grid.flat().filter(c => c.clicked)
        if (clicked.length >= 5) newWinStates.EARLY_FIVE = { ...newWinStates.EARLY_FIVE, claimable: true }
        if (d.grid[0].filter(c=>c.num).every(c=>c.clicked)) newWinStates.TOP_LINE = { ...newWinStates.TOP_LINE, claimable: true }
        if (d.grid[1].filter(c=>c.num).every(c=>c.clicked)) newWinStates.MIDDLE_LINE = { ...newWinStates.MIDDLE_LINE, claimable: true }
        if (d.grid[2].filter(c=>c.num).every(c=>c.clicked)) newWinStates.BOTTOM_LINE = { ...newWinStates.BOTTOM_LINE, claimable: true }
        if (d.grid.flat().filter(c=>c.num).every(c=>c.clicked)) {
          const fhKey = `FULL_HOUSE_${Math.min(bankruptCount+1,3)}` as WinType
          newWinStates[fhKey] = { ...newWinStates[fhKey], claimable: true }
        }
      })
      setWinStates(newWinStates)
      return ds
    })
  }, [calledNums, phase])

  const startGame = () => {
    setPhase('game')
    gameRunning.current = true
    drawNumber()
    announce('🔴 HACK INITIATED — RANSOME BANK BROADCAST LIVE')
  }

  useEffect(() => {
    if (phase !== 'game') return
    timerRef.current = setInterval(() => {
      setTimer(t => {
        if (t <= 1) { drawNumber(); return 60 + Math.floor(Math.random() * 30) }
        return t - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [phase, drawNumber])

  const handleCellClick = (deviceId: number, row: number, col: number) => {
    setDevices(ds => ds.map(d => {
      if (d.id !== deviceId) return d
      const cell = d.grid[row][col]
      if (!cell.num || !calledNums.has(cell.num) || cell.clicked) return d
      const newGrid = d.grid.map((r,ri) => r.map((c,ci) => {
        if (ri===row && ci===col) return { ...c, clicked: true }
        return c
      }))
      return { ...d, grid: newGrid, clickedCount: d.clickedCount + 1 }
    }))
  }

  const handleClaim = (deviceId: number, winType: WinType) => {
    if (winStates[winType].claimed) return
    setDevices(ds => ds.map(d => {
      if (d.id !== deviceId) return d
      const newClaimed = new Set(Array.from(d.claimed).concat([winType]))
      return { ...d, claimed: newClaimed }
    }))
    setWinStates(prev => ({ ...prev, [winType]: { ...prev[winType], claimed: true } }))
    announce(`✅ ${WIN_LABELS[winType]} CLAIMED!`)
    if (winType.startsWith('FULL_HOUSE')) setBankruptCount(b => Math.min(b+1, 3))
  }

  const mintDevices = () => {
    if (!wallet) return
    const bank = selectedBank ?? liveBank
    const newDevices = Array.from({length: mintCount}, (_, i) =>
      generateDevice(devices.length + i)
    )
    setDevices(prev => [...prev, ...newDevices])
    announce(`⚡ ${mintCount} HACKING DEVICE${mintCount>1?'S':''} MINTED — TARGETING ${BANKS[bank].name}`)
  }

  const connectWallet = () => {
    setWallet('HaCk...3r0x')
    announce('🔓 WALLET CONNECTED — ACCESS GRANTED')
  }

  const lastCalled = calledOrder.slice(-5).reverse()

  // ── Lobby ──────────────────────────────────────────────────────────────────
  if (phase === 'lobby') {
    return (
      <div style={{ minHeight:'100vh', background:'#010810', color:'#c8d8e8', padding:'20px 16px' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, borderBottom:'1px solid #0a2535', paddingBottom:16 }}>
          <div>
            <div style={{ fontFamily:'"Syne",sans-serif', fontSize:28, fontWeight:800, color:'#00e5a0', letterSpacing:'-0.02em' }}>RANSOME</div>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5', letterSpacing:'0.2em' }}>HACK THE BANKS — CLAIM THE VAULT</div>
          </div>
          <button onClick={connectWallet} style={{
            background: wallet ? '#00e5a020' : 'linear-gradient(135deg,#00e5a0,#00b8ff)',
            color: wallet ? '#00e5a0' : '#000', border: wallet ? '1px solid #00e5a040' : 'none',
            borderRadius:8, padding:'8px 16px', fontFamily:'"DM Mono",monospace', fontSize:10, cursor:'pointer', fontWeight:700,
          }}>
            {wallet ? `✓ ${wallet}` : 'CONNECT WALLET'}
          </button>
        </div>

        {/* Live bank info */}
        <div style={{ background:'#ff004010', border:'1px solid #ff004040', borderRadius:12, padding:'12px 16px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#ff4060', letterSpacing:'0.15em' }}>🔴 LIVE NOW</div>
            <div style={{ fontFamily:'"Syne",sans-serif', fontSize:18, fontWeight:700, color:'#fff' }}>{BANKS[liveBank].name}</div>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5' }}>{BANKS[liveBank].city} · UTC{BANKS[liveBank].tz >= 0 ? '+' : ''}{BANKS[liveBank].tz}</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5' }}>VAULT SIZE</div>
            <div style={{ fontFamily:'"Syne",sans-serif', fontSize:20, fontWeight:800, color:'#00e5a0' }}>$1,000,000</div>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#4a7fa5' }}>1M DEVICES @ $1 EACH</div>
          </div>
        </div>

        {/* World Map */}
        <div style={{ marginBottom:16 }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5', letterSpacing:'0.15em', marginBottom:8 }}>⬡ GLOBAL BANK NETWORK — SELECT TARGET</div>
          <WorldMap activeBank={selectedBank} onSelectBank={setSelectedBank} currentHour={currentHour} />
          <div style={{ display:'flex', gap:12, marginTop:8, justifyContent:'center' }}>
            <div style={{ display:'flex', gap:4, alignItems:'center', fontFamily:'"DM Mono",monospace', fontSize:8, color:'#4a7fa5' }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background:'#ff0040' }} /> LIVE
            </div>
            <div style={{ display:'flex', gap:4, alignItems:'center', fontFamily:'"DM Mono",monospace', fontSize:8, color:'#4a7fa5' }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background:'#00e5a0' }} /> SELECTED
            </div>
            <div style={{ display:'flex', gap:4, alignItems:'center', fontFamily:'"DM Mono",monospace', fontSize:8, color:'#4a7fa5' }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background:'#1e4a7a' }} /> SCHEDULED
            </div>
          </div>
        </div>

        {/* Selected bank info */}
        {selectedBank !== null && (
          <div style={{ background:'#00e5a010', border:'1px solid #00e5a040', borderRadius:10, padding:'10px 14px', marginBottom:16 }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#00e5a0' }}>TARGET: {BANKS[selectedBank].name} — {BANKS[selectedBank].city}</div>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#4a7fa5', marginTop:2 }}>
              ACTIVE WINDOW: UTC{BANKS[selectedBank].tz >= 0 ? '+' : ''}{BANKS[selectedBank].tz} HOUR ONLY
            </div>
          </div>
        )}

        {/* Mint section */}
        {wallet && (
          <div style={{ background:'#040f1e', border:'1px solid #0a2a4a', borderRadius:12, padding:'14px', marginBottom:16 }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5', letterSpacing:'0.15em', marginBottom:10 }}>⬡ MINT HACKING DEVICES</div>
            <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
              {['USDT','USDC','SOL','RNSM'].map(t => (
                <button key={t} onClick={() => setMintToken(t)} style={{
                  background: mintToken===t ? '#00e5a020' : '#020d1a',
                  border: mintToken===t ? '1px solid #00e5a0' : '1px solid #0a2535',
                  color: mintToken===t ? '#00e5a0' : '#4a7fa5',
                  borderRadius:6, padding:'4px 10px', fontFamily:'"DM Mono",monospace', fontSize:9, cursor:'pointer',
                }}>{t}</button>
              ))}
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10 }}>
              <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5' }}>QUANTITY:</div>
              {[1,3,5,10].map(n => (
                <button key={n} onClick={() => setMintCount(n)} style={{
                  background: mintCount===n ? '#00e5a020' : '#020d1a',
                  border: mintCount===n ? '1px solid #00e5a0' : '1px solid #0a2535',
                  color: mintCount===n ? '#00e5a0' : '#4a7fa5',
                  borderRadius:6, padding:'4px 10px', fontFamily:'"DM Mono",monospace', fontSize:9, cursor:'pointer',
                }}>{n}</button>
              ))}
              <input type="number" value={mintCount} onChange={e=>setMintCount(Math.max(1,parseInt(e.target.value)||1))} style={{
                width:60, background:'#020d1a', border:'1px solid #0a2535', borderRadius:6, padding:'4px 8px', color:'#00e5a0', fontFamily:'"DM Mono",monospace', fontSize:9, outline:'none',
              }} />
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#fff' }}>
                TOTAL: <span style={{ color:'#00e5a0' }}>{mintCount} {mintToken}</span>
              </div>
              <button onClick={mintDevices} style={{
                background:'linear-gradient(135deg,#00e5a0,#00b8ff)', color:'#000',
                border:'none', borderRadius:8, padding:'8px 20px',
                fontFamily:'"DM Mono",monospace', fontSize:10, cursor:'pointer', fontWeight:700,
              }}>
                ⚡ MINT {mintCount} DEVICE{mintCount>1?'S':''}
              </button>
            </div>
          </div>
        )}

        {/* Start game */}
        {devices.length > 0 && (
          <button onClick={startGame} style={{
            width:'100%', background:'linear-gradient(135deg,#ff0040,#ff4060)',
            color:'#fff', border:'none', borderRadius:10, padding:'14px',
            fontFamily:'"Syne",sans-serif', fontSize:16, fontWeight:800, cursor:'pointer',
            boxShadow:'0 0 20px #ff004060',
          }}>
            🔴 INITIATE HACK — {devices.length} DEVICE{devices.length>1?'S':''} READY
          </button>
        )}

        {announcement && (
          <div style={{
            position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
            background:'#040f1e', border:'1px solid #00e5a040', borderRadius:10,
            padding:'10px 20px', fontFamily:'"DM Mono",monospace', fontSize:11,
            color:'#00e5a0', zIndex:999, whiteSpace:'nowrap', animation:'slideDown 0.3s ease',
          }}>{announcement}</div>
        )}
      </div>
    )
  }

  // ── Game Phase ─────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'#010810', color:'#c8d8e8' }}>

      {/* Top bar */}
      <div style={{ padding:'8px 16px', borderBottom:'1px solid #0a2535', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontFamily:'"Syne",sans-serif', fontSize:18, fontWeight:800, color:'#00e5a0' }}>RANSOME</div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#ff4060', background:'#ff004010', border:'1px solid #ff004040', borderRadius:6, padding:'3px 8px' }}>
            🔴 {BANKS[liveBank].name.toUpperCase()}
          </div>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5' }}>{wallet}</div>
        </div>
      </div>

      {/* Main layout */}
      <div style={{ padding:'12px 16px', display:'grid', gridTemplateColumns:'1fr', gap:12 }}>

        {/* Centre broadcast + servers + terminal */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr 1fr', gap:10, alignItems:'start' }}>

          {/* Left server rack */}
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <ServerStats devices={devices} calledNums={calledNums} bankruptCount={bankruptCount} />
            {/* Wired server decorations */}
            <div style={{ background:'#010810', border:'1px solid #0a2535', borderRadius:10, padding:10 }}>
              <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#4a7fa5', marginBottom:6 }}>⬡ BANK NODES</div>
              {BANKS.slice(0,8).map(b => (
                <div key={b.id} style={{ display:'flex', alignItems:'center', gap:4, marginBottom:3 }}>
                  <div style={{ width:4, height:4, borderRadius:'50%', background: b.id===liveBank ? '#ff0040' : '#0a2535', boxShadow: b.id===liveBank ? '0 0 4px #ff0040' : 'none' }} />
                  <div style={{ fontFamily:'"DM Mono",monospace', fontSize:7, color: b.id===liveBank ? '#ff4060' : '#2a4a6a', flex:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{b.city}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Centre broadcast */}
          <HackingMatrix calledNums={calledNums} calledOrder={calledOrder} timer={timer} />

          {/* Right terminal */}
          <div style={{ height:380 }}>
            <TerminalChat />
          </div>
        </div>

        {/* Win conditions bar */}
        <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:4 }}>
          {(Object.entries(WIN_LABELS) as [WinType, string][]).map(([type, label]) => {
            const state = winStates[type]
            return (
              <div key={type} style={{
                background: state.claimed ? '#00e5a010' : state.claimable ? '#ff69b410' : '#040f1e',
                border: state.claimed ? '1px solid #00e5a040' : state.claimable ? '1px solid #ff69b4' : '1px solid #0a2535',
                borderRadius:8, padding:'6px 10px', whiteSpace:'nowrap', flexShrink:0,
                display:'flex', gap:6, alignItems:'center',
              }}>
                <div style={{
                  width:6, height:6, borderRadius:'50%',
                  background: ANTENNA_COLORS[type],
                  boxShadow: state.claimable && !state.claimed ? `0 0 6px ${ANTENNA_COLORS[type]}` : 'none',
                }} />
                <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color: state.claimed ? '#00e5a0' : state.claimable ? '#ff69b4' : '#2a4a6a' }}>
                  {state.claimed ? '✓' : state.claimable ? '⚡' : '○'} {label}
                </div>
              </div>
            )
          })}
        </div>

        {/* Devices section */}
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5', letterSpacing:'0.15em' }}>
              ⬡ HACKING DEVICES ({devices.length})
            </div>
            <div style={{ display:'flex', gap:8 }}>
              {/* Mint more */}
              <button onClick={() => {
                const newDevices = Array.from({length:1}, (_,i) => generateDevice(devices.length + i))
                setDevices(prev => [...prev, ...newDevices])
              }} style={{ background:'#00e5a020', border:'1px solid #00e5a040', color:'#00e5a0', borderRadius:6, padding:'4px 10px', fontFamily:'"DM Mono",monospace', fontSize:8, cursor:'pointer' }}>
                + MINT
              </button>
              <button onClick={() => setDevicesExpanded(e => !e)} style={{ background:'#040f1e', border:'1px solid #0a2535', color:'#4a7fa5', borderRadius:6, padding:'4px 10px', fontFamily:'"DM Mono",monospace', fontSize:8, cursor:'pointer' }}>
                {devicesExpanded ? '⊟ COLLAPSE' : '⊞ EXPAND'}
              </button>
            </div>
          </div>

          {devicesExpanded ? (
            // Horizontal scroll mode — 10 devices per row
            <div style={{ overflowX:'auto', paddingBottom:8 }}>
              <div style={{ display:'flex', gap:10, width:'max-content' }}>
                {devices.map(device => (
                  <div key={device.id} style={{ width:180, flexShrink:0 }}>
                    <HackingDevice
                      device={device}
                      calledNums={calledNums}
                      onCellClick={handleCellClick}
                      onClaim={handleClaim}
                      winStates={winStates}
                      bankruptCount={bankruptCount}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // 2-column grid
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10 }}>
              {devices.map(device => (
                <HackingDevice
                  key={device.id}
                  device={device}
                  calledNums={calledNums}
                  onCellClick={handleCellClick}
                  onClaim={handleClaim}
                  winStates={winStates}
                  bankruptCount={bankruptCount}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Announcement */}
      {announcement && (
        <div style={{
          position:'fixed', top:60, left:'50%', transform:'translateX(-50%)',
          background:'#040f1e', border:'1px solid #00e5a044', borderRadius:10,
          padding:'10px 20px', fontFamily:'"DM Mono",monospace', fontSize:11,
          color:'#00e5a0', zIndex:999, whiteSpace:'nowrap', animation:'slideDown 0.3s ease',
          boxShadow:'0 8px 32px rgba(0,229,160,0.15)',
        }}>{announcement}</div>
      )}
    </div>
  )
}
