'use client'
import './globals.css'
import { useState, useEffect, useCallback, useRef } from 'react'

type Cell = { num: number | null; matched: boolean; clicked: boolean }
type Device = { id: number; grid: Cell[][]; claimed: Set<string>; active: boolean; corrupted: boolean }
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
const LED_COLORS: Record<WinType, string> = {
  EARLY_FIVE:   '#f59e0b',
  TOP_LINE:     '#0ea5e9',
  MIDDLE_LINE:  '#22c55e',
  BOTTOM_LINE:  '#a16207',
  FULL_HOUSE_1: '#f472b6',
  FULL_HOUSE_2: '#ec4899',
  FULL_HOUSE_3: '#db2777',
}
const ROW_COLORS = ['#ef4444','#f97316','#f59e0b','#22c55e','#06b6d4']
const BANKS = [
  { id:0,  name:'Pacific Reserve',   city:'Auckland',      tz:12,  x:88,y:72 },
  { id:1,  name:'Sakura Central',    city:'Tokyo',         tz:9,   x:80,y:30 },
  { id:2,  name:'Dragon Vault',      city:'Shanghai',      tz:8,   x:76,y:34 },
  { id:3,  name:'Tiger Bank',        city:'Singapore',     tz:8,   x:74,y:53 },
  { id:4,  name:'Indus Capital',     city:'Mumbai',        tz:5.5, x:65,y:40 },
  { id:5,  name:'Gulf Reserve',      city:'Dubai',         tz:4,   x:61,y:39 },
  { id:6,  name:'Nile Treasury',     city:'Cairo',         tz:2,   x:53,y:36 },
  { id:7,  name:'Savanna Vault',     city:'Nairobi',       tz:3,   x:56,y:57 },
  { id:8,  name:'Cape Reserve',      city:'Cape Town',     tz:2,   x:52,y:74 },
  { id:9,  name:'Colosseum Bank',    city:'Rome',          tz:1,   x:49,y:28 },
  { id:10, name:'Rhine Vault',       city:'Frankfurt',     tz:1,   x:49,y:22 },
  { id:11, name:'Thames Capital',    city:'London',        tz:0,   x:46,y:22 },
  { id:12, name:'Nordic Reserve',    city:'Oslo',          tz:1,   x:49,y:16 },
  { id:13, name:'Kremlin Bank',      city:'Moscow',        tz:3,   x:57,y:19 },
  { id:14, name:'Atlas Treasury',    city:'Casablanca',    tz:1,   x:44,y:34 },
  { id:15, name:'Amazon Reserve',    city:'São Paulo',     tz:-3,  x:32,y:67 },
  { id:16, name:'Andes Vault',       city:'Bogotá',        tz:-5,  x:25,y:54 },
  { id:17, name:'Manhattan Capital', city:'New York',      tz:-5,  x:22,y:28 },
  { id:18, name:'Silicon Reserve',   city:'San Francisco', tz:-8,  x:10,y:31 },
  { id:19, name:'Maple Treasury',    city:'Toronto',       tz:-5,  x:21,y:24 },
  { id:20, name:'Red Sea Bank',      city:'Riyadh',        tz:3,   x:58,y:39 },
  { id:21, name:'Carnival Bank',     city:'Rio',           tz:-3,  x:33,y:68 },
  { id:22, name:'Azores Vault',      city:'Lisbon',        tz:0,   x:44,y:28 },
]
const TERM_CMDS = [
  'INIT PAYLOAD','BYPASS FIREWALL','SCAN PORT 8443','BRUTE SHA-256',
  'DECRYPT TLS','EXPLOIT CVE-2024','INJECT SQL','PIVOT SUBNET',
  'EXFIL VAULT','SPOOF MAC','ARP POISON','DUMP LSASS',
  'ESCALATE PRIV','DEPLOY ROOTKIT','TUNNEL SSH','SNIFF ETH0',
  'CRACK WPA2','OVERFLOW STACK','UPLOAD PAYLOAD','COVER TRACKS',
]
function getLiveBank(h: number) { return h % 23 }
function generateDevice(id: number): Device {
  const cols = [[1,10],[11,20],[21,30],[31,40],[41,50],[51,60],[61,70],[71,80],[81,90]]
  const grid: Cell[][] = Array.from({length:3}, () =>
    Array(9).fill(null).map(() => ({num:null,matched:false,clicked:false}))
  )
  for (let r = 0; r < 3; r++) {
    const chosen = Array.from({length:9},(_,i)=>i).sort(()=>Math.random()-0.5).slice(0,5).sort((a,b)=>a-b)
    for (const ci of chosen) {
      const [lo,hi] = cols[ci]
      let num: number
      do { num = Math.floor(Math.random()*(hi-lo+1))+lo } while (grid.some(row=>row[ci].num===num))
      grid[r][ci] = {num, matched:false, clicked:false}
    }
  }
  return {id, grid, claimed:new Set(), active:true, corrupted:false}
}

// ─── Mini Stopwatch inside device ────────────────────────────────────────────
function MiniStopwatch({ seconds, total }: { seconds:number; total:number }) {
  const danger = seconds <= 10
  const r = 14, circ = 2 * Math.PI * r
  const dash = circ * (seconds / total)
  return (
    <div style={{ position:'relative', width:40, height:40, flexShrink:0 }}>
      <svg width="40" height="40" style={{ transform:'rotate(-90deg)' }}>
        <circle cx="20" cy="20" r={r} fill="none" stroke="#0a1628" strokeWidth="3"/>
        <circle cx="20" cy="20" r={r} fill="none"
          stroke={danger?'#ef4444':'#00e5a0'} strokeWidth="3"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition:'stroke-dasharray 0.9s linear, stroke 0.3s' }}
        />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, fontWeight:700,
          color:danger?'#ef4444':'#00e5a0', lineHeight:1,
          textShadow:danger?'0 0 6px #ef4444':'0 0 6px #00e5a0' }}>
          {String(seconds % 60).padStart(2,'0')}
        </div>
      </div>
    </div>
  )
}

// ─── World Map ────────────────────────────────────────────────────────────────
function WorldMap({ selectedBank, onSelect, currentHour }: { selectedBank:number|null; onSelect:(id:number)=>void; currentHour:number }) {
  const live = getLiveBank(currentHour)
  return (
    <div style={{ position:'relative', width:'100%', paddingTop:'46%', borderRadius:12, overflow:'hidden', background:'#0a1628', border:'1px solid #1e3a5f' }}>
      <div style={{ position:'absolute', inset:0 }}>
        <svg viewBox="0 0 100 100" style={{ width:'100%', height:'100%' }}>
          {Array.from({length:13},(_,i)=><line key={`v${i}`} x1={i*100/12} y1="0" x2={i*100/12} y2="100" stroke="#0d2137" strokeWidth="0.25"/>)}
          {Array.from({length:7},(_,i)=><line key={`h${i}`} x1="0" y1={i*100/6} x2="100" y2={i*100/6} stroke="#0d2137" strokeWidth="0.25"/>)}
          <ellipse cx="18" cy="28" rx="12" ry="14" fill="#0d2137" stroke="#1e3a5f" strokeWidth="0.4"/>
          <ellipse cx="28" cy="63" rx="7" ry="13" fill="#0d2137" stroke="#1e3a5f" strokeWidth="0.4"/>
          <ellipse cx="49" cy="23" rx="6" ry="8" fill="#0d2137" stroke="#1e3a5f" strokeWidth="0.4"/>
          <ellipse cx="50" cy="53" rx="7" ry="16" fill="#0d2137" stroke="#1e3a5f" strokeWidth="0.4"/>
          <ellipse cx="70" cy="29" rx="18" ry="14" fill="#0d2137" stroke="#1e3a5f" strokeWidth="0.4"/>
          <ellipse cx="82" cy="65" rx="7" ry="6" fill="#0d2137" stroke="#1e3a5f" strokeWidth="0.4"/>
          {BANKS.map(b => {
            const isLive = b.id===live, isSel = b.id===selectedBank
            return (
              <g key={b.id} onClick={()=>onSelect(b.id)} style={{cursor:'pointer'}}>
                {isLive && <circle cx={b.x} cy={b.y} r="4" fill="rgba(239,68,68,0.15)"><animate attributeName="r" values="2.5;5;2.5" dur="1.5s" repeatCount="indefinite"/></circle>}
                <circle cx={b.x} cy={b.y} r={isLive?2.2:isSel?1.8:1.1}
                  fill={isLive?'#ef4444':isSel?'#00e5a0':'#1e3a5f'}
                  stroke={isLive?'#fca5a5':isSel?'#6ee7b7':'#2a5a7a'} strokeWidth="0.4"
                />
                {(isSel||isLive) && <text x={b.x} y={b.y-3.5} textAnchor="middle" fontSize="2.6" fill={isLive?'#ef4444':'#00e5a0'}>{b.city}</text>}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ─── Hacking Device ───────────────────────────────────────────────────────────
function HackingDevice({ device, currentNum, clickWindowOpen, onCellClick, onClaim, winStates, bankruptCount, timer, totalTimer }: {
  device:Device; currentNum:number|null; clickWindowOpen:boolean;
  onCellClick:(id:number,r:number,c:number)=>void; onClaim:(id:number,w:WinType)=>void;
  winStates:Record<WinType,{claimed:boolean;claimable:boolean}>; bankruptCount:number;
  timer:number; totalTimer:number
}) {
  const flat = device.grid.flat()
  const clickedN = flat.filter(c=>c.clicked).length
  const row0Done = device.grid[0].filter(c=>c.num).every(c=>c.clicked)
  const row1Done = device.grid[1].filter(c=>c.num).every(c=>c.clicked)
  const row2Done = device.grid[2].filter(c=>c.num).every(c=>c.clicked)
  const allDone  = flat.filter(c=>c.num).every(c=>c.clicked)
  const fhKey    = `FULL_HOUSE_${Math.min(bankruptCount+1,3)}` as WinType

  const wins: WinType[] = []
  if (clickedN >= 5 && !device.claimed.has('EARLY_FIVE') && winStates.EARLY_FIVE.claimable && !winStates.EARLY_FIVE.claimed) wins.push('EARLY_FIVE')
  if (row0Done && !device.claimed.has('TOP_LINE') && winStates.TOP_LINE.claimable && !winStates.TOP_LINE.claimed) wins.push('TOP_LINE')
  if (row1Done && !device.claimed.has('MIDDLE_LINE') && winStates.MIDDLE_LINE.claimable && !winStates.MIDDLE_LINE.claimed) wins.push('MIDDLE_LINE')
  if (row2Done && !device.claimed.has('BOTTOM_LINE') && winStates.BOTTOM_LINE.claimable && !winStates.BOTTOM_LINE.claimed) wins.push('BOTTOM_LINE')
  if (allDone && winStates[fhKey]?.claimable && !winStates[fhKey]?.claimed && !device.claimed.has(fhKey)) wins.push(fhKey)
  const canClaim = wins.length > 0
  const doClaim = () => { if (wins.length) onClaim(device.id, wins[0]) }
  const LED_TYPES: WinType[] = ['EARLY_FIVE','TOP_LINE','MIDDLE_LINE','BOTTOM_LINE','FULL_HOUSE_1','FULL_HOUSE_2','FULL_HOUSE_3']

  return (
    <div style={{
      background:'linear-gradient(180deg,#0d1a2e 0%,#060e1a 100%)',
      border:`2px solid ${canClaim?'#ec4899':'#162438'}`,
      borderRadius:16, padding:0,
      boxShadow: canClaim ? '0 0 0 2px rgba(236,72,153,0.3),0 8px 32px rgba(236,72,153,0.2)' : '0 6px 24px rgba(0,0,0,0.7)',
      display:'flex', flexDirection:'column', overflow:'hidden', userSelect:'none',
    }}>
      {/* Cable connectors top */}
      <div style={{ background:'#0a1628', padding:'5px 10px 4px', display:'flex', justifyContent:'center', gap:10, borderBottom:'2px solid #0d1f3a' }}>
        {[0,1,2].map(i=>(
          <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
            <div style={{ width:6, height:9, background:'linear-gradient(180deg,#1e3a5f,#0a1628)', borderRadius:'3px 3px 0 0', border:'1px solid #2a5a7a', borderBottom:'none' }}/>
            <div style={{ width:3, height:3, background:'#1e3a5f' }}/>
          </div>
        ))}
        <div style={{ flex:1 }}/>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:6, color:'#1e3a5f', alignSelf:'flex-end', paddingBottom:1 }}>
          DEV-{String(device.id).padStart(5,'0')}
        </div>
      </div>

      {/* Number display screen */}
      <div style={{ background:'#030a12', margin:'6px 6px 0', borderRadius:8, border:'2px solid #0d2035', padding:'7px 5px', boxShadow:'inset 0 0 20px rgba(0,0,0,0.9)', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', inset:0, borderRadius:8, backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.07) 3px,rgba(0,0,0,0.07) 4px)', pointerEvents:'none', zIndex:1 }}/>
        <div style={{ position:'relative', zIndex:2 }}>
          {device.grid.map((row, ri) => (
            <div key={ri} style={{ display:'grid', gridTemplateColumns:'repeat(9,1fr)', gap:2, marginBottom: ri<2 ? 3 : 0 }}>
              {row.map((cell, ci) => {
                const isCurrent   = cell.num !== null && cell.num === currentNum
                const isClickable = isCurrent && clickWindowOpen && !cell.clicked
                const isEmpty     = cell.num === null
                const rc          = ROW_COLORS[ri % ROW_COLORS.length]
                return (
                  <button key={ci} onClick={() => isClickable && onCellClick(device.id, ri, ci)} style={{
                    height:22, borderRadius:4, border:'none', padding:0,
                    cursor: isClickable ? 'pointer' : 'default',
                    background: isEmpty ? 'transparent' : cell.clicked ? 'rgba(0,229,160,0.12)' : 'transparent',
                    color: isEmpty ? 'transparent' : cell.clicked ? '#00e5a0' : isClickable ? '#fff' : rc,
                    fontFamily:'"DM Mono",monospace', fontSize:11, fontWeight:700,
                    textShadow: isEmpty ? 'none' : cell.clicked ? '0 0 10px #00e5a0,0 0 20px #00e5a060' : isClickable ? '0 0 14px #fff,0 0 6px #fff' : `0 0 5px ${rc}80`,
                    opacity: isEmpty ? 0 : 1,
                    animation: (!isEmpty && !isClickable && !cell.clicked) ? `gx${(ri*9+ci)%3} ${2.5+(ri*9+ci)%2}s ${(ri*9+ci)*0.09}s infinite` : 'none',
                    boxShadow: isClickable ? `inset 0 0 0 1px ${rc}` : 'none',
                    transition:'opacity 0.15s,text-shadow 0.15s',
                  }}>{cell.num ?? ''}</button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* LED strip */}
      <div style={{ display:'flex', justifyContent:'center', gap:4, padding:'5px 6px 2px', alignItems:'center' }}>
        <div style={{ display:'flex', gap:2 }}>{[0,1].map(i=><div key={i} style={{ width:8,height:6,borderRadius:1,background:'#0a1628',border:'1px solid #162438' }}/>)}</div>
        {LED_TYPES.map((type, i) => {
          const st = winStates[type], won = device.claimed.has(type), lit = st.claimable && !st.claimed, dead = st.claimed && !won
          return (
            <div key={type} title={WIN_LABELS[type]} style={{
              width:12, height:9, borderRadius:2,
              background:(won||lit)?LED_COLORS[type]:dead?'#050d17':'#0a1628',
              border:`1px solid ${(won||lit)?LED_COLORS[type]:'#162438'}`,
              boxShadow:(won||lit)?`0 0 5px ${LED_COLORS[type]},0 0 10px ${LED_COLORS[type]}60`:'none',
              opacity:dead?0.25:1,
              animation:lit&&!won?`ledBlink 0.5s ${i*0.07}s infinite`:'none',
            }}/>
          )
        })}
        <div style={{ display:'flex', gap:2 }}>{[0,1,2,3].map(i=><div key={i} style={{ width:8,height:6,borderRadius:1,background:'#0a1628',border:'1px solid #162438' }}/>)}</div>
      </div>

      {/* Bottom: buttons + stopwatch + RANSOM + knobs */}
      <div style={{ display:'flex', gap:5, alignItems:'center', padding:'3px 7px 7px' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
          <div style={{ width:9,height:9,borderRadius:2,background:'#ef4444',boxShadow:'0 0 5px #ef4444' }}/>
          <div style={{ width:9,height:9,borderRadius:2,background:'#f97316',boxShadow:'0 0 5px #f97316' }}/>
          <div style={{ width:9,height:9,borderRadius:2,background:'#0a1628',border:'1px solid #162438' }}/>
        </div>
        <MiniStopwatch seconds={timer} total={totalTimer} />
        <button onClick={doClaim} disabled={!canClaim} style={{
          flex:1, background: canClaim ? 'linear-gradient(180deg,#1a0000,#0d0000)' : 'linear-gradient(180deg,#080f18,#040a10)',
          border:`2px solid ${canClaim?'#ff2020':'#162438'}`, borderRadius:8, padding:'7px 4px',
          cursor:canClaim?'pointer':'default', display:'flex', alignItems:'center', justifyContent:'center',
          transition:'all 0.2s', animation:canClaim?'ransomPulse 1s infinite':'none',
          boxShadow:canClaim?'inset 0 0 12px rgba(255,32,32,0.3),0 0 12px rgba(255,32,32,0.4)':'inset 0 0 6px rgba(0,0,0,0.5)',
        }}>
          <span style={{ fontFamily:'"Syne",sans-serif', fontSize:13, fontWeight:800, letterSpacing:'0.12em',
            color:canClaim?'#ff4040':'#1e3a5f',
            textShadow:canClaim?'0 0 8px #ff2020,0 0 20px #ff202080,0 0 40px #ff202040':'none' }}>
            RANSOM
          </span>
        </button>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {[0,1].map(i=>(
            <div key={i} style={{ width:15,height:15,borderRadius:'50%',
              background:'radial-gradient(circle at 35% 30%,#2a4a6a,#050d17)',
              border:'1.5px solid #1e3a5f', boxShadow:'inset 0 1px 3px rgba(0,0,0,0.9)' }}/>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Matrix Display ───────────────────────────────────────────────────────────
// The 'i' toggle HIDES the big broadcast number panel — the number board grid expands to fill that space
function MatrixDisplay({ calledNums, calledOrder, clickWindowOpen }: {
  calledNums:Set<number>; calledOrder:number[]; clickWindowOpen:boolean
}) {
  const [hideBroadcast, setHideBroadcast] = useState(false)
  const [glitching, setGlitching] = useState(false)
  const lastNum = calledOrder[calledOrder.length-1] ?? null
  const prev6   = calledOrder.slice(-7,-1).reverse()
  const prevNumRef = useRef(lastNum)

  useEffect(() => {
    if (lastNum !== prevNumRef.current) {
      prevNumRef.current = lastNum
      setGlitching(true)
      setTimeout(() => setGlitching(false), 600)
    }
  }, [lastNum])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      {/* Broadcast panel — hidden when 'i' toggled */}
      {!hideBroadcast && (
        <div style={{ background:'#020d1a', border:'2px solid #0a3a5a', borderRadius:14, padding:'14px 12px', position:'relative', overflow:'hidden', boxShadow:'inset 0 0 40px rgba(0,229,160,0.04)' }}>
          <div style={{ position:'absolute', inset:0, backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.15) 2px,rgba(0,0,0,0.15) 4px)', pointerEvents:'none', zIndex:1 }}/>
          <div style={{ position:'relative', zIndex:2 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#2a5a7a', letterSpacing:'0.2em' }}>◉ BANK BROADCAST</div>
              {/* 'i' button — hides this panel, number board expands */}
              <button onClick={()=>setHideBroadcast(true)} title="Expand number board" style={{
                width:20, height:20, borderRadius:'50%', background:'transparent',
                border:'1px solid #1e3a5f', color:'#4a7fa5',
                fontFamily:'"DM Mono",monospace', fontSize:9, fontWeight:700,
                cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
              }}>i</button>
            </div>
            <div style={{ textAlign:'center' }}>
              <div style={{ position:'relative', display:'inline-block' }}>
                <div key={String(lastNum)} style={{
                  fontFamily:'"Syne",sans-serif', fontSize:76, fontWeight:800, lineHeight:1,
                  color:'#00e5a0', display:'block',
                  textShadow:'0 0 20px #00e5a0,0 0 40px #00e5a060,0 0 80px #00e5a030',
                  animation: glitching ? 'matrixGlitch 0.6s ease' : 'numAppear 0.4s cubic-bezier(.34,1.56,.64,1)',
                }}>{lastNum ?? '??'}</div>
                {glitching && (
                  <>
                    <div style={{ position:'absolute', inset:0, fontFamily:'"Syne",sans-serif', fontSize:76, fontWeight:800, color:'#ff0040', opacity:0.4, animation:'glitchR 0.6s ease', pointerEvents:'none' }}>{lastNum}</div>
                    <div style={{ position:'absolute', inset:0, fontFamily:'"Syne",sans-serif', fontSize:76, fontWeight:800, color:'#00b8ff', opacity:0.4, animation:'glitchB 0.6s ease', pointerEvents:'none' }}>{lastNum}</div>
                  </>
                )}
              </div>
              <div style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:6, padding:'3px 10px',
                background:clickWindowOpen?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.08)',
                border:`1px solid ${clickWindowOpen?'rgba(34,197,94,0.4)':'rgba(239,68,68,0.25)'}`, borderRadius:20 }}>
                <div style={{ width:5,height:5,borderRadius:'50%',background:clickWindowOpen?'#22c55e':'#ef4444', animation:clickWindowOpen?'dot 1s infinite':'none' }}/>
                <div style={{ fontFamily:'"DM Mono",monospace', fontSize:7.5, color:clickWindowOpen?'#22c55e':'#ef4444' }}>
                  {clickWindowOpen?'CLICK WINDOW OPEN':'WINDOW CLOSED'}
                </div>
              </div>
              <div style={{ display:'flex', gap:5, justifyContent:'center', marginTop:10 }}>
                {prev6.map((n,i)=>(
                  <div key={i} style={{ width:26,height:26,borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center',
                    background:'#0a1628',border:'1px solid #1e3a5f',
                    fontFamily:'"DM Mono",monospace',fontSize:9,color:'#2a5a7a',opacity:1-i*0.13 }}>{n}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Number board 1–90 — always visible; expands when broadcast hidden */}
      <div style={{ background:'#020d1a', border:'1px solid #0a2535', borderRadius:10, padding:'8px 8px 6px', position:'relative' }}>
        {/* When broadcast is hidden, show a small '×' to restore it */}
        {hideBroadcast && (
          <button onClick={()=>setHideBroadcast(false)} title="Show broadcast" style={{
            position:'absolute', top:6, right:6, width:20, height:20, borderRadius:'50%',
            background:'#0a1628', border:'1px solid #00e5a040', color:'#00e5a0',
            fontFamily:'"DM Mono",monospace', fontSize:10, fontWeight:700,
            cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', zIndex:2,
          }}>×</button>
        )}
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:7, color:'#1e4a6a', marginBottom:5, letterSpacing:'0.1em' }}>
          NUMBERS DRAWN ({calledNums.size}/90)
          {hideBroadcast && <span style={{ color:'#00e5a0', marginLeft:8 }}>● LIVE: {lastNum ?? '—'}</span>}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(10,1fr)', gap:2 }}>
          {Array.from({length:90},(_,i)=>i+1).map(n=>(
            <div key={n} style={{
              height:17, borderRadius:3, display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:'"DM Mono",monospace', fontSize:7.5, fontWeight:700,
              background: n===lastNum?'#00e5a0' : calledNums.has(n)?'#0a2535':'transparent',
              color: n===lastNum?'#000' : calledNums.has(n)?'#2a5a7a':'#0a1628',
              border: n===lastNum?'none' : calledNums.has(n)?'1px solid #1e3a5f':'1px solid #070f1a',
              boxShadow: n===lastNum?'0 0 6px #00e5a0':'none',
              transition:'background 0.3s',
            }}>{n}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Chat Terminal ────────────────────────────────────────────────────────────
// Fixed height — NEVER causes page scroll
function ChatTerminal({ nickname }: { nickname:string }) {
  const [lines, setLines] = useState<{t:'sys'|'user'|'cmd';m:string}[]>([
    {t:'sys', m:'HACKING MATRIX v3.7.1 INITIALIZED'},
    {t:'sys', m:'SECURE CHANNEL ACTIVE'},
    {t:'sys', m:`AGENT ${nickname.toUpperCase()} CONNECTED`},
  ])
  const [input, setInput] = useState('')
  // Ref to the scrollable container — NOT the window
  const scrollBoxRef = useRef<HTMLDivElement>(null)

  // Scroll the INNER BOX only — never the page
  useEffect(() => {
    const box = scrollBoxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [lines])

  useEffect(()=>{
    const t = setInterval(()=>{
      const cmd = TERM_CMDS[Math.floor(Math.random()*TERM_CMDS.length)]
      const hex = Math.random().toString(16).slice(2,8).toUpperCase()
      setLines(p=>[...p.slice(-60),{t:'cmd',m:`> ${cmd}... [0x${hex}]`}])
    }, 2800+Math.random()*3000)
    return ()=>clearInterval(t)
  },[])

  const send = () => {
    if (!input.trim()) return
    setLines(p=>[...p,{t:'user',m:`${nickname}: ${input}`}])
    setInput('')
    setTimeout(()=>setLines(p=>[...p,{t:'cmd',m:`> ${TERM_CMDS[Math.floor(Math.random()*TERM_CMDS.length)]}... [ACK]`}]),600)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', background:'#020d1a', border:'1px solid #0a2535', borderRadius:12, overflow:'hidden' }}>
      <div style={{ padding:'5px 10px', borderBottom:'1px solid #0a2535', fontFamily:'"DM Mono",monospace', fontSize:7.5, color:'#00e5a0', letterSpacing:'0.12em', display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
        <div style={{ width:5,height:5,borderRadius:'50%',background:'#22c55e',animation:'dot 1.5s infinite' }}/>
        HACKING MATRIX — SECURE CHAT
      </div>
      {/* Fixed-height scroll box — scrollTop set via ref, never scrollIntoView */}
      <div ref={scrollBoxRef} style={{ height:200, overflowY:'auto', padding:'7px 8px', display:'flex', flexDirection:'column', gap:2 }}>
        {lines.map((l,i)=>(
          <div key={i} style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:l.t==='sys'?'#00e5a0':l.t==='user'?'#00b8ff':'#2a5a7a', fontWeight:l.t==='user'?600:400 }}>{l.m}</div>
        ))}
      </div>
      <div style={{ display:'flex', borderTop:'1px solid #0a2535', flexShrink:0 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}
          placeholder="TYPE COMMAND..."
          style={{ flex:1, background:'transparent', border:'none', padding:'6px 10px', fontFamily:'"DM Mono",monospace', fontSize:8, color:'#00b8ff', outline:'none' }}/>
        <button onClick={send} style={{ background:'#0a1628', border:'none', borderLeft:'1px solid #0a2535', padding:'6px 10px', color:'#2a5a7a', cursor:'pointer', fontFamily:'"DM Mono",monospace', fontSize:8 }}>SEND</button>
      </div>
    </div>
  )
}

// ─── Game Stats ───────────────────────────────────────────────────────────────
function GameStats({ devices, calledNums, bankruptCount, liveBank, nickname }: {
  devices:Device[]; calledNums:Set<number>; bankruptCount:number; liveBank:number; nickname:string
}) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ background:'#020d1a', border:'1px solid #0a2535', borderRadius:12, padding:12 }}>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#2a5a7a', letterSpacing:'0.12em', marginBottom:8 }}>GAME STATS</div>
        {[
          ['AGENT', nickname],
          ['TARGET', BANKS[liveBank].name],
          ['DRAWN', `${calledNums.size}/90`],
          ['DEVICES', String(devices.length)],
          ['BANKRUPTS', `${bankruptCount}/3`],
        ].map(([k,v])=>(
          <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom:'1px solid #0a1628' }}>
            <span style={{ fontFamily:'"DM Mono",monospace', fontSize:7.5, color:'#1e4a6a' }}>{k}</span>
            <span style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#4a7fa5', fontWeight:600 }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ background:'#020d1a', border:'1px solid #0a2535', borderRadius:10, padding:10 }}>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:7.5, color:'#1e4a6a', marginBottom:6 }}>LED KEY</div>
        {(Object.entries(LED_COLORS) as [WinType,string][]).map(([type,color])=>(
          <div key={type} style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4 }}>
            <div style={{ width:10,height:7,borderRadius:2,background:color,boxShadow:`0 0 4px ${color}60` }}/>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:7, color:'#2a5a7a' }}>{WIN_LABELS[type]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Nickname Modal ───────────────────────────────────────────────────────────
function NicknameModal({ onConfirm }: { onConfirm:(name:string)=>void }) {
  const [name, setName] = useState('')
  const [err, setErr]   = useState('')
  const submit = () => {
    if (name.trim().length < 3) { setErr('Min 3 characters'); return }
    if (name.trim().length > 16) { setErr('Max 16 characters'); return }
    onConfirm(name.trim())
  }
  return (
    <div style={{ position:'fixed', inset:0, background:'linear-gradient(135deg,#010810,#020d1a)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
      <div style={{ background:'#020d1a', border:'1px solid #0a3a5a', borderRadius:20, padding:36, maxWidth:360, width:'90%', boxShadow:'0 0 60px rgba(0,229,160,0.08)' }}>
        <div style={{ fontFamily:'"Syne",sans-serif', fontSize:28, fontWeight:800, color:'#00e5a0', textShadow:'0 0 20px #00e5a060', marginBottom:4 }}>RANSOME</div>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#2a5a7a', letterSpacing:'0.18em', marginBottom:28 }}>HACK THE BANKS — CLAIM THE VAULT</div>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#4a7fa5', marginBottom:8 }}>CHOOSE YOUR AGENT NAME</div>
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
          placeholder="e.g. GHOST_ZERO" maxLength={16}
          style={{ width:'100%', background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:10, padding:'10px 14px', fontFamily:'"DM Mono",monospace', fontSize:13, color:'#00e5a0', outline:'none', boxSizing:'border-box', marginBottom:6, caretColor:'#00e5a0' }}/>
        {err && <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#ef4444', marginBottom:8 }}>{err}</div>}
        <button onClick={submit} style={{ width:'100%', background:'linear-gradient(135deg,#00e5a0,#00b8ff)', color:'#000', border:'none', borderRadius:10, padding:'12px', fontFamily:'"Syne",sans-serif', fontSize:14, fontWeight:700, cursor:'pointer', marginTop:6 }}>
          ENTER THE MATRIX →
        </button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Ransome() {
  const [phase, setPhase]         = useState<string>('setup')
  const [nickname, setNickname]   = useState('')
  const [wallet, setWallet]       = useState<string|null>(null)
  const [devices, setDevices]     = useState<Device[]>([])
  const [calledNums, setCalledNums] = useState<Set<number>>(new Set())
  const [calledOrder, setCalledOrder] = useState<number[]>([])
  const [timer, setTimer]         = useState(60)
  const [totalTimer, setTotalTimer] = useState(60)
  const [clickWindowOpen, setClickWindowOpen] = useState(false)
  const [announcement, setAnnouncement] = useState<string|null>(null)
  const [bankruptCount, setBankruptCount] = useState(0)
  const [mintCount, setMintCount] = useState(1)
  const [mintToken, setMintToken] = useState('USDT')
  const [selectedBank, setSelectedBank] = useState<number|null>(null)
  const [devicesExpanded, setDevicesExpanded] = useState(false)
  const [devicePage, setDevicePage] = useState(0)
  const [winStates, setWinStates] = useState<Record<WinType,{claimed:boolean;claimable:boolean}>>({
    EARLY_FIVE:   {claimed:false,claimable:false},
    TOP_LINE:     {claimed:false,claimable:false},
    MIDDLE_LINE:  {claimed:false,claimable:false},
    BOTTOM_LINE:  {claimed:false,claimable:false},
    FULL_HOUSE_1: {claimed:false,claimable:false},
    FULL_HOUSE_2: {claimed:false,claimable:false},
    FULL_HOUSE_3: {claimed:false,claimable:false},
  })
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null)
  const currentHour = new Date().getUTCHours()
  const liveBank    = getLiveBank(currentHour)
  const currentNum  = calledOrder[calledOrder.length-1] ?? null
  const totalPages  = Math.max(1, Math.ceil(devices.length/10))

  const announce = (msg:string) => { setAnnouncement(msg); setTimeout(()=>setAnnouncement(null), 4000) }

  const drawNumber = useCallback(() => {
    setClickWindowOpen(false)
    setCalledNums(prev => {
      if (prev.size >= 90) return prev
      const remaining = Array.from({length:90},(_,i)=>i+1).filter(n=>!prev.has(n))
      if (!remaining.length) return prev
      const num = remaining[Math.floor(Math.random()*remaining.length)]
      setCalledOrder(o=>[...o,num])
      setDevices(ds=>ds.map(d=>{
        if (!d.active||d.corrupted) return d
        return {...d, grid:d.grid.map(row=>row.map(cell=>cell.num===num?{...cell,matched:true}:cell))}
      }))
      setTimeout(()=>setClickWindowOpen(true), 150)
      return new Set(Array.from(prev).concat([num]))
    })
  }, [])

  useEffect(()=>{
    if (phase!=='game') return
    const t = 60 + Math.floor(Math.random()*31)
    setTimer(t); setTotalTimer(t)
    timerRef.current = setInterval(()=>{
      setTimer(prev=>{
        if (prev<=1) {
          setClickWindowOpen(false)
          const next = 60 + Math.floor(Math.random()*31)
          setTotalTimer(next)
          drawNumber()
          return next
        }
        return prev-1
      })
    },1000)
    return ()=>{ if(timerRef.current) clearInterval(timerRef.current) }
  },[phase, drawNumber])

  useEffect(()=>{
    if (phase!=='game') return
    setWinStates(prev=>{
      const next={...prev}
      devices.forEach(d=>{
        if (!d.active||d.corrupted) return
        const all = d.grid.flat()
        if (all.filter(c=>c.clicked).length>=5) next.EARLY_FIVE={...next.EARLY_FIVE,claimable:true}
        if (d.grid[0].filter(c=>c.num).every(c=>c.clicked)) next.TOP_LINE={...next.TOP_LINE,claimable:true}
        if (d.grid[1].filter(c=>c.num).every(c=>c.clicked)) next.MIDDLE_LINE={...next.MIDDLE_LINE,claimable:true}
        if (d.grid[2].filter(c=>c.num).every(c=>c.clicked)) next.BOTTOM_LINE={...next.BOTTOM_LINE,claimable:true}
        if (all.filter(c=>c.num).every(c=>c.clicked)) {
          const fk=`FULL_HOUSE_${Math.min(bankruptCount+1,3)}` as WinType
          next[fk]={...next[fk],claimable:true}
        }
      })
      return next
    })
  },[devices,phase])

  const handleCellClick=(devId:number,r:number,c:number)=>{
    if (!clickWindowOpen||!currentNum) return
    setDevices(ds=>ds.map(d=>{
      if (d.id!==devId) return d
      const cell=d.grid[r][c]
      if (!cell.num||cell.num!==currentNum||cell.clicked) return d
      return {...d, grid:d.grid.map((row,ri)=>row.map((cl,ci)=>ri===r&&ci===c?{...cl,clicked:true}:cl))}
    }))
  }

  const handleClaim=(devId:number,wt:WinType)=>{
    if (winStates[wt].claimed) return
    setDevices(ds=>ds.map(d=>d.id!==devId?d:{...d,claimed:new Set(Array.from(d.claimed).concat([wt]))}))
    setWinStates(prev=>({...prev,[wt]:{...prev[wt],claimed:true}}))
    announce(`✅ ${WIN_LABELS[wt]} — CLAIMED!`)
    if (wt.startsWith('FULL_HOUSE')) setBankruptCount(b=>Math.min(b+1,3))
  }

  const mintDevices=()=>{
    const nd=Array.from({length:mintCount},(_,i)=>generateDevice(devices.length+i))
    setDevices(p=>[...p,...nd])
    announce(`⚡ ${mintCount} DEVICE${mintCount>1?'S':''} MINTED`)
  }

  if (phase==='setup') return (
    <div style={{ minHeight:'100vh', background:'#010810' }}>
      <NicknameModal onConfirm={name=>{setNickname(name);setPhase('lobby')}}/>
    </div>
  )

  if (phase==='lobby') return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(180deg,#010810,#020d1a)', color:'#c8d8e8', padding:'20px 16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <div style={{ fontFamily:'"Syne",sans-serif', fontSize:26, fontWeight:800, color:'#00e5a0', textShadow:'0 0 20px #00e5a060' }}>RANSOME</div>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#2a5a7a', letterSpacing:'0.18em' }}>HACK THE BANKS — CLAIM THE VAULT</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#4a7fa5', background:'#0a1628', border:'1px solid #1e3a5f', borderRadius:8, padding:'5px 10px' }}>👤 {nickname}</div>
          <button onClick={()=>setWallet('HaCk...3r0x')} style={{ background:wallet?'#0a1628':'linear-gradient(135deg,#00e5a0,#00b8ff)', color:wallet?'#00e5a0':'#000', border:wallet?'1px solid #00e5a040':'none', borderRadius:8, padding:'6px 14px', fontFamily:'"DM Mono",monospace', fontSize:9, cursor:'pointer', fontWeight:600 }}>
            {wallet?`✓ ${wallet}`:'CONNECT WALLET'}
          </button>
        </div>
      </div>
      <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:14, padding:'14px 16px', marginBottom:14, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#ef4444', letterSpacing:'0.15em', marginBottom:2 }}>🔴 LIVE NOW — 1 HOUR WINDOW</div>
          <div style={{ fontFamily:'"Syne",sans-serif', fontSize:20, fontWeight:800, color:'#fff' }}>{BANKS[liveBank].name}</div>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#2a5a7a' }}>{BANKS[liveBank].city} · UTC{BANKS[liveBank].tz>=0?'+':''}{BANKS[liveBank].tz}</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#2a5a7a' }}>VAULT</div>
          <div style={{ fontFamily:'"Syne",sans-serif', fontSize:22, fontWeight:800, color:'#00e5a0' }}>$1,000,000</div>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:7, color:'#2a5a7a' }}>1M DEVICES @ $1</div>
        </div>
      </div>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#1e4a6a', letterSpacing:'0.12em', marginBottom:6 }}>⬡ GLOBAL BANK NETWORK — TAP TARGET</div>
        <WorldMap selectedBank={selectedBank} onSelect={setSelectedBank} currentHour={currentHour}/>
      </div>
      {wallet && (
        <div style={{ background:'#020d1a', border:'1px solid #0a2a4a', borderRadius:14, padding:14, marginBottom:14 }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:9, color:'#2a5a7a', letterSpacing:'0.12em', marginBottom:10 }}>MINT HACKING DEVICES</div>
          <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
            {['USDT','USDC','SOL','RNSM'].map(t=>(
              <button key={t} onClick={()=>setMintToken(t)} style={{ background:mintToken===t?'#0a3a5a':'transparent', color:mintToken===t?'#00e5a0':'#2a5a7a', border:`1px solid ${mintToken===t?'#00e5a040':'#0a2535'}`, borderRadius:7, padding:'5px 12px', fontFamily:'"DM Mono",monospace', fontSize:9, cursor:'pointer' }}>{t}</button>
            ))}
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:10, flexWrap:'wrap' }}>
            <span style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#2a5a7a' }}>QTY:</span>
            {[1,3,5,10].map(n=>(
              <button key={n} onClick={()=>setMintCount(n)} style={{ background:mintCount===n?'#0a3a5a':'transparent', color:mintCount===n?'#00e5a0':'#2a5a7a', border:`1px solid ${mintCount===n?'#00e5a040':'#0a2535'}`, borderRadius:7, padding:'4px 10px', fontFamily:'"DM Mono",monospace', fontSize:9, cursor:'pointer' }}>{n}</button>
            ))}
            <input type="number" value={mintCount} onChange={e=>setMintCount(Math.max(1,parseInt(e.target.value)||1))}
              style={{ width:56, background:'#0a1628', border:'1px solid #0a2535', borderRadius:7, padding:'4px 8px', fontFamily:'"DM Mono",monospace', fontSize:9, color:'#00e5a0', outline:'none' }}/>
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontFamily:'"DM Mono",monospace', fontSize:11, color:'#fff', fontWeight:600 }}>{mintCount} {mintToken}</div>
            <button onClick={mintDevices} style={{ background:'linear-gradient(135deg,#00e5a0,#00b8ff)', color:'#000', border:'none', borderRadius:9, padding:'9px 20px', fontFamily:'"DM Mono",monospace', fontSize:10, cursor:'pointer', fontWeight:700 }}>MINT DEVICES →</button>
          </div>
        </div>
      )}
      {devices.length>0 && (
        <button onClick={()=>{setPhase('game');announce('🔴 HACK INITIATED — RANSOME BANK BROADCAST LIVE');setTimeout(drawNumber,500)}}
          style={{ width:'100%', background:'linear-gradient(135deg,#ef4444,#dc2626)', color:'#fff', border:'none', borderRadius:12, padding:'14px', fontFamily:'"Syne",sans-serif', fontSize:16, fontWeight:800, cursor:'pointer', boxShadow:'0 4px 20px rgba(239,68,68,0.3)' }}>
          🔴 INITIATE HACK — {devices.length} DEVICE{devices.length>1?'S':''} READY
        </button>
      )}
      {announcement && (
        <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', background:'#020d1a', border:'1px solid #00e5a040', borderRadius:10, padding:'10px 20px', fontFamily:'"DM Mono",monospace', fontSize:10, color:'#00e5a0', zIndex:999, whiteSpace:'nowrap', boxShadow:'0 8px 24px rgba(0,0,0,0.5)' }}>
          {announcement}
        </div>
      )}
    </div>
  )

  // ── GAME SCREEN ───────────────────────────────────────────────────────────
  const pageDevices = devices.slice(devicePage*10, devicePage*10+10)

  return (
    <div style={{ background:'linear-gradient(180deg,#010810,#020d1a)', color:'#c8d8e8', minHeight:'100vh' }}>
      {/* Sticky header */}
      <div style={{ padding:'7px 14px', borderBottom:'1px solid #0a1f3a', display:'flex', justifyContent:'space-between', alignItems:'center', background:'rgba(2,13,26,0.95)', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', position:'sticky', top:0, zIndex:50 }}>
        <div style={{ fontFamily:'"Syne",sans-serif', fontSize:18, fontWeight:800, color:'#00e5a0', textShadow:'0 0 10px #00e5a040' }}>RANSOME</div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#ef4444', background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:6, padding:'3px 8px' }}>🔴 {BANKS[liveBank].name}</div>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#4a7fa5', background:'#0a1628', borderRadius:6, padding:'3px 8px' }}>👤 {nickname}</div>
        </div>
      </div>

      {/* Top panel: 3 columns — all alignItems:start so chat doesn't stretch */}
      <div style={{ padding:'10px 14px 0', display:'grid', gridTemplateColumns:'200px 1fr 230px', gap:10, alignItems:'start' }}>
        <GameStats devices={devices} calledNums={calledNums} bankruptCount={bankruptCount} liveBank={liveBank} nickname={nickname}/>
        <MatrixDisplay calledNums={calledNums} calledOrder={calledOrder} clickWindowOpen={clickWindowOpen}/>
        {/* Chat — fixed-height, won't grow */}
        <ChatTerminal nickname={nickname}/>
      </div>

      {/* Win strip */}
      <div style={{ margin:'8px 14px 0', padding:'5px 8px', display:'flex', gap:5, overflowX:'auto', borderRadius:10, background:'rgba(2,13,26,0.7)', border:'1px solid #0a1f3a' }}>
        {(Object.entries(WIN_LABELS) as [WinType,string][]).map(([type,label])=>{
          const st=winStates[type]
          return (
            <div key={type} style={{ display:'flex', gap:3, alignItems:'center', padding:'3px 7px', borderRadius:6, flexShrink:0,
              background:st.claimed?'rgba(34,197,94,0.08)':st.claimable?'rgba(236,72,153,0.08)':'transparent',
              border:st.claimed?'1px solid rgba(34,197,94,0.25)':st.claimable?'1px solid rgba(236,72,153,0.35)':'1px solid transparent' }}>
              <div style={{ width:7,height:5,borderRadius:1,background:LED_COLORS[type],opacity:st.claimed?0.4:1,boxShadow:st.claimable&&!st.claimed?`0 0 4px ${LED_COLORS[type]}`:'none' }}/>
              <div style={{ fontFamily:'"DM Mono",monospace', fontSize:7, color:st.claimed?'#22c55e':st.claimable?'#ec4899':'#1e4a6a', whiteSpace:'nowrap' }}>
                {st.claimed?'✓ ':st.claimable?'⚡ ':'○ '}{label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Hacking Devices — paginated, maximize toggle */}
      <div style={{ padding:'10px 14px 20px' }}>
        {/* Devices toolbar */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontFamily:'"DM Mono",monospace', fontSize:8, color:'#1e4a6a', letterSpacing:'0.1em' }}>
            ⬡ HACKING DEVICES &nbsp;
            <span style={{ color:'#2a5a7a' }}>{devices.length} total</span>
            {totalPages > 1 && <span style={{ color:'#1e4a6a' }}> · page {devicePage+1}/{totalPages}</span>}
          </div>
          <div style={{ display:'flex', gap:5, alignItems:'center' }}>
            {/* Prev page */}
            <button onClick={()=>setDevicePage(p=>Math.max(0,p-1))} disabled={devicePage===0}
              style={{ width:24,height:24,borderRadius:6,background:'#0a1628',border:'1px solid #1e3a5f',color:devicePage===0?'#1e3a5f':'#4a7fa5',cursor:devicePage===0?'default':'pointer',fontFamily:'"DM Mono",monospace',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center' }}>‹</button>
            {/* Next page */}
            <button onClick={()=>setDevicePage(p=>Math.min(totalPages-1,p+1))} disabled={devicePage>=totalPages-1}
              style={{ width:24,height:24,borderRadius:6,background:'#0a1628',border:'1px solid #1e3a5f',color:devicePage>=totalPages-1?'#1e3a5f':'#4a7fa5',cursor:devicePage>=totalPages-1?'default':'pointer',fontFamily:'"DM Mono",monospace',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center' }}>›</button>
            {/* Maximize */}
            <button onClick={()=>setDevicesExpanded(e=>!e)}
              style={{ background:'#0a1628',border:'1px solid #1e3a5f',color:'#2a5a7a',borderRadius:7,padding:'4px 10px',fontFamily:'"DM Mono",monospace',fontSize:7.5,cursor:'pointer' }}>
              {devicesExpanded ? '⊟ NORMAL' : '⊞ MAXIMIZE'}
            </button>
          </div>
        </div>

        {/* Device grid — 2 col normal, 5 col maximized */}
        <div style={{ display:'grid', gridTemplateColumns:devicesExpanded?'repeat(5,1fr)':'repeat(2,1fr)', gap:10 }}>
          {pageDevices.map(d=>(
            <HackingDevice key={d.id} device={d} currentNum={currentNum} clickWindowOpen={clickWindowOpen}
              onCellClick={handleCellClick} onClaim={handleClaim}
              winStates={winStates} bankruptCount={bankruptCount} timer={timer} totalTimer={totalTimer}/>
          ))}
        </div>

        {/* Page dots */}
        {totalPages > 1 && (
          <div style={{ display:'flex', justifyContent:'center', gap:6, marginTop:12 }}>
            {Array.from({length:totalPages},(_,i)=>(
              <button key={i} onClick={()=>setDevicePage(i)} style={{ width:8,height:8,borderRadius:'50%',border:'none',cursor:'pointer',padding:0,
                background:i===devicePage?'#00e5a0':'#1e3a5f',
                boxShadow:i===devicePage?'0 0 6px #00e5a0':'none' }}/>
            ))}
          </div>
        )}
      </div>

      {/* Announcement toast */}
      {announcement && (
        <div style={{ position:'fixed', top:52, left:'50%', transform:'translateX(-50%)', background:'#020d1a', border:'1px solid #00e5a040', borderRadius:10, padding:'9px 18px', fontFamily:'"DM Mono",monospace', fontSize:10, color:'#00e5a0', zIndex:999, whiteSpace:'nowrap', boxShadow:'0 8px 24px rgba(0,0,0,0.5)', animation:'slideDown 0.3s ease' }}>
          {announcement}
        </div>
      )}
    </div>
  )
}
