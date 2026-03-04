'use client'
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
}
type WinType = 'EARLY_FIVE' | 'TOP_LINE' | 'MIDDLE_LINE' | 'BOTTOM_LINE' | 'FULL_HOUSE_1' | 'FULL_HOUSE_2' | 'FULL_HOUSE_3'
type WinEvent = { deviceId: number; type: WinType; label: string; numbers: number[] }
type Phase = 'lobby' | 'game'

// ─── Constants ───────────────────────────────────────────────────────────────
const WIN_LABELS: Record<WinType, string> = {
  EARLY_FIVE: '⚡ Five Digit Accounts Hacked',
  TOP_LINE: '🔓 Top Accounts Hacked',
  MIDDLE_LINE: '🎯 Central System Hacked',
  BOTTOM_LINE: '🔻 Basement Hacked',
  FULL_HOUSE_1: '💀 Bankrupt Ransome I',
  FULL_HOUSE_2: '💀 Bankrupt Ransome II',
  FULL_HOUSE_3: '💀 Bankrupt Ransome III',
}
const FULL_HOUSE_SEQUENCE: WinType[] = ['FULL_HOUSE_1', 'FULL_HOUSE_2', 'FULL_HOUSE_3']

// ─── Ticket Generator ────────────────────────────────────────────────────────
function generateDevice(id: number): Device {
  const cols = [
    [1,10],[11,20],[21,30],[31,40],[41,50],[51,60],[61,70],[71,80],[81,90]
  ]
  const grid: Cell[][] = Array.from({length:3}, () => Array(9).fill(null).map(() => ({num:null,matched:false,clicked:false})))
  
  // Each row gets exactly 5 numbers, distributed across columns
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
  return { id, grid, claimed: new Set(), corrupted: false, active: false, matchCount: 0 }
}

// ─── Win Checker ─────────────────────────────────────────────────────────────
function checkWins(device: Device, calledNums: Set<number>, fullHouseCount: number): WinType[] {
  const wins: WinType[] = []
  const allNums = device.grid.flat().filter(c=>c.num!==null).map(c=>c.num as number)
  const matched = allNums.filter(n=>calledNums.has(n))
  const clickedCount = device.grid.flat().filter(c=>c.clicked).length

  // Early Five
  if (clickedCount >= 5 && !device.claimed.has('EARLY_FIVE')) wins.push('EARLY_FIVE')

  // Row checks
  const rows = [0,1,2]
  const rowTypes: WinType[] = ['TOP_LINE','MIDDLE_LINE','BOTTOM_LINE']
  for (const ri of rows) {
    const rowNums = device.grid[ri].filter(c=>c.num!==null).map(c=>c.num as number)
    if (rowNums.every(n=>calledNums.has(n)) && !device.claimed.has(rowTypes[ri])) {
      wins.push(rowTypes[ri])
    }
  }

  // Full House
  if (matched.length === allNums.length) {
    const nextFH = FULL_HOUSE_SEQUENCE[fullHouseCount]
    if (nextFH && !device.claimed.has(nextFH)) wins.push(nextFH)
  }

  return wins
}

// ─── Number Ball Component ────────────────────────────────────────────────────
function Ball({ num, isNew }: { num: number; isNew: boolean }) {
  return (
    <div style={{
      width: 44, height: 44, borderRadius: '50%',
      background: isNew ? 'linear-gradient(135deg,#ff3c3c,#ff8c00)' : 'linear-gradient(135deg,#1a2332,#0e1620)',
      border: isNew ? '2px solid #ff5722' : '2px solid #1e3a5f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"DM Mono",monospace', fontWeight: 700, fontSize: 14,
      color: isNew ? '#fff' : '#4a7fa5',
      boxShadow: isNew ? '0 0 20px #ff572266, 0 0 40px #ff572233' : 'none',
      transition: 'all 0.4s ease',
      animation: isNew ? 'ballPop 0.5s ease' : 'none',
      flexShrink: 0,
    }}>{num}</div>
  )
}

// ─── Device Card ─────────────────────────────────────────────────────────────
function DeviceCard({
  device, calledNums, onCellClick, onClaimRansome, winEvents
}: {
  device: Device
  calledNums: Set<number>
  onCellClick: (deviceId: number, row: number, col: number) => void
  onClaimRansome: (deviceId: number) => void
  winEvents: WinEvent[]
}) {
  const myWins = winEvents.filter(w => w.deviceId === device.id)
  const lastNum = Array.from(calledNums).at(-1)

  return (
    <div style={{
      background: device.corrupted
        ? 'linear-gradient(135deg,#1a0a0a,#0d0505)'
        : device.active
          ? 'linear-gradient(135deg,#0a1628,#0d1f3c)'
          : 'linear-gradient(135deg,#0d1117,#111827)',
      border: device.corrupted ? '1px solid #ff1a1a44' : device.active ? '1px solid #00e5a044' : '1px solid #1e2d3d',
      borderRadius: 16, padding: 20, position: 'relative',
      boxShadow: device.active && !device.corrupted ? '0 0 30px #00e5a011' : 'none',
      opacity: device.corrupted ? 0.6 : 1,
      transition: 'all 0.3s ease',
    }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 12 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: device.corrupted ? '#ff1a1a' : device.active ? '#00e5a0' : '#334',
            boxShadow: device.active && !device.corrupted ? '0 0 8px #00e5a0' : 'none',
            animation: device.active && !device.corrupted ? 'pulse 2s infinite' : 'none',
          }}/>
          <span style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#4a7fa5', letterSpacing:'.15em' }}>
            DEVICE #{String(device.id).padStart(3,'0')}
          </span>
        </div>
        <div style={{ display:'flex', gap: 6, alignItems:'center' }}>
          {device.corrupted && (
            <span style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#ff4444', background:'#ff111122', border:'1px solid #ff444433', padding:'2px 6px', borderRadius:4 }}>
              CORRUPTED
            </span>
          )}
          {myWins.length > 0 && (
            <span style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#f7c948', background:'#f7c94822', border:'1px solid #f7c94844', padding:'2px 6px', borderRadius:4 }}>
              {myWins.length} WIN{myWins.length>1?'S':''}
            </span>
          )}
        </div>
      </div>

      {/* Mini bank display */}
      {device.active && (
        <div style={{
          background:'#060d16', border:'1px solid #0e2a3d', borderRadius:8,
          padding:'6px 10px', marginBottom:12, display:'flex', alignItems:'center', gap:8,
        }}>
          <span style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#1e4a6e', letterSpacing:'.1em' }}>BANK FEED</span>
          <span style={{ fontFamily:'"DM Mono",monospace', fontSize:14, color:'#ff5722', fontWeight:700 }}>
            {lastNum ?? '--'}
          </span>
          <span style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#1e4a6e' }}>
            [{Array.from(calledNums).slice(-3).join(', ')}]
          </span>
        </div>
      )}

      {/* Grid */}
      <div style={{ border:'1px solid #1e3a5f', borderRadius:8, overflow:'hidden', marginBottom:12 }}>
        {[0,1,2].map(row => (
          <div key={row} style={{ display:'grid', gridTemplateColumns:'repeat(9,1fr)', borderBottom: row<2 ? '1px solid #1e3a5f' : 'none' }}>
            {device.grid[row].map((cell, col) => {
              const isMatched = cell.num !== null && calledNums.has(cell.num)
              const isClickable = isMatched && device.active && !cell.clicked && !device.corrupted
              return (
                <div
                  key={col}
                  onClick={() => isClickable && onCellClick(device.id, row, col)}
                  style={{
                    height: 36, display:'flex', alignItems:'center', justifyContent:'center',
                    fontFamily:'"DM Mono",monospace', fontSize:12, fontWeight:700,
                    borderRight: col<8 ? '1px solid #1e3a5f' : 'none',
                    background: cell.clicked ? '#00e5a022' : isMatched && device.active ? '#ff572211' : 'transparent',
                    color: cell.clicked ? '#00e5a0' : isMatched && device.active ? '#ff8c00' : cell.num ? '#4a7fa5' : 'transparent',
                    cursor: isClickable ? 'pointer' : 'default',
                    transition: 'all 0.2s ease',
                    boxShadow: cell.clicked ? 'inset 0 0 8px #00e5a033' : 'none',
                    textDecoration: cell.clicked ? 'line-through' : 'none',
                    animation: isClickable ? 'glow 1.5s infinite' : 'none',
                  }}
                >
                  {cell.num ?? ''}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Row labels */}
      <div style={{ display:'flex', gap:4, marginBottom:12 }}>
        {['TOP','MID','BOT'].map((label,i) => {
          const rowNums = device.grid[i].filter(c=>c.num!==null).map(c=>c.num as number)
          const complete = rowNums.every(n=>calledNums.has(n))
          return (
            <div key={label} style={{
              flex:1, textAlign:'center', fontFamily:'"DM Mono",monospace', fontSize:9,
              padding:'3px 0', borderRadius:4,
              background: complete ? '#00e5a022' : '#0a1628',
              border: complete ? '1px solid #00e5a044' : '1px solid #1e3a5f',
              color: complete ? '#00e5a0' : '#1e4a6e',
              letterSpacing:'.08em',
            }}>{label}</div>
          )
        })}
      </div>

      {/* Wins */}
      {myWins.map((w,i) => (
        <div key={i} style={{
          background:'#f7c94811', border:'1px solid #f7c94833', borderRadius:6,
          padding:'4px 8px', marginBottom:4,
          fontFamily:'"DM Mono",monospace', fontSize:9, color:'#f7c948', letterSpacing:'.05em',
        }}>{w.label}</div>
      ))}

      {/* Activate / Ransome buttons */}
      {!device.active && !device.corrupted && (
        <button
          onClick={() => onClaimRansome(device.id)}
          style={{
            width:'100%', padding:'8px 0', borderRadius:8,
            border:'1px solid #00e5a066', background:'transparent',
            color:'#00e5a0', fontFamily:'"DM Mono",monospace', fontSize:11,
            letterSpacing:'.1em', cursor:'pointer', marginTop:4,
          }}
        >ACTIVATE DEVICE</button>
      )}
      {device.active && !device.corrupted && (
        <button
          onClick={() => onClaimRansome(device.id)}
          style={{
            width:'100%', padding:'8px 0', borderRadius:8,
            border:'1px solid #ff3c3c66', background:'#ff3c3c11',
            color:'#ff5555', fontFamily:'"DM Mono",monospace', fontSize:11,
            letterSpacing:'.1em', cursor:'pointer', marginTop:4,
            animation:'ransomePulse 2s infinite',
          }}
        >⚡ CLAIM RANSOME</button>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Ransome() {
  const [phase, setPhase] = useState<Phase>('lobby')
  const [wallet, setWallet] = useState<string|null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [calledNums, setCalledNums] = useState<Set<number>>(new Set())
  const [calledOrder, setCalledOrder] = useState<number[]>([])
  const [timer, setTimer] = useState(60)
  const [winEvents, setWinEvents] = useState<WinEvent[]>([])
  const [fullHouseCount, setFullHouseCount] = useState(0)
  const [bankFund, setBankFund] = useState(0)
  const [participants, setParticipants] = useState(0)
  const [mintCount, setMintCount] = useState(0)
  const [showMintModal, setShowMintModal] = useState(false)
  const [mintToken, setMintToken] = useState('USDT')
  const [announcement, setAnnouncement] = useState<string|null>(null)
  const announcementRef = useRef<ReturnType<typeof setTimeout>|null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null)
  const gameRunning = useRef(false)

  const trunc = (a: string) => a.slice(0,6)+'...'+a.slice(-4)

  const announce = useCallback((msg: string) => {
    setAnnouncement(msg)
    if (announcementRef.current) clearTimeout(announcementRef.current)
    announcementRef.current = setTimeout(() => setAnnouncement(null), 4000)
  }, [])

  const connectWallet = async () => {
    const p = (window as any).solana
    if (!p?.isPhantom) { window.open('https://phantom.app/','_blank'); return }
    const r = await p.connect()
    setWallet(r.publicKey.toString())
  }

  const mintDevice = () => {
    const newDevice = generateDevice(mintCount + 1)
    setDevices(prev => [...prev, newDevice])
    setMintCount(c => c+1)
    setBankFund(f => f + 1)
    setParticipants(p => p + 1)
    setShowMintModal(false)
    announce(`🔧 Hacking Device #${mintCount+1} minted! 1 ${mintToken} deposited to Ransome Bank.`)
  }

  const activateDevice = useCallback((deviceId: number) => {
    setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, active: true } : d))
    announce(`📡 Device #${deviceId} connected to Ransome Bank!`)
  }, [announce])

  const handleCellClick = useCallback((deviceId: number, row: number, col: number) => {
    setDevices(prev => prev.map(d => {
      if (d.id !== deviceId) return d
      const newGrid = d.grid.map(r => [...r])
      newGrid[row][col] = { ...newGrid[row][col], clicked: true }
      return { ...d, grid: newGrid, matchCount: d.matchCount + 1 }
    }))
  }, [])

  const handleClaimRansome = useCallback((deviceId: number) => {
    const device = devices.find(d => d.id === deviceId)
    if (!device) return

    // Activate if not already
    if (!device.active) {
      activateDevice(deviceId)
      return
    }

    // Check wins
    const wins = checkWins(device, calledNums, fullHouseCount)
    if (wins.length === 0) {
      // Wrong claim → corrupt device
      setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, corrupted: true } : d))
      announce(`❌ Device #${deviceId} CORRUPTED! Invalid claim attempt.`)
      return
    }

    const newEvents: WinEvent[] = []
    let fhCount = fullHouseCount

    for (const winType of wins) {
      if (device.claimed.has(winType)) continue
      const label = WIN_LABELS[winType]
      const matched = device.grid.flat().filter(c=>c.clicked).map(c=>c.num as number)
      newEvents.push({ deviceId, type: winType, label, numbers: matched })
      if (winType.startsWith('FULL_HOUSE')) fhCount++
    }

    if (newEvents.length > 0) {
      setWinEvents(prev => [...prev, ...newEvents])
      setFullHouseCount(fhCount)
      setDevices(prev => prev.map(d => {
        if (d.id !== deviceId) return d
        const newClaimed = new Set(d.claimed)
        for (const e of newEvents) newClaimed.add(e.type)
        return { ...d, claimed: newClaimed }
      }))
      for (const e of newEvents) {
        setTimeout(() => announce(`🏆 Device #${e.deviceId}: ${e.label}!`), 200)
      }
    }
  }, [devices, calledNums, fullHouseCount, activateDevice, announce])

  // Game tick — draw number every 60s
  const drawNumber = useCallback(() => {
    const available = Array.from({length:90},(_,i)=>i+1).filter(function(n){return !calledNums.has(n)})
    if (available.length === 0) return
    const num = available[Math.floor(Math.random()*available.length)]
    setCalledNums(prev => new Set(Array.from(prev).concat([num])))
    setCalledOrder(prev => [...prev, num])
    setTimer(60)

    // Auto-mark matched cells for active devices
    setDevices(prev => prev.map(d => {
      if (!d.active || d.corrupted) return d
      const newGrid = d.grid.map(row => row.map(cell => {
        if (cell.num === num) return { ...cell, matched: true }
        return cell
      }))
      return { ...d, grid: newGrid }
    }))
  }, [calledNums])

  const startGame = () => {
    setPhase('game')
    gameRunning.current = true
    drawNumber()
  }

  useEffect(() => {
    if (phase !== 'game') return
    timerRef.current = setInterval(() => {
      setTimer(t => {
        if (t <= 1) { drawNumber(); return 60 }
        return t - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [phase, drawNumber])

  const lastCalled = calledOrder.slice(-10).reverse()

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #050b14; color: #c8d8e8; font-family: Syne, sans-serif; min-height: 100vh; overflow-x: hidden; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #050b14; } ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 2px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes ballPop { 0%{transform:scale(0) rotate(-180deg);opacity:0} 60%{transform:scale(1.2)} 100%{transform:scale(1);opacity:1} }
        @keyframes glow { 0%,100%{box-shadow:inset 0 0 8px #ff572233} 50%{box-shadow:inset 0 0 16px #ff572266} }
        @keyframes ransomePulse { 0%,100%{border-color:#ff3c3c44;box-shadow:none} 50%{border-color:#ff3c3caa;box-shadow:0 0 12px #ff3c3c33} }
        @keyframes slideDown { from{transform:translateY(-20px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes bankScan { 0%{background-position:0 0} 100%{background-position:0 100px} }
        @keyframes numberDrop { 0%{transform:translateY(-40px) scale(0.5);opacity:0} 100%{transform:translateY(0) scale(1);opacity:1} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        .scan-line {
          background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,160,0.015) 2px, rgba(0,229,160,0.015) 4px);
          pointer-events: none;
        }
        .btn-primary { background: linear-gradient(135deg,#00e5a0,#00b8ff); color: #050b14; border: none; font-family: Syne,sans-serif; font-weight: 700; cursor: pointer; border-radius: 10px; transition: all 0.2s; }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,229,160,0.3); }
        .btn-ghost { background: transparent; border: 1px solid #1e3a5f; color: #4a7fa5; font-family: 'DM Mono',monospace; cursor: pointer; border-radius: 8px; transition: all 0.2s; }
        .btn-ghost:hover { border-color: #00e5a066; color: #00e5a0; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(5,11,20,0.9); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal-box { background: #0a1628; border: 1px solid #1e3a5f; border-radius: 20px; padding: 32px; width: 360px; animation: slideDown 0.3s ease; }
      `}</style>

      {/* Announcement Banner */}
      {announcement && (
        <div style={{
          position:'fixed', top:80, left:'50%', transform:'translateX(-50%)',
          background:'linear-gradient(135deg,#0a1628,#0d1f3c)',
          border:'1px solid #00e5a044', borderRadius:12, padding:'12px 24px',
          fontFamily:'"DM Mono",monospace', fontSize:13, color:'#00e5a0',
          zIndex:999, animation:'slideDown 0.3s ease',
          boxShadow:'0 8px 32px rgba(0,229,160,0.15)',
          maxWidth:'80vw', textAlign:'center',
        }}>{announcement}</div>
      )}

      {/* Mint Modal */}
      {showMintModal && (
        <div className="modal-overlay" onClick={() => setShowMintModal(false)}>
          <div className="modal-box" onClick={e=>e.stopPropagation()}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#00e5a0', letterSpacing:'.15em', marginBottom:8 }}>MINT HACKING DEVICE</div>
            <div style={{ fontSize:22, fontWeight:800, marginBottom:4 }}>Deploy NFT</div>
            <div style={{ fontSize:13, color:'#4a7fa5', marginBottom:24, lineHeight:1.6 }}>
              Mint a hacking device for <strong style={{color:'#f7c948'}}>1 {mintToken}</strong>. Funds are deposited to Ransome Bank. Connect to the bank to start playing.
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontFamily:'"DM Mono",monospace', fontSize:10, color:'#4a7fa5', marginBottom:8, letterSpacing:'.1em' }}>SELECT PAYMENT TOKEN</div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {['USDT','USDC','SOL','RNSM'].map(t => (
                  <button key={t} onClick={()=>setMintToken(t)} className="btn-ghost" style={{
                    padding:'6px 14px', fontSize:12,
                    borderColor: mintToken===t ? '#00e5a0' : '#1e3a5f',
                    color: mintToken===t ? '#00e5a0' : '#4a7fa5',
                  }}>{t}</button>
                ))}
              </div>
            </div>
            <div style={{ background:'#060d16', border:'1px solid #0e2a3d', borderRadius:10, padding:16, marginBottom:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#4a7fa5' }}>DEVICE COST</span>
                <span style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#f7c948' }}>1 {mintToken}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#4a7fa5' }}>BANK DEPOSIT</span>
                <span style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#00e5a0' }}>100% → RNSM Pool</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#4a7fa5' }}>GRID</span>
                <span style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#c8d8e8' }}>3×9 · 15 Numbers</span>
              </div>
            </div>
            <button className="btn-primary" style={{ width:'100%', padding:'14px 0', fontSize:15, borderRadius:10 }} onClick={mintDevice}>
              MINT HACKING DEVICE
            </button>
            <button className="btn-ghost" style={{ width:'100%', padding:'10px 0', fontSize:12, marginTop:8 }} onClick={()=>setShowMintModal(false)}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{
        position:'sticky', top:0, zIndex:100,
        background:'rgba(5,11,20,0.95)', backdropFilter:'blur(20px)',
        borderBottom:'1px solid #0e2233',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0 32px', height:64,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{
            width:36, height:36, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center',
            background:'linear-gradient(135deg,#ff3c3c,#ff8c00)',
            fontWeight:800, fontSize:18, color:'#fff',
            boxShadow:'0 0 20px #ff572266',
          }}>R</div>
          <div>
            <div style={{ fontWeight:800, fontSize:18, letterSpacing:'-.02em', lineHeight:1 }}>RANSOME</div>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#ff5722', letterSpacing:'.15em' }}>BANK PROTOCOL · DEVNET</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {phase === 'game' && (
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:12, color:'#ff5722', background:'#ff572211', border:'1px solid #ff572233', padding:'4px 12px', borderRadius:6, display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:'#ff5722', display:'inline-block', animation:'pulse 1s infinite' }}/>
              LIVE · {calledNums.size}/90
            </div>
          )}
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#f7c948', background:'#f7c94811', border:'1px solid #f7c94833', padding:'4px 12px', borderRadius:6 }}>
            ◎ {bankFund.toFixed(0)} RNSM BANK
          </div>
          {wallet ? (
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:12, color:'#4a7fa5', background:'#0a1628', border:'1px solid #1e3a5f', padding:'4px 14px', borderRadius:8 }}>
              {trunc(wallet)}
            </div>
          ) : (
            <button className="btn-primary" style={{ padding:'8px 18px', fontSize:13 }} onClick={connectWallet}>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* ── LOBBY ── */}
      {phase === 'lobby' && (
        <main style={{ maxWidth:1000, margin:'0 auto', padding:'60px 24px' }}>
          {/* Hero */}
          <div style={{ textAlign:'center', marginBottom:64 }}>
            <div style={{
              display:'inline-block', fontFamily:'"DM Mono",monospace', fontSize:11,
              color:'#ff5722', letterSpacing:'.2em', marginBottom:20,
              background:'#ff572211', border:'1px solid #ff572233', padding:'4px 14px', borderRadius:20,
            }}>SOLANA · DEVNET · RNSM TOKEN</div>
            <h1 style={{
              fontSize:'clamp(48px,8vw,88px)', fontWeight:800, lineHeight:.95,
              letterSpacing:'-.04em', marginBottom:24,
            }}>
              <span style={{ display:'block' }}>RANSOME</span>
              <span style={{ display:'block', background:'linear-gradient(90deg,#ff3c3c,#ff8c00)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>BANK</span>
            </h1>
            <p style={{ fontSize:18, color:'#4a7fa5', maxWidth:500, margin:'0 auto 40px', lineHeight:1.7 }}>
              Hack the bank. Match the numbers. Bankrupt Ransome. The on-chain Tambola where your device is your weapon.
            </p>
            <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' }}>
              {wallet ? (
                <>
                  <button className="btn-primary" style={{ padding:'16px 32px', fontSize:16 }} onClick={()=>setShowMintModal(true)}>
                    🔧 Mint Hacking Device
                  </button>
                  {devices.length > 0 && (
                    <button className="btn-primary" style={{ padding:'16px 32px', fontSize:16, background:'linear-gradient(135deg,#ff3c3c,#ff8c00)' }} onClick={startGame}>
                      ⚡ Start Hacking
                    </button>
                  )}
                </>
              ) : (
                <button className="btn-primary" style={{ padding:'16px 32px', fontSize:16 }} onClick={connectWallet}>
                  Connect Wallet to Play
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:16, marginBottom:48 }}>
            {[
              { label:'BANK FUND', value:`${bankFund} RNSM`, color:'#f7c948' },
              { label:'PARTICIPANTS', value:participants, color:'#00e5a0' },
              { label:'YOUR DEVICES', value:devices.length, color:'#00b8ff' },
              { label:'GAME STATE', value:(phase as string)==='game'?'LIVE':'STANDBY', color:'#ff5722' },
            ].map(s => (
              <div key={s.label} style={{ background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:14, padding:'20px 24px' }}>
                <div style={{ fontFamily:'"DM Mono",monospace', fontSize:10, color:'#4a7fa5', letterSpacing:'.12em', marginBottom:8 }}>{s.label}</div>
                <div style={{ fontFamily:'"DM Mono",monospace', fontSize:22, fontWeight:700, color:s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* How to play */}
          <div style={{ background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:16, padding:32 }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#00e5a0', letterSpacing:'.15em', marginBottom:24 }}>HOW TO HACK THE BANK</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:20 }}>
              {[
                { n:'01', title:'Mint Device', desc:'Pay 1 token to mint your hacking device NFT — a unique 3×9 number grid.' },
                { n:'02', title:'Connect to Bank', desc:'Activate your device to receive the Ransome Bank live number feed.' },
                { n:'03', title:'Match Numbers', desc:'Click numbers on your device as the bank broadcasts them every 60 seconds.' },
                { n:'04', title:'Claim Ransome', desc:'Hit the red Ransome button when you complete a winning pattern. Wrong claims corrupt your device!' },
              ].map(s => (
                <div key={s.n}>
                  <div style={{ fontFamily:'"DM Mono",monospace', fontSize:28, color:'#1e3a5f', fontWeight:700, marginBottom:8 }}>{s.n}</div>
                  <div style={{ fontWeight:700, fontSize:15, marginBottom:6 }}>{s.title}</div>
                  <div style={{ fontSize:13, color:'#4a7fa5', lineHeight:1.6 }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Win table */}
          <div style={{ marginTop:32, background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:16, padding:32 }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#f7c948', letterSpacing:'.15em', marginBottom:20 }}>WINNING PATTERNS</div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {Object.entries(WIN_LABELS).map(([key, label]) => (
                <div key={key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', background:'#060d16', border:'1px solid #0e2233', borderRadius:8 }}>
                  <span style={{ fontSize:14 }}>{label}</span>
                  <span style={{ fontFamily:'"DM Mono",monospace', fontSize:10, color:'#4a7fa5', letterSpacing:'.08em' }}>
                    {key==='EARLY_FIVE'?'5 matched':key.includes('LINE')?'full row':key.includes('FULL')?'all 15':''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Pre-game devices */}
          {devices.length > 0 && (
            <div style={{ marginTop:32 }}>
              <div style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#4a7fa5', letterSpacing:'.15em', marginBottom:20 }}>YOUR HACKING DEVICES ({devices.length})</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:16 }}>
                {devices.map(d => (
                  <DeviceCard key={d.id} device={d} calledNums={calledNums} onCellClick={handleCellClick} onClaimRansome={handleClaimRansome} winEvents={winEvents} />
                ))}
              </div>
            </div>
          )}
        </main>
      )}

      {/* ── GAME ── */}
      {phase === 'game' && (
        <main style={{ maxWidth:1200, margin:'0 auto', padding:'24px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'320px 1fr', gap:24 }}>

            {/* Left: Bank Panel */}
            <div>
              {/* Current Number */}
              <div style={{
                background:'linear-gradient(135deg,#0a0f1a,#0d1825)',
                border:'1px solid #1e3a5f', borderRadius:20, padding:28, marginBottom:16,
                textAlign:'center', position:'relative', overflow:'hidden',
              }}>
                <div className="scan-line" style={{ position:'absolute', inset:0 }}/>
                <div style={{ fontFamily:'"DM Mono",monospace', fontSize:10, color:'#ff5722', letterSpacing:'.2em', marginBottom:16 }}>RANSOME BANK · BROADCASTING</div>
                <div style={{
                  fontSize:88, fontWeight:800, lineHeight:1,
                  fontFamily:'"DM Mono",monospace',
                  background:'linear-gradient(135deg,#ff3c3c,#ff8c00)',
                  WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
                  marginBottom:12, animation:'float 3s ease-in-out infinite',
                }}>
                  {calledOrder.at(-1) ?? '--'}
                </div>
                <div style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#4a7fa5', marginBottom:20 }}>
                  {calledNums.size} OF 90 DRAWN
                </div>
                {/* Timer ring */}
                <div style={{ position:'relative', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width={80} height={80} style={{ transform:'rotate(-90deg)' }}>
                    <circle cx={40} cy={40} r={34} fill="none" stroke="#1e3a5f" strokeWidth={4}/>
                    <circle cx={40} cy={40} r={34} fill="none" stroke="#ff5722" strokeWidth={4}
                      strokeDasharray={`${2*Math.PI*34}`}
                      strokeDashoffset={`${2*Math.PI*34*(1-timer/60)}`}
                      strokeLinecap="round"
                      style={{ transition:'stroke-dashoffset 1s linear' }}
                    />
                  </svg>
                  <div style={{ position:'absolute', fontFamily:'"DM Mono",monospace', fontSize:20, fontWeight:700, color:'#ff5722' }}>{timer}</div>
                </div>
                <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5', letterSpacing:'.1em', marginTop:8 }}>NEXT NUMBER</div>
              </div>

              {/* Recent Numbers */}
              <div style={{ background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:16, padding:20, marginBottom:16 }}>
                <div style={{ fontFamily:'"DM Mono",monospace', fontSize:10, color:'#4a7fa5', letterSpacing:'.12em', marginBottom:14 }}>LAST 10 DRAWN</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {lastCalled.map((n,i) => <Ball key={n} num={n} isNew={i===0} />)}
                </div>
              </div>

              {/* Full number board */}
              <div style={{ background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:16, padding:20 }}>
                <div style={{ fontFamily:'"DM Mono",monospace', fontSize:10, color:'#4a7fa5', letterSpacing:'.12em', marginBottom:14 }}>NUMBER BOARD</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(9,1fr)', gap:3 }}>
                  {Array.from({length:90},(_,i)=>i+1).map(n => (
                    <div key={n} style={{
                      height:28, display:'flex', alignItems:'center', justifyContent:'center',
                      fontFamily:'"DM Mono",monospace', fontSize:10, fontWeight:700, borderRadius:4,
                      background: calledNums.has(n) ? '#ff572222' : '#060d16',
                      color: calledNums.has(n) ? '#ff8c00' : '#1e3a5f',
                      border: `1px solid ${calledNums.has(n) ? '#ff572244' : '#0e2233'}`,
                      transition:'all 0.3s ease',
                    }}>{n}</div>
                  ))}
                </div>
              </div>

              {/* Win log */}
              {winEvents.length > 0 && (
                <div style={{ background:'#0a1628', border:'1px solid #f7c94833', borderRadius:16, padding:20, marginTop:16 }}>
                  <div style={{ fontFamily:'"DM Mono",monospace', fontSize:10, color:'#f7c948', letterSpacing:'.12em', marginBottom:14 }}>WIN LOG</div>
                  {winEvents.slice().reverse().map((w,i) => (
                    <div key={i} style={{ padding:'8px 0', borderBottom:'1px solid #0e2233' }}>
                      <div style={{ fontSize:12, fontWeight:700, marginBottom:2 }}>{w.label}</div>
                      <div style={{ fontFamily:'"DM Mono",monospace', fontSize:10, color:'#4a7fa5' }}>Device #{w.deviceId}</div>
                    </div>
                  ))}
                </div>
              )}

              <button className="btn-ghost" style={{ width:'100%', padding:'10px 0', fontSize:12, marginTop:16 }} onClick={()=>setShowMintModal(true)}>
                + Mint Another Device
              </button>
            </div>

            {/* Right: Devices */}
            <div>
              <div style={{ fontFamily:'"DM Mono",monospace', fontSize:10, color:'#4a7fa5', letterSpacing:'.15em', marginBottom:16 }}>
                YOUR HACKING DEVICES — {devices.length} DEPLOYED
              </div>
              {devices.length === 0 ? (
                <div style={{ background:'#0a1628', border:'1px dashed #1e3a5f', borderRadius:16, padding:'60px 24px', textAlign:'center' }}>
                  <div style={{ fontSize:48, marginBottom:16 }}>🔧</div>
                  <div style={{ fontSize:18, fontWeight:700, marginBottom:8 }}>No Devices Deployed</div>
                  <div style={{ color:'#4a7fa5', marginBottom:24, fontSize:14 }}>Mint a hacking device to start playing</div>
                  <button className="btn-primary" style={{ padding:'12px 24px', fontSize:14 }} onClick={()=>setShowMintModal(true)}>
                    Mint First Device
                  </button>
                </div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:16 }}>
                  {devices.map(d => (
                    <DeviceCard key={d.id} device={d} calledNums={calledNums} onCellClick={handleCellClick} onClaimRansome={handleClaimRansome} winEvents={winEvents} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      )}

      <footer style={{ borderTop:'1px solid #0e2233', padding:'20px 32px', display:'flex', justifyContent:'space-between', marginTop:60, fontFamily:'"DM Mono",monospace', fontSize:11, color:'#1e4a6e', flexWrap:'wrap', gap:10 }}>
        <span>RANSOME PROTOCOL · SOLANA DEVNET · RNSM</span>
        <span>CZmrXH...Tw6d</span>
      </footer>
    </>
  )
}
