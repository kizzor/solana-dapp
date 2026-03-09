'use client'
import './globals.css'
import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────
type Cell = { num:number|null; matched:boolean; clicked:boolean }
type Device = { id:number; nftId:string; grid:Cell[][]; claimed:Set<string>; active:boolean; corrupted:boolean }
type WinType = 'EARLY_FIVE'|'TOP_LINE'|'MIDDLE_LINE'|'BOTTOM_LINE'|'FULL_HOUSE_1'|'FULL_HOUSE_2'|'FULL_HOUSE_3'
type WinState = { claimed:boolean; claimable:boolean; flickering:boolean; broken:boolean }
type ChatLine = { t:'sys'|'user'|'cmd'|'img'; m:string; src?:string }

// ─── Constants ────────────────────────────────────────────────────────────────
const WIN_LABELS:Record<WinType,string> = {
  EARLY_FIVE:'5 Digit Accounts Hacked', TOP_LINE:'Top Accounts Hacked',
  MIDDLE_LINE:'Central System Hacked', BOTTOM_LINE:'Basement Hacked',
  FULL_HOUSE_1:'Bankrupt Ransome I', FULL_HOUSE_2:'Bankrupt Ransome II', FULL_HOUSE_3:'Bankrupt Ransome III',
}
const LED_COLORS:Record<WinType,string> = {
  EARLY_FIVE:'#f59e0b', TOP_LINE:'#0ea5e9', MIDDLE_LINE:'#22c55e', BOTTOM_LINE:'#a16207',
  FULL_HOUSE_1:'#f472b6', FULL_HOUSE_2:'#ec4899', FULL_HOUSE_3:'#db2777',
}
// Progress thresholds: how many clicks needed to light each LED (out of 15 total)
const WIN_THRESHOLDS:Record<WinType,number> = {
  EARLY_FIVE:5, TOP_LINE:5, MIDDLE_LINE:5, BOTTOM_LINE:5, FULL_HOUSE_1:15, FULL_HOUSE_2:15, FULL_HOUSE_3:15,
}
const COL_HEADERS = ['1-10','11-20','21-30','31-40','41-50','51-60','61-70','71-80','81-90']
const COL_RANGES:[number,number][] = [[1,10],[11,20],[21,30],[31,40],[41,50],[51,60],[61,70],[71,80],[81,90]]
const CLAIM_WALLET = 'F6bbR6ro9W4nS6uBMmSLhsknhQ6NJR523DZXkRQnkFcx'

const HACK_CMDS = [
  'INIT PAYLOAD','BYPASS FIREWALL','SCAN PORT 8443','BRUTE SHA-256','DECRYPT TLS',
  'EXPLOIT CVE-2024','INJECT SQL','PIVOT SUBNET','EXFIL VAULT','SPOOF MAC',
  'ARP POISON','DUMP LSASS','ESCALATE PRIV','DEPLOY ROOTKIT','TUNNEL SSH',
  'SNIFF ETH0','CRACK WPA2','OVERFLOW STACK','UPLOAD PAYLOAD','COVER TRACKS',
  'ENUM SHARES','MAP NETWORK','BYPASS 2FA','FORGE JWT','EXFIL DB',
  'PIVOT VPN','DEPLOY METERP','RCE SHELL','PERSIST CRON','WIPE LOGS',
]
const HACK_STATUSES = ['[OK]','[ACK]','[ERR]','[WARN]','[DONE]','[LIVE]','[XMIT]','[RCVD]']

const BANKS = [
  {id:0, name:'Pacific Reserve',   city:'Auckland',      tz:12,  x:88,y:72, region:'APAC'},
  {id:1, name:'Sakura Central',    city:'Tokyo',         tz:9,   x:80,y:30, region:'APAC'},
  {id:2, name:'Dragon Vault',      city:'Shanghai',      tz:8,   x:76,y:34, region:'APAC'},
  {id:3, name:'Tiger Bank',        city:'Singapore',     tz:8,   x:74,y:53, region:'APAC'},
  {id:4, name:'Indus Capital',     city:'Mumbai',        tz:5.5, x:65,y:40, region:'ASIA'},
  {id:5, name:'Gulf Reserve',      city:'Dubai',         tz:4,   x:61,y:39, region:'MENA'},
  {id:6, name:'Nile Treasury',     city:'Cairo',         tz:2,   x:53,y:36, region:'MENA'},
  {id:7, name:'Savanna Vault',     city:'Nairobi',       tz:3,   x:56,y:57, region:'AFR'},
  {id:8, name:'Cape Reserve',      city:'Cape Town',     tz:2,   x:52,y:74, region:'AFR'},
  {id:9, name:'Colosseum Bank',    city:'Rome',          tz:1,   x:49,y:28, region:'EUR'},
  {id:10,name:'Rhine Vault',       city:'Frankfurt',     tz:1,   x:49,y:22, region:'EUR'},
  {id:11,name:'Thames Capital',    city:'London',        tz:0,   x:46,y:22, region:'EUR'},
  {id:12,name:'Nordic Reserve',    city:'Oslo',          tz:1,   x:49,y:16, region:'EUR'},
  {id:13,name:'Kremlin Bank',      city:'Moscow',        tz:3,   x:57,y:19, region:'EUR'},
  {id:14,name:'Atlas Treasury',    city:'Casablanca',    tz:1,   x:44,y:34, region:'AFR'},
  {id:15,name:'Amazon Reserve',    city:'São Paulo',     tz:-3,  x:32,y:67, region:'AMER'},
  {id:16,name:'Andes Vault',       city:'Bogotá',        tz:-5,  x:25,y:54, region:'AMER'},
  {id:17,name:'Manhattan Capital', city:'New York',      tz:-5,  x:22,y:28, region:'AMER'},
  {id:18,name:'Silicon Reserve',   city:'San Francisco', tz:-8,  x:10,y:31, region:'AMER'},
  {id:19,name:'Maple Treasury',    city:'Toronto',       tz:-5,  x:21,y:24, region:'AMER'},
  {id:20,name:'Red Sea Bank',      city:'Riyadh',        tz:3,   x:58,y:39, region:'MENA'},
  {id:21,name:'Carnival Bank',     city:'Rio',           tz:-3,  x:33,y:68, region:'AMER'},
  {id:22,name:'Azores Vault',      city:'Lisbon',        tz:0,   x:44,y:28, region:'EUR'},
]

const defaultWinStates = ():Record<WinType,WinState> => ({
  EARLY_FIVE:{claimed:false,claimable:false,flickering:false,broken:false},
  TOP_LINE:{claimed:false,claimable:false,flickering:false,broken:false},
  MIDDLE_LINE:{claimed:false,claimable:false,flickering:false,broken:false},
  BOTTOM_LINE:{claimed:false,claimable:false,flickering:false,broken:false},
  FULL_HOUSE_1:{claimed:false,claimable:false,flickering:false,broken:false},
  FULL_HOUSE_2:{claimed:false,claimable:false,flickering:false,broken:false},
  FULL_HOUSE_3:{claimed:false,claimable:false,flickering:false,broken:false},
})

function getLiveBank(h:number){return h%23}

// ─── Ticket Generator ─────────────────────────────────────────────────────────
function generateDevice(id:number):Device {
  const nftId=`RNSM-${String(id).padStart(4,'0')}`
  const colCounts=Array(9).fill(1)
  Array.from({length:9},(_,i)=>i).sort(()=>Math.random()-0.5).slice(0,6).forEach(i=>colCounts[i]++)
  const colRows:number[][]=colCounts.map(cnt=>[0,1,2].sort(()=>Math.random()-0.5).slice(0,cnt))
  const rowCounts=[0,0,0]; colRows.forEach(rows=>rows.forEach(r=>rowCounts[r]++))
  let attempts=0
  while((rowCounts[0]!==5||rowCounts[1]!==5||rowCounts[2]!==5)&&attempts<200){
    attempts++; colCounts.fill(1)
    Array.from({length:9},(_,i)=>i).sort(()=>Math.random()-0.5).slice(0,6).forEach(i=>colCounts[i]++)
    colRows.splice(0,9,...colCounts.map(cnt=>[0,1,2].sort(()=>Math.random()-0.5).slice(0,cnt)))
    rowCounts.fill(0); colRows.forEach(rows=>rows.forEach(r=>rowCounts[r]++))
  }
  const usedNums=new Set<number>()
  const grid:Cell[][]=Array.from({length:3},()=>Array(9).fill(null).map(()=>({num:null,matched:false,clicked:false})))
  for(let ci=0;ci<9;ci++){
    const [lo,hi]=COL_RANGES[ci]; const rows=colRows[ci].sort((a,b)=>a-b)
    const available:number[]=[]
    for(let n=lo;n<=hi;n++) if(!usedNums.has(n)) available.push(n)
    const picked=available.sort(()=>Math.random()-0.5).slice(0,rows.length).sort((a,b)=>a-b)
    picked.forEach(n=>usedNums.add(n))
    rows.forEach((r,i)=>{grid[r][ci]={num:picked[i],matched:false,clicked:false}})
  }
  return {id,nftId,grid,claimed:new Set(),active:false,corrupted:false}
}

function generateDemoDevice(id:number):Device {
  const d=generateDevice(id); d.active=true; return d
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function useHourCountdown(){
  const get=()=>{const now=new Date();const s=now.getUTCMinutes()*60+now.getUTCSeconds();const left=3600-s-300;return left>0?left:0}
  const [s,setS]=useState(get)
  useEffect(()=>{const t=setInterval(()=>setS(get()),1000);return()=>clearInterval(t)},[])
  return s
}
function fmtTime(s:number){const m=Math.floor(s/60),ss=s%60;return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`}

// ─── Mini Stopwatch ───────────────────────────────────────────────────────────
function MiniStopwatch({seconds,total}:{seconds:number;total:number}){
  const danger=seconds<=10,r=14,circ=2*Math.PI*r,dash=circ*(seconds/total)
  return(
    <div style={{position:'relative',width:40,height:40,flexShrink:0}}>
      <svg width="40" height="40" style={{transform:'rotate(-90deg)'}}>
        <circle cx="20" cy="20" r={r} fill="none" stroke="#0a1628" strokeWidth="3"/>
        <circle cx="20" cy="20" r={r} fill="none" stroke={danger?'#ef4444':'#00e5a0'} strokeWidth="3"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{transition:'stroke-dasharray 0.9s linear,stroke 0.3s'}}/>
      </svg>
      <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{fontFamily:'"DM Mono",monospace',fontSize:9,fontWeight:700,color:danger?'#ef4444':'#00e5a0',textShadow:danger?'0 0 6px #ef4444':'0 0 6px #00e5a0'}}>{String(seconds%60).padStart(2,'0')}</div>
      </div>
    </div>
  )
}

// ─── World Map (Lobby) — large, with bank status table ───────────────────────
function LobbyWorldMap({selectedBank,onSelect,currentHour,hoveredBank,onHover}:{
  selectedBank:number|null;onSelect:(id:number)=>void;currentHour:number;hoveredBank:number|null;onHover:(id:number|null)=>void
}){
  const live=getLiveBank(currentHour)
  const hourCountdown=useHourCountdown()
  const regionColors:{[k:string]:string}={APAC:'#0ea5e9',EUR:'#22c55e',AMER:'#f59e0b',MENA:'#f97316',AFR:'#a855f7',ASIA:'#ec4899'}
  return(
    <div>
      {/* Full-width SVG map */}
      <div style={{position:'relative',width:'100%',paddingTop:'42%',borderRadius:14,overflow:'hidden',background:'#020d1a',border:'1px solid #0a2535',boxShadow:'inset 0 0 40px rgba(0,229,160,0.03)'}}>
        <div style={{position:'absolute',inset:0}}>
          <svg viewBox="0 0 100 100" style={{width:'100%',height:'100%'}}>
            {/* Grid lines */}
            {Array.from({length:13},(_,i)=><line key={`v${i}`} x1={i*100/12} y1="0" x2={i*100/12} y2="100" stroke="#0a1628" strokeWidth="0.2"/>)}
            {Array.from({length:7},(_,i)=><line key={`h${i}`} x1="0" y1={i*100/6} x2="100" y2={i*100/6} stroke="#0a1628" strokeWidth="0.2"/>)}
            {/* Continents */}
            <ellipse cx="18" cy="28" rx="12" ry="14" fill="#0d1f3a" stroke="#1e3a5f" strokeWidth="0.3"/>
            <ellipse cx="28" cy="63" rx="7" ry="13" fill="#0d1f3a" stroke="#1e3a5f" strokeWidth="0.3"/>
            <ellipse cx="49" cy="23" rx="6" ry="8" fill="#0d1f3a" stroke="#1e3a5f" strokeWidth="0.3"/>
            <ellipse cx="50" cy="53" rx="7" ry="16" fill="#0d1f3a" stroke="#1e3a5f" strokeWidth="0.3"/>
            <ellipse cx="70" cy="29" rx="18" ry="14" fill="#0d1f3a" stroke="#1e3a5f" strokeWidth="0.3"/>
            <ellipse cx="82" cy="65" rx="7" ry="6" fill="#0d1f3a" stroke="#1e3a5f" strokeWidth="0.3"/>
            {/* Connection lines between banks */}
            {BANKS.filter(b=>b.id!==live).slice(0,8).map(b=>(
              <line key={`cl${b.id}`} x1={BANKS[live].x} y1={BANKS[live].y} x2={b.x} y2={b.y}
                stroke="#00e5a008" strokeWidth="0.3" strokeDasharray="1,2"/>
            ))}
            {/* Bank dots */}
            {BANKS.map(b=>{
              const isLive=b.id===live,isSel=b.id===selectedBank,isHov=b.id===hoveredBank
              const rc=regionColors[b.region]||'#1e3a5f'
              return(
                <g key={b.id} onClick={()=>onSelect(b.id)} onMouseEnter={()=>onHover(b.id)} onMouseLeave={()=>onHover(null)} style={{cursor:'pointer'}}>
                  {isLive&&<circle cx={b.x} cy={b.y} r="5" fill={`${rc}18`}><animate attributeName="r" values="3;6;3" dur="1.8s" repeatCount="indefinite"/></circle>}
                  {isLive&&<circle cx={b.x} cy={b.y} r="3" fill={`${rc}30`}><animate attributeName="r" values="2;4;2" dur="1.8s" begin="0.3s" repeatCount="indefinite"/></circle>}
                  <circle cx={b.x} cy={b.y} r={isLive?2.4:isSel||isHov?2:1.3}
                    fill={isLive?rc:isSel||isHov?'#00e5a0':'#1e4a6a'}
                    stroke={isLive?'#fff':isSel||isHov?'#6ee7b7':'#2a5a7a'} strokeWidth="0.3"/>
                  {(isSel||isLive||isHov)&&(
                    <text x={b.x} y={b.y-4} textAnchor="middle" fontSize="2.8" fill={isLive?rc:'#00e5a0'} fontWeight="bold">{b.city}</text>
                  )}
                  {isHov&&!isLive&&(
                    <text x={b.x} y={b.y+5.5} textAnchor="middle" fontSize="2.2" fill="#2a5a7a">{b.name}</text>
                  )}
                </g>
              )
            })}
            {/* Live label */}
            <text x={BANKS[live].x} y={BANKS[live].y+5.5} textAnchor="middle" fontSize="2.5" fill="#ef4444">🔴 LIVE</text>
          </svg>
        </div>
      </div>

      {/* Bank status table — compact rows */}
      <div style={{marginTop:10,background:'#020d1a',border:'1px solid #0a2535',borderRadius:10,overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr auto auto auto',padding:'4px 10px',background:'#030a12',borderBottom:'1px solid #0a2535'}}>
          {['BANK','REGION','TZ','STATUS'].map(h=>(
            <div key={h} style={{fontFamily:'"DM Mono",monospace',fontSize:6.5,color:'#1e4a6a',letterSpacing:'0.1em'}}>{h}</div>
          ))}
        </div>
        <div style={{maxHeight:140,overflowY:'auto'}}>
          {BANKS.map(b=>{
            const isLive=b.id===live,isHov=b.id===hoveredBank,isSel=b.id===selectedBank
            const rc=regionColors[b.region]||'#1e3a5f'
            return(
              <div key={b.id} onClick={()=>onSelect(b.id)} onMouseEnter={()=>onHover(b.id)} onMouseLeave={()=>onHover(null)}
                style={{display:'grid',gridTemplateColumns:'1fr auto auto auto',padding:'3px 10px',cursor:'pointer',
                  background:isHov||isSel?'rgba(0,229,160,0.04)':'transparent',
                  borderBottom:'1px solid #0a1628',transition:'background 0.1s'}}>
                <div style={{display:'flex',alignItems:'center',gap:5}}>
                  <div style={{width:5,height:5,borderRadius:'50%',background:isLive?'#ef4444':'#1e4a6a',boxShadow:isLive?'0 0 5px #ef4444':'none',animation:isLive?'dot 1.5s infinite':'none',flexShrink:0}}/>
                  <div style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:isLive?'#ef4444':isHov||isSel?'#00e5a0':'#2a5a7a',fontWeight:isLive?700:400}}>{b.name}</div>
                </div>
                <div style={{fontFamily:'"DM Mono",monospace',fontSize:6.5,color:rc}}>{b.region}</div>
                <div style={{fontFamily:'"DM Mono",monospace',fontSize:6.5,color:'#1e4a6a'}}>UTC{b.tz>=0?'+':''}{b.tz}</div>
                <div style={{fontFamily:'"DM Mono",monospace',fontSize:6.5,color:isLive?'#22c55e':'#1e4a6a'}}>
                  {isLive?`LIVE ${fmtTime(hourCountdown)}`:'CLOSED'}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Demo Hack Modal ──────────────────────────────────────────────────────────
function DemoHackModal({onClose}:{onClose:()=>void}){
  const [step,setStep]=useState(0)
  const [demoNum,setDemoNum]=useState<number|null>(null)
  const [localDevice,setLocalDevice]=useState(()=>generateDemoDevice(999))
  const [winMsg,setWinMsg]=useState('')
  const [called,setCalled]=useState<number[]>([])
  useEffect(()=>{
    const steps=[15,22,38,4,71,55,43,89,17,31,66,12,48,77,26]
    let i=0
    const t=setInterval(()=>{
      if(i>=steps.length){clearInterval(t);return}
      const num=steps[i]; setDemoNum(num); setCalled(p=>[...p,num])
      setLocalDevice(prev=>{
        const nd={...prev,grid:prev.grid.map(row=>row.map(cell=>cell.num===num?{...cell,matched:true,clicked:true}:cell))}
        const flat=nd.grid.flat(),clicked=flat.filter(c=>c.clicked).length
        if(clicked===5) setWinMsg('⚡ EARLY FIVE — 5 accounts hacked!')
        if(nd.grid[0].filter(c=>c.num).every(c=>c.clicked)) setWinMsg('🔵 TOP LINE — Row 1 fully hacked!')
        if(nd.grid[1].filter(c=>c.num).every(c=>c.clicked)) setWinMsg('🟢 MIDDLE LINE — Row 2 fully hacked!')
        if(nd.grid[2].filter(c=>c.num).every(c=>c.clicked)) setWinMsg('🟡 BOTTOM LINE — Row 3 fully hacked!')
        if(flat.filter(c=>c.num).every(c=>c.clicked)) setWinMsg('🔥 FULL HOUSE — ALL 15 MATCHED!')
        return nd
      })
      setStep(i+1); i++
    },900)
    return()=>clearInterval(t)
  },[])
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(1,8,16,0.92)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(8px)'}}>
      <div style={{background:'#020d1a',border:'1px solid #0a3a5a',borderRadius:20,padding:24,maxWidth:500,width:'95%',boxShadow:'0 0 60px rgba(0,229,160,0.1)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div>
            <div style={{fontFamily:'"Syne",sans-serif',fontSize:16,fontWeight:800,color:'#00e5a0'}}>DEMO HACK — HOW TO PLAY</div>
            <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#2a5a7a',marginTop:2}}>Watch live gameplay walkthrough</div>
          </div>
          <button onClick={onClose} style={{background:'#0a1628',border:'1px solid #1e3a5f',color:'#4a7fa5',borderRadius:8,width:28,height:28,cursor:'pointer',fontSize:14}}>×</button>
        </div>
        <div style={{background:'#030a12',border:'1px solid #0d2035',borderRadius:10,padding:'10px 14px',marginBottom:12,display:'flex',alignItems:'center',gap:14}}>
          <div>
            <div style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:'#1e4a6a',marginBottom:2}}>BANK BROADCASTS</div>
            <div style={{fontFamily:'"Syne",sans-serif',fontSize:48,fontWeight:800,color:'#fff',lineHeight:1,
              textShadow:'0 0 20px #fff,0 0 40px rgba(255,255,255,0.6)',animation:'numAppear 0.4s cubic-bezier(.34,1.56,.64,1)'}}>{demoNum??'—'}</div>
          </div>
          <div style={{flex:1}}>
            <div style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:'#1e4a6a',marginBottom:4}}>NUMBERS CALLED ({step}/15)</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
              {called.map((n,i)=><div key={i} style={{width:20,height:20,borderRadius:3,display:'flex',alignItems:'center',justifyContent:'center',background:'#0a2535',border:'1px solid #1e3a5f',fontFamily:'"DM Mono",monospace',fontSize:8,color:'#2a5a7a'}}>{n}</div>)}
            </div>
          </div>
        </div>
        <div style={{background:'#020a14',border:'1px solid #0d2035',borderRadius:8,overflow:'hidden',marginBottom:12}}>
          <div style={{background:'#030a12',padding:'4px 8px',display:'flex',justifyContent:'space-between',borderBottom:'1px solid #0d2035'}}>
            <div style={{display:'flex',alignItems:'center',gap:5}}>
              <div style={{width:10,height:10,background:'linear-gradient(135deg,#00e5a0,#00b8ff)',clipPath:'polygon(50% 0%,100% 50%,50% 100%,0% 50%)'}}/>
              <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#00e5a0'}}>RNSM-DEMO</div>
            </div>
            <div style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:'#2a5a7a'}}>{localDevice.grid.flat().filter(c=>c.clicked).length}/15</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(9,1fr)',borderBottom:'1px solid #0d2035'}}>
            {COL_HEADERS.map((h,i)=><div key={i} style={{padding:'2px 0',textAlign:'center',fontFamily:'"DM Mono",monospace',fontSize:5.5,color:'#1e3a5f',borderRight:i<8?'1px solid #0d2035':'none',background:'#030a12'}}>{h}</div>)}
          </div>
          {localDevice.grid.map((row,ri)=>(
            <div key={ri} style={{display:'grid',gridTemplateColumns:'repeat(9,1fr)',borderBottom:ri<2?'1px solid #0d2035':'none'}}>
              {row.map((cell,ci)=>(
                <div key={ci} style={{height:24,display:'flex',alignItems:'center',justifyContent:'center',borderRight:ci<8?'1px solid #0d2035':'none',
                  background:cell.clicked?'rgba(255,255,255,0.08)':'transparent',
                  fontFamily:'"DM Mono",monospace',fontSize:10,fontWeight:700,
                  color:!cell.num?'transparent':cell.clicked?'#ffffff':'#2a5a7a',
                  textShadow:cell.clicked?'0 0 8px #fff,0 0 20px rgba(255,255,255,0.8),0 0 40px rgba(255,255,255,0.4)':'none',
                  transition:'all 0.3s'}}>{cell.num??''}</div>
              ))}
            </div>
          ))}
        </div>
        {winMsg&&<div style={{background:'rgba(0,229,160,0.08)',border:'1px solid rgba(0,229,160,0.3)',borderRadius:8,padding:'8px 12px',marginBottom:10,fontFamily:'"DM Mono",monospace',fontSize:10,color:'#00e5a0',animation:'slideDown 0.3s ease'}}>{winMsg}</div>}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:4}}>
          {[['⚡','Early Five','First 5 clicked'],['🔵','Top Line','All Row 1'],['🟢','Middle Line','All Row 2'],['🟡','Bottom Line','All Row 3'],['🔥','Full House','All 15 matched']].map(([icon,label,desc])=>(
            <div key={label} style={{display:'flex',gap:6,alignItems:'flex-start',padding:'4px 0'}}>
              <div style={{fontSize:10,flexShrink:0}}>{icon}</div>
              <div><div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#4a7fa5',fontWeight:700}}>{label}</div>
              <div style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:'#1e4a6a'}}>{desc}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── LED with progress bar ────────────────────────────────────────────────────
function LedWithProgress({type,winState,device,devices,winStates}:{
  type:WinType; winState:WinState; device?:Device; devices?:Device[]; winStates?:Record<WinType,WinState>
}){
  const color=LED_COLORS[type]
  const won=device?device.claimed.has(type):false
  const lit=winState.claimable&&!winState.claimed
  const dead=winState.claimed&&!won
  const flicker=winState.flickering
  const broken=winState.broken

  // Calculate progress: best progress across all active devices toward this win type
  let progress=0
  if(devices&&winStates){
    devices.filter(d=>d.active).forEach(d=>{
      const flat=d.grid.flat()
      const clicked=flat.filter(c=>c.clicked).length
      let p=0
      if(type==='EARLY_FIVE') p=Math.min(clicked/5,1)
      else if(type==='TOP_LINE') p=d.grid[0].filter(c=>c.num&&c.clicked).length/Math.max(d.grid[0].filter(c=>c.num).length,1)
      else if(type==='MIDDLE_LINE') p=d.grid[1].filter(c=>c.num&&c.clicked).length/Math.max(d.grid[1].filter(c=>c.num).length,1)
      else if(type==='BOTTOM_LINE') p=d.grid[2].filter(c=>c.num&&c.clicked).length/Math.max(d.grid[2].filter(c=>c.num).length,1)
      else p=Math.min(clicked/15,1)
      if(p>progress) progress=p
    })
  }

  return(
    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:5}}>
      {/* LED dot */}
      <div style={{
        width:10,height:10,borderRadius:2,flexShrink:0,
        background: broken ? 'transparent'
          : (won||lit) ? color : dead ? '#050d17' : '#0a1628',
        border: broken ? `1px solid ${color}40`
          : `1px solid ${(won||lit)?color:'#162438'}`,
        boxShadow: broken ? `inset 0 0 3px ${color}60`
          : (won||lit) ? `0 0 5px ${color},0 0 10px ${color}60` : 'none',
        opacity: dead&&!flicker&&!broken ? 0.25 : 1,
        animation: broken ? 'none'
          : flicker ? 'rapidFlicker 0.08s infinite'
          : lit&&!won ? `ledBlink 0.5s infinite` : 'none',
        position:'relative',overflow:'hidden',
      }}>
        {/* Broken filament glow inside */}
        {broken&&<div style={{position:'absolute',inset:0,background:`radial-gradient(circle,${color}60 0%,transparent 70%)`,animation:'filamentGlow 2s infinite'}}/>}
      </div>
      <div style={{flex:1}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:won?'#22c55e':lit?color:broken?`${color}60`:'#2a5a7a',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:90}}>{WIN_LABELS[type]}</div>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:6,color:'#1e4a6a'}}>{Math.round(progress*100)}%</div>
        </div>
        {/* Progress bar */}
        <div style={{height:3,background:'#0a1628',borderRadius:2,overflow:'hidden',border:'1px solid #0d2035'}}>
          <div style={{height:'100%',width:`${progress*100}%`,borderRadius:2,
            background: progress>=1 ? color : `linear-gradient(90deg,${color}60,${color})`,
            boxShadow: progress>=1 ? `0 0 6px ${color}` : 'none',
            transition:'width 0.5s ease',
          }}/>
        </div>
      </div>
    </div>
  )
}

// ─── Hacking Device ───────────────────────────────────────────────────────────
function HackingDevice({device,currentNum,clickWindowOpen,calledNums,onCellClick,onClaim,onActivate,winStates,bankruptCount,timer,totalTimer,liveBank}:{
  device:Device;currentNum:number|null;clickWindowOpen:boolean;calledNums:Set<number>;
  onCellClick:(id:number,r:number,c:number)=>void;onClaim:(id:number,w:WinType)=>void;
  onActivate:(id:number)=>void;winStates:Record<WinType,WinState>;bankruptCount:number;
  timer:number;totalTimer:number;liveBank:number
}){
  const flat=device.grid.flat()
  const clickedN=flat.filter(c=>c.clicked).length
  const row0Done=device.grid[0].filter(c=>c.num).every(c=>c.clicked)
  const row1Done=device.grid[1].filter(c=>c.num).every(c=>c.clicked)
  const row2Done=device.grid[2].filter(c=>c.num).every(c=>c.clicked)
  const allDone=flat.filter(c=>c.num).every(c=>c.clicked)
  const fhKey=`FULL_HOUSE_${Math.min(bankruptCount+1,3)}` as WinType

  const canClaim=(
    (clickedN>=5&&!device.claimed.has('EARLY_FIVE')&&winStates.EARLY_FIVE.claimable&&!winStates.EARLY_FIVE.claimed)||
    (row0Done&&!device.claimed.has('TOP_LINE')&&winStates.TOP_LINE.claimable&&!winStates.TOP_LINE.claimed)||
    (row1Done&&!device.claimed.has('MIDDLE_LINE')&&winStates.MIDDLE_LINE.claimable&&!winStates.MIDDLE_LINE.claimed)||
    (row2Done&&!device.claimed.has('BOTTOM_LINE')&&winStates.BOTTOM_LINE.claimable&&!winStates.BOTTOM_LINE.claimed)||
    (allDone&&winStates[fhKey]?.claimable&&!winStates[fhKey]?.claimed&&!device.claimed.has(fhKey))
  )
  const doClaim=()=>{
    if(clickedN>=5&&!device.claimed.has('EARLY_FIVE')&&winStates.EARLY_FIVE.claimable&&!winStates.EARLY_FIVE.claimed){onClaim(device.id,'EARLY_FIVE');return}
    if(row0Done&&!device.claimed.has('TOP_LINE')&&winStates.TOP_LINE.claimable&&!winStates.TOP_LINE.claimed){onClaim(device.id,'TOP_LINE');return}
    if(row1Done&&!device.claimed.has('MIDDLE_LINE')&&winStates.MIDDLE_LINE.claimable&&!winStates.MIDDLE_LINE.claimed){onClaim(device.id,'MIDDLE_LINE');return}
    if(row2Done&&!device.claimed.has('BOTTOM_LINE')&&winStates.BOTTOM_LINE.claimable&&!winStates.BOTTOM_LINE.claimed){onClaim(device.id,'BOTTOM_LINE');return}
    if(allDone&&winStates[fhKey]?.claimable) onClaim(device.id,fhKey)
  }
  const LED_TYPES:WinType[]=['EARLY_FIVE','TOP_LINE','MIDDLE_LINE','BOTTOM_LINE','FULL_HOUSE_1','FULL_HOUSE_2','FULL_HOUSE_3']

  return(
    <div style={{background:'linear-gradient(180deg,#0d1a2e,#060e1a)',border:`2px solid ${canClaim?'#ec4899':device.active?'#00e5a030':'#162438'}`,borderRadius:14,padding:0,
      boxShadow:canClaim?'0 0 0 2px rgba(236,72,153,0.3),0 6px 24px rgba(236,72,153,0.15)':device.active?'0 0 10px rgba(0,229,160,0.06)':'0 4px 16px rgba(0,0,0,0.6)',
      display:'flex',flexDirection:'column',overflow:'hidden',userSelect:'none'}}>

      {/* NFT Header + Ad space */}
      <div style={{background:'linear-gradient(90deg,#0a1628,#0d1f3a)',padding:'4px 7px',borderBottom:'1px solid #0d1f3a',display:'flex',justifyContent:'space-between',alignItems:'center',gap:6}}>
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <div style={{width:12,height:12,background:'linear-gradient(135deg,#00e5a0,#00b8ff)',clipPath:'polygon(50% 0%,100% 50%,50% 100%,0% 50%)',flexShrink:0}}/>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:7.5,fontWeight:700,color:'#00e5a0'}}>{device.nftId}</div>
        </div>
        {/* Ad space behind NFT ID */}
        <div style={{flex:1,height:16,background:'rgba(0,229,160,0.03)',border:'1px dashed #0a2535',borderRadius:3,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',margin:'0 4px'}}>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:5.5,color:'#0a2535',letterSpacing:'0.1em'}}>AD SPACE · RANSOME.IO</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:3}}>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:6.5,color:'#1e4a6a'}}>{clickedN}/15</div>
          <div style={{width:5,height:5,borderRadius:'50%',background:device.active?'#22c55e':'#1e3a5f',boxShadow:device.active?'0 0 5px #22c55e':'none',animation:device.active?'dot 1.5s infinite':'none'}}/>
        </div>
      </div>

      {/* Mini Bank Display */}
      {device.active&&(
        <div style={{background:'#030a12',margin:'4px 5px 0',borderRadius:5,border:'1px solid #0d2035',padding:'3px 5px',display:'flex',alignItems:'center',gap:5,position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',inset:0,backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.1) 2px,rgba(0,0,0,0.1) 4px)',pointerEvents:'none'}}/>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:5.5,color:'#1e4a6a',flexShrink:0,position:'relative',zIndex:1}}>BANK</div>
          <div style={{fontFamily:'"Syne",sans-serif',fontSize:18,fontWeight:800,lineHeight:1,position:'relative',zIndex:1,
            color:currentNum?'#fff':'#1e3a5f',textShadow:currentNum?'0 0 8px #fff,0 0 16px rgba(255,255,255,0.6)':'none'}}>
            {currentNum??'—'}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:1,position:'relative',zIndex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:2}}>
              <div style={{width:3,height:3,borderRadius:'50%',background:clickWindowOpen?'#22c55e':'#ef4444',animation:clickWindowOpen?'dot 1s infinite':'none'}}/>
              <div style={{fontFamily:'"DM Mono",monospace',fontSize:5.5,color:clickWindowOpen?'#22c55e':'#ef4444'}}>{clickWindowOpen?'OPEN':'CLOSED'}</div>
            </div>
            <div style={{fontFamily:'"DM Mono",monospace',fontSize:5.5,color:'#1e4a6a'}}>{BANKS[liveBank]?.name?.split(' ')[0]??''}</div>
          </div>
          <div style={{marginLeft:'auto',display:'flex',gap:2,position:'relative',zIndex:1}}>
            {Array.from(calledNums).slice(-3).reverse().map((n,i)=>(
              <div key={i} style={{width:13,height:13,borderRadius:2,display:'flex',alignItems:'center',justifyContent:'center',background:'#0a1628',border:'1px solid #1e3a5f',fontFamily:'"DM Mono",monospace',fontSize:6.5,color:'#2a5a7a',opacity:1-i*0.25}}>{n}</div>
            ))}
          </div>
        </div>
      )}

      {/* Activate button */}
      {!device.active&&(
        <div style={{margin:'4px 5px 0',background:'#030a12',border:'1px solid #0d2035',borderRadius:5,padding:'5px 7px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:5}}>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:6.5,color:'#1e4a6a',lineHeight:1.4}}>NFT DEVICE<br/><span style={{color:'#2a5a7a'}}>Disconnected</span></div>
          <button onClick={()=>onActivate(device.id)} style={{background:'linear-gradient(135deg,#00e5a0,#00b8ff)',color:'#000',border:'none',borderRadius:5,padding:'4px 8px',fontFamily:'"DM Mono",monospace',fontSize:7.5,fontWeight:700,cursor:'pointer'}}>ACTIVATE ⚡</button>
        </div>
      )}

      {/* Ticket Grid — white neon numbers */}
      <div style={{margin:'4px 5px 0',background:'#020a14',border:'1px solid #0d2035',borderRadius:5,overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(9,1fr)',borderBottom:'1px solid #0d2035'}}>
          {COL_HEADERS.map((h,i)=><div key={i} style={{padding:'2px 0',textAlign:'center',fontFamily:'"DM Mono",monospace',fontSize:5,color:'#1e3a5f',borderRight:i<8?'1px solid #0d2035':'none',background:'#030a12'}}>{h}</div>)}
        </div>
        {device.grid.map((row,ri)=>(
          <div key={ri} style={{display:'grid',gridTemplateColumns:'repeat(9,1fr)',borderBottom:ri<2?'1px solid #0d2035':'none'}}>
            {row.map((cell,ci)=>{
              const isCurrentNum=cell.num!==null&&cell.num===currentNum
              const isClickable=isCurrentNum&&clickWindowOpen&&!cell.clicked&&device.active
              const isClicked=cell.clicked
              const isEmpty=cell.num===null
              const glitchAnim=`gx${(ri*9+ci)%3} ${2+((ri*9+ci)%2)}s ${(ri*9+ci)*0.08}s infinite`
              return(
                <button key={ci} onClick={()=>isClickable&&onCellClick(device.id,ri,ci)} style={{
                  height:22,padding:0,cursor:isClickable?'pointer':'default',border:'none',
                  borderRight:ci<8?'1px solid #0d2035':'none',
                  background:isEmpty?'#020a14':isClicked?'rgba(255,255,255,0.08)':isClickable?'rgba(255,255,255,0.05)':'transparent',
                  boxShadow:isClickable?'inset 0 0 0 2px rgba(255,255,255,0.8),0 0 6px rgba(255,255,255,0.4)':'none',
                  color:isEmpty?'transparent':'#ffffff',
                  fontFamily:'"DM Mono",monospace',fontSize:9,fontWeight:700,
                  textShadow:isEmpty?'none':isClicked?'0 0 6px #fff,0 0 12px rgba(255,255,255,0.9),0 0 24px rgba(255,255,255,0.5)':isClickable?'0 0 10px #fff,0 0 20px #fff':'0 0 3px rgba(255,255,255,0.4)',
                  opacity:isEmpty?0:isClicked?1:isClickable?1:0.5,
                  animation:(!isEmpty&&!isClickable&&!isClicked)?glitchAnim:'none',
                  transition:'opacity 0.2s,text-shadow 0.2s',
                }}>{cell.num??''}</button>
              )
            })}
          </div>
        ))}
      </div>

      {/* LED strip — with flicker/broken states */}
      <div style={{display:'flex',justifyContent:'center',gap:3,padding:'4px 5px 2px',alignItems:'center'}}>
        <div style={{display:'flex',gap:2}}>{[0,1].map(i=><div key={i} style={{width:7,height:5,borderRadius:1,background:'#0a1628',border:'1px solid #162438'}}/>)}</div>
        {LED_TYPES.map((type,i)=>{
          const st=winStates[type],won=device.claimed.has(type),lit=st.claimable&&!st.claimed,dead=st.claimed&&!won,flicker=st.flickering,broken=st.broken
          return(
            <div key={type} title={WIN_LABELS[type]} style={{
              width:10,height:8,borderRadius:2,position:'relative',overflow:'hidden',
              background:broken?'transparent':(won||lit)?LED_COLORS[type]:dead?'#050d17':'#0a1628',
              border:`1px solid ${broken?`${LED_COLORS[type]}40`:(won||lit)?LED_COLORS[type]:'#162438'}`,
              boxShadow:(won||lit)&&!broken?`0 0 4px ${LED_COLORS[type]},0 0 8px ${LED_COLORS[type]}60`:'none',
              opacity:dead&&!flicker&&!broken?0.2:1,
              animation:broken?'none':flicker?'rapidFlicker 0.08s infinite':lit&&!won?`ledBlink 0.5s ${i*0.07}s infinite`:'none',
            }}>
              {broken&&<div style={{position:'absolute',inset:0,background:`radial-gradient(circle,${LED_COLORS[type]}50 20%,transparent 70%)`,animation:'filamentGlow 2s ease-in-out infinite'}}/>}
            </div>
          )
        })}
        <div style={{display:'flex',gap:2}}>{[0,1,2,3].map(i=><div key={i} style={{width:7,height:5,borderRadius:1,background:'#0a1628',border:'1px solid #162438'}}/>)}</div>
      </div>

      {/* Bottom bar — compact */}
      <div style={{display:'flex',gap:4,alignItems:'center',padding:'2px 6px 6px'}}>
        <div style={{display:'flex',flexDirection:'column',gap:2}}>
          <div style={{width:8,height:8,borderRadius:2,background:'#ef4444',boxShadow:'0 0 4px #ef4444'}}/>
          <div style={{width:8,height:8,borderRadius:2,background:'#f97316',boxShadow:'0 0 4px #f97316'}}/>
          <div style={{width:8,height:8,borderRadius:2,background:device.active?'#22c55e':'#0a1628',border:device.active?'none':'1px solid #162438'}}/>
        </div>
        <MiniStopwatch seconds={timer} total={totalTimer}/>
        <button onClick={doClaim} disabled={!canClaim} style={{flex:1,background:canClaim?'linear-gradient(180deg,#1a0000,#0d0000)':'linear-gradient(180deg,#080f18,#040a10)',border:`2px solid ${canClaim?'#ff2020':'#162438'}`,borderRadius:7,padding:'6px 2px',cursor:canClaim?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',animation:canClaim?'ransomPulse 1s infinite':'none',boxShadow:canClaim?'inset 0 0 10px rgba(255,32,32,0.3),0 0 10px rgba(255,32,32,0.4)':'none'}}>
          <span style={{fontFamily:'"Syne",sans-serif',fontSize:12,fontWeight:800,letterSpacing:'0.1em',color:canClaim?'#ff4040':'#1e3a5f',textShadow:canClaim?'0 0 8px #ff2020,0 0 20px #ff202080':'none'}}>RANSOM</span>
        </button>
        <div style={{display:'flex',flexDirection:'column',gap:3}}>
          {[0,1].map(i=><div key={i} style={{width:13,height:13,borderRadius:'50%',background:'radial-gradient(circle at 35% 30%,#2a4a6a,#050d17)',border:'1.5px solid #1e3a5f'}}/>)}
        </div>
      </div>
      {/* NO claimed wins strip — removed to keep height compact */}
    </div>
  )
}

// ─── Matrix Hack Display ──────────────────────────────────────────────────────
function MatrixHackDisplay({calledNums,calledOrder,clickWindowOpen,preGameSecs}:{
  calledNums:Set<number>;calledOrder:number[];clickWindowOpen:boolean;preGameSecs:number
}){
  const [glitching,setGlitching]=useState(false)
  const [bgCmds,setBgCmds]=useState<{cmd:string;x:number;y:number;op:number;st:string;col:string}[]>([])
  const lastNum=calledOrder[calledOrder.length-1]??null
  const prev6=calledOrder.slice(-7,-1).reverse()
  const prevNumRef=useRef(lastNum)
  const inPreGame=preGameSecs>0
  const neonCols=['#00e5a0','#00b8ff','#ef4444','#f59e0b','#a855f7']

  useEffect(()=>{
    if(lastNum!==prevNumRef.current){prevNumRef.current=lastNum;setGlitching(true);setTimeout(()=>setGlitching(false),600)}
  },[lastNum])

  useEffect(()=>{
    const t=setInterval(()=>{
      setBgCmds(p=>[...p.slice(-20),{
        cmd:HACK_CMDS[Math.floor(Math.random()*HACK_CMDS.length)],
        x:3+Math.random()*94,y:3+Math.random()*94,
        op:0.06+Math.random()*0.12,
        st:HACK_STATUSES[Math.floor(Math.random()*HACK_STATUSES.length)],
        col:neonCols[Math.floor(Math.random()*neonCols.length)],
      }])
    },220)
    return()=>clearInterval(t)
  },[])

  return(
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      <div style={{background:'#020d1a',border:'2px solid #0a3a5a',borderRadius:14,padding:'14px 12px',position:'relative',overflow:'hidden',boxShadow:'inset 0 0 60px rgba(0,229,160,0.04)',minHeight:340}}>
        {/* Scanlines */}
        <div style={{position:'absolute',inset:0,backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.15) 2px,rgba(0,0,0,0.15) 4px)',pointerEvents:'none',zIndex:1}}/>
        {/* Background hacking commands — multi-color */}
        <div style={{position:'absolute',inset:0,overflow:'hidden',zIndex:2,pointerEvents:'none'}}>
          {bgCmds.map((c,i)=>(
            <div key={i} style={{position:'absolute',left:`${c.x}%`,top:`${c.y}%`,fontFamily:'"DM Mono",monospace',fontSize:7,color:c.col,opacity:c.op,whiteSpace:'nowrap',transform:'translateX(-50%)',animation:`gx${i%3} ${3+i%2}s ${i*0.1}s infinite`}}>
              {c.cmd}... {c.st}
            </div>
          ))}
        </div>
        <div style={{position:'relative',zIndex:3}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#2a5a7a',letterSpacing:'0.2em'}}>◉ MATRIX HACK</div>
            <div style={{display:'flex',alignItems:'center',gap:5}}>
              <div style={{width:5,height:5,borderRadius:'50%',background:'#22c55e',animation:'dot 1.5s infinite'}}/>
              <div style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:'#22c55e'}}>LIVE</div>
            </div>
          </div>
          {inPreGame?(
            <div style={{textAlign:'center',padding:'30px 0'}}>
              <div style={{fontFamily:'"DM Mono",monospace',fontSize:9,color:'#2a5a7a',letterSpacing:'0.2em',marginBottom:16}}>HACK INITIATES IN</div>
              <div style={{fontFamily:'"Syne",sans-serif',fontSize:72,fontWeight:800,color:'#fff',lineHeight:1,
                textShadow:'0 0 30px #fff,0 0 60px rgba(255,255,255,0.5)',animation:'numAppear 0.5s ease'}}>
                {fmtTime(preGameSecs)}
              </div>
              <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#1e4a6a',marginTop:12}}>PREPARE YOUR NFT DEVICES · ACTIVATE TO CONNECT</div>
            </div>
          ):(
            <div style={{textAlign:'center'}}>
              {/* Big white neon number */}
              <div style={{position:'relative',display:'inline-block'}}>
                <div key={String(lastNum)} style={{fontFamily:'"Syne",sans-serif',fontSize:80,fontWeight:800,lineHeight:1,
                  color:'#ffffff',display:'block',
                  textShadow:'0 0 20px #fff,0 0 40px rgba(255,255,255,0.8),0 0 80px rgba(255,255,255,0.4),0 0 120px rgba(255,255,255,0.2)',
                  animation:glitching?'matrixGlitch 0.6s ease':'numAppear 0.4s cubic-bezier(.34,1.56,.64,1)'}}>
                  {lastNum??'??'}
                </div>
                {glitching&&(<>
                  <div style={{position:'absolute',inset:0,fontFamily:'"Syne",sans-serif',fontSize:80,fontWeight:800,color:'#ff0040',opacity:0.5,animation:'glitchR 0.6s ease',pointerEvents:'none'}}>{lastNum}</div>
                  <div style={{position:'absolute',inset:0,fontFamily:'"Syne",sans-serif',fontSize:80,fontWeight:800,color:'#00b8ff',opacity:0.5,animation:'glitchB 0.6s ease',pointerEvents:'none'}}>{lastNum}</div>
                </>)}
              </div>
              {/* Click window */}
              <div style={{display:'inline-flex',alignItems:'center',gap:6,marginTop:6,padding:'3px 10px',background:clickWindowOpen?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.08)',border:`1px solid ${clickWindowOpen?'rgba(34,197,94,0.4)':'rgba(239,68,68,0.25)'}`,borderRadius:20}}>
                <div style={{width:5,height:5,borderRadius:'50%',background:clickWindowOpen?'#22c55e':'#ef4444',animation:clickWindowOpen?'dot 1s infinite':'none'}}/>
                <div style={{fontFamily:'"DM Mono",monospace',fontSize:7.5,color:clickWindowOpen?'#22c55e':'#ef4444'}}>{clickWindowOpen?'CLICK WINDOW OPEN':'WINDOW CLOSED'}</div>
              </div>
              {/* Previous numbers — white neon */}
              <div style={{display:'flex',gap:5,justifyContent:'center',marginTop:10}}>
                {prev6.map((n,i)=>(
                  <div key={i} style={{width:28,height:28,borderRadius:5,display:'flex',alignItems:'center',justifyContent:'center',background:'#0a1628',border:'1px solid #1e3a5f',fontFamily:'"DM Mono",monospace',fontSize:10,
                    color:'#ffffff',opacity:(1-i*0.14)*0.7,
                    textShadow:'0 0 6px rgba(255,255,255,0.6)'}}>{n}</div>
                ))}
              </div>
              {/* Numbers drawn count only — no grid */}
              <div style={{marginTop:10,fontFamily:'"DM Mono",monospace',fontSize:8,color:'#1e4a6a'}}>{calledNums.size}/90 drawn</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Chat Terminal ────────────────────────────────────────────────────────────
function ChatTerminal({nickname}:{nickname:string}){
  const [lines,setLines]=useState<ChatLine[]>([
    {t:'sys',m:'HACKING MATRIX v3.7.1 INITIALIZED'},
    {t:'sys',m:'SECURE CHANNEL ACTIVE'},
    {t:'sys',m:`AGENT ${nickname.toUpperCase()} CONNECTED`},
  ])
  const [input,setInput]=useState('')
  const scrollBoxRef=useRef<HTMLDivElement>(null)
  const fileRef=useRef<HTMLInputElement>(null)
  useEffect(()=>{const box=scrollBoxRef.current;if(box)box.scrollTop=box.scrollHeight},[lines])
  useEffect(()=>{
    const t=setInterval(()=>{
      const cmd=HACK_CMDS[Math.floor(Math.random()*HACK_CMDS.length)]
      const hex=Math.random().toString(16).slice(2,8).toUpperCase()
      setLines(p=>[...p.slice(-80),{t:'cmd',m:`> ${cmd}... [0x${hex}]`}])
    },3200+Math.random()*2000)
    return()=>clearInterval(t)
  },[])
  const send=()=>{
    if(!input.trim())return
    setLines(p=>[...p,{t:'user',m:`${nickname}: ${input}`}]);setInput('')
    setTimeout(()=>setLines(p=>[...p,{t:'cmd',m:`> ${HACK_CMDS[Math.floor(Math.random()*HACK_CMDS.length)]}... [ACK]`}]),600)
  }
  const handleFile=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];if(!file)return
    const reader=new FileReader()
    reader.onload=ev=>{
      const src=ev.target?.result as string
      if(file.type.startsWith('image/')) setLines(p=>[...p,{t:'img',m:`${nickname} shared: ${file.name}`,src}])
      else setLines(p=>[...p,{t:'sys',m:`📎 ${nickname} shared: ${file.name}`}])
    }
    reader.readAsDataURL(file);e.target.value=''
  }
  return(
    <div style={{display:'flex',flexDirection:'column',background:'#020d1a',border:'1px solid #0a2535',borderRadius:12,overflow:'hidden'}}>
      <div style={{padding:'5px 10px',borderBottom:'1px solid #0a2535',fontFamily:'"DM Mono",monospace',fontSize:7.5,color:'#00e5a0',letterSpacing:'0.12em',display:'flex',alignItems:'center',gap:5,flexShrink:0}}>
        <div style={{width:5,height:5,borderRadius:'50%',background:'#22c55e',animation:'dot 1.5s infinite'}}/>
        HACKING MATRIX — SECURE CHAT
      </div>
      <div ref={scrollBoxRef} style={{height:260,overflowY:'auto',padding:'7px 8px',display:'flex',flexDirection:'column',gap:3}}>
        {lines.map((l,i)=>(
          <div key={i}>
            <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:l.t==='sys'?'#00e5a0':l.t==='user'?'#00b8ff':l.t==='img'?'#f59e0b':'#2a5a7a',fontWeight:l.t==='user'?600:400}}>{l.m}</div>
            {l.t==='img'&&l.src&&<img src={l.src} alt="shared" style={{maxWidth:'100%',maxHeight:120,borderRadius:6,marginTop:4,border:'1px solid #1e3a5f',display:'block'}}/>}
          </div>
        ))}
      </div>
      <div style={{display:'flex',borderTop:'1px solid #0a2535',flexShrink:0}}>
        <input ref={fileRef} type="file" accept="image/*,video/*,audio/*,.pdf,.txt" onChange={handleFile} style={{display:'none'}}/>
        <button onClick={()=>fileRef.current?.click()} style={{background:'#0a1628',border:'none',borderRight:'1px solid #0a2535',padding:'6px 10px',color:'#2a5a7a',cursor:'pointer',fontSize:13,display:'flex',alignItems:'center'}}>📎</button>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}
          placeholder="TYPE COMMAND..."
          style={{flex:1,background:'transparent',border:'none',padding:'6px 8px',fontFamily:'"DM Mono",monospace',fontSize:8,color:'#00b8ff',outline:'none'}}/>
        <button onClick={send} style={{background:'#0a1628',border:'none',borderLeft:'1px solid #0a2535',padding:'6px 10px',color:'#2a5a7a',cursor:'pointer',fontFamily:'"DM Mono",monospace',fontSize:8}}>SEND</button>
      </div>
    </div>
  )
}

// ─── Game Stats with LED progress bars ───────────────────────────────────────
function GameStats({devices,calledNums,bankruptCount,liveBank,nickname,winStates}:{
  devices:Device[];calledNums:Set<number>;bankruptCount:number;liveBank:number;nickname:string;winStates:Record<WinType,WinState>
}){
  const LED_TYPES:WinType[]=['EARLY_FIVE','TOP_LINE','MIDDLE_LINE','BOTTOM_LINE','FULL_HOUSE_1','FULL_HOUSE_2','FULL_HOUSE_3']
  return(
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      <div style={{background:'#020d1a',border:'1px solid #0a2535',borderRadius:12,padding:10}}>
        <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#2a5a7a',letterSpacing:'0.12em',marginBottom:7}}>GAME STATS</div>
        {[['AGENT',nickname],['TARGET',BANKS[liveBank].name],['DRAWN',`${calledNums.size}/90`],['NFT',String(devices.length)],['ACTIVE',String(devices.filter(d=>d.active).length)],['BANKRUPT',`${bankruptCount}/3`]].map(([k,v])=>(
          <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'2px 0',borderBottom:'1px solid #0a1628'}}>
            <span style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:'#1e4a6a'}}>{k}</span>
            <span style={{fontFamily:'"DM Mono",monospace',fontSize:7.5,color:'#4a7fa5',fontWeight:600}}>{v}</span>
          </div>
        ))}
      </div>
      {/* LED Key with progress bars */}
      <div style={{background:'#020d1a',border:'1px solid #0a2535',borderRadius:10,padding:10}}>
        <div style={{fontFamily:'"DM Mono",monospace',fontSize:7.5,color:'#1e4a6a',marginBottom:7}}>WIN STATUS</div>
        {LED_TYPES.map(type=>(
          <LedWithProgress key={type} type={type} winState={winStates[type]} devices={devices} winStates={winStates}/>
        ))}
      </div>
    </div>
  )
}

// ─── Nickname Modal ───────────────────────────────────────────────────────────
function NicknameModal({onConfirm}:{onConfirm:(name:string)=>void}){
  const [name,setName]=useState(''),  [err,setErr]=useState('')
  const submit=()=>{if(name.trim().length<3){setErr('Min 3 chars');return}if(name.trim().length>16){setErr('Max 16 chars');return}onConfirm(name.trim())}
  return(
    <div style={{position:'fixed',inset:0,background:'linear-gradient(135deg,#010810,#020d1a)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
      <div style={{background:'#020d1a',border:'1px solid #0a3a5a',borderRadius:20,padding:36,maxWidth:360,width:'90%',boxShadow:'0 0 60px rgba(0,229,160,0.08)'}}>
        <div style={{fontFamily:'"Syne",sans-serif',fontSize:28,fontWeight:800,color:'#00e5a0',textShadow:'0 0 20px #00e5a060',marginBottom:4}}>RANSOME</div>
        <div style={{fontFamily:'"DM Mono",monospace',fontSize:9,color:'#2a5a7a',letterSpacing:'0.18em',marginBottom:28}}>HACK THE BANKS — CLAIM THE VAULT</div>
        <div style={{fontFamily:'"DM Mono",monospace',fontSize:9,color:'#4a7fa5',marginBottom:8}}>CHOOSE YOUR AGENT NAME</div>
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder="e.g. GHOST_ZERO" maxLength={16}
          style={{width:'100%',background:'#0a1628',border:'1px solid #1e3a5f',borderRadius:10,padding:'10px 14px',fontFamily:'"DM Mono",monospace',fontSize:13,color:'#00e5a0',outline:'none',boxSizing:'border-box',marginBottom:6,caretColor:'#00e5a0'}}/>
        {err&&<div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#ef4444',marginBottom:8}}>{err}</div>}
        <button onClick={submit} style={{width:'100%',background:'linear-gradient(135deg,#00e5a0,#00b8ff)',color:'#000',border:'none',borderRadius:10,padding:'12px',fontFamily:'"Syne",sans-serif',fontSize:14,fontWeight:700,cursor:'pointer',marginTop:6}}>ENTER THE MATRIX →</button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Ransome(){
  const [phase,setPhase]=useState<string>('setup')
  const [nickname,setNickname]=useState('')
  const [wallet,setWallet]=useState<string|null>(null)
  const [devices,setDevices]=useState<Device[]>([])
  const [calledNums,setCalledNums]=useState<Set<number>>(new Set())
  const [calledOrder,setCalledOrder]=useState<number[]>([])
  const [timer,setTimer]=useState(60)
  const [totalTimer,setTotalTimer]=useState(60)
  const [clickWindowOpen,setClickWindowOpen]=useState(false)
  const [announcement,setAnnouncement]=useState<string|null>(null)
  const [bankruptCount,setBankruptCount]=useState(0)
  const [mintCount,setMintCount]=useState(1)
  const [mintToken,setMintToken]=useState('USDT')
  const [selectedBank,setSelectedBank]=useState<number|null>(null)
  const [hoveredBank,setHoveredBank]=useState<number|null>(null)
  const [devicesExpanded,setDevicesExpanded]=useState(false)
  const [devicePage,setDevicePage]=useState(0)
  const [showDemo,setShowDemo]=useState(false)
  const [preGameSecs,setPreGameSecs]=useState(0)
  const [bankHacked,setBankHacked]=useState(false)
  const [winStates,setWinStates]=useState<Record<WinType,WinState>>(defaultWinStates())
  const timerRef=useRef<ReturnType<typeof setInterval>|null>(null)
  const preTimerRef=useRef<ReturnType<typeof setInterval>|null>(null)
  const flickerTimers=useRef<Record<string,ReturnType<typeof setTimeout>>>({})
  const currentHour=new Date().getUTCHours()
  const liveBank=getLiveBank(currentHour)
  const currentNum=calledOrder[calledOrder.length-1]??null
  const totalPages=Math.max(1,Math.ceil(devices.length/10))
  const hourCountdown=useHourCountdown()

  const announce=(msg:string)=>{setAnnouncement(msg);setTimeout(()=>setAnnouncement(null),6000)}

  const drawNumber=useCallback(()=>{
    setClickWindowOpen(false)
    setCalledNums(prev=>{
      if(prev.size>=90){
        // All 90 numbers drawn — bank hacked, distribute unclaimed wins
        setBankHacked(true)
        return prev
      }
      const remaining=Array.from({length:90},(_,i)=>i+1).filter(n=>!prev.has(n))
      if(!remaining.length){setBankHacked(true);return prev}
      const num=remaining[Math.floor(Math.random()*remaining.length)]
      setCalledOrder(o=>[...o,num])
      setDevices(ds=>ds.map(d=>{
        if(!d.active||d.corrupted)return d
        return{...d,grid:d.grid.map(row=>row.map(cell=>cell.num===num?{...cell,matched:true}:cell))}
      }))
      setTimeout(()=>setClickWindowOpen(true),150)
      return new Set(Array.from(prev).concat([num]))
    })
  },[])

  // When bank is hacked — announce + distribute unclaimed to wallet + exit
  useEffect(()=>{
    if(!bankHacked)return
    if(timerRef.current)clearInterval(timerRef.current)
    setClickWindowOpen(false)
    announce(`🏦 BANK HACKED! ALL 90 NUMBERS DRAWN!\n💸 Unclaimed winnings → ${CLAIM_WALLET.slice(0,8)}...${CLAIM_WALLET.slice(-6)}\n⏸ Returning to lobby in 8 seconds...`)
    setTimeout(()=>{
      setPhase('lobby')
      setBankHacked(false)
      setCalledNums(new Set())
      setCalledOrder([])
      setWinStates(defaultWinStates())
      setDevicePage(0)
    },8000)
  },[bankHacked])

  const startPreGame=useCallback((secs:number)=>{
    setPreGameSecs(secs)
    preTimerRef.current=setInterval(()=>{
      setPreGameSecs(p=>{
        if(p<=1){
          clearInterval(preTimerRef.current!)
          const t=60+Math.floor(Math.random()*31);setTimer(t);setTotalTimer(t)
          timerRef.current=setInterval(()=>{
            setTimer(prev=>{
              if(prev<=1){setClickWindowOpen(false);const next=60+Math.floor(Math.random()*31);setTotalTimer(next);drawNumber();return next}
              return prev-1
            })
          },1000)
          drawNumber()
          return 0
        }
        return p-1
      })
    },1000)
  },[drawNumber])

  // Win detection
  useEffect(()=>{
    if(phase!=='game')return
    setWinStates(prev=>{
      const next={...prev};let announced=false
      devices.forEach(d=>{
        if(!d.active||d.corrupted)return
        const all=d.grid.flat(),clickedC=all.filter(c=>c.clicked)
        if(clickedC.length>=5&&!next.EARLY_FIVE.claimable){next.EARLY_FIVE={...next.EARLY_FIVE,claimable:true};if(!announced){announce(`⚡ ${d.nftId} — EARLY FIVE READY!`);announced=true}}
        if(d.grid[0].filter(c=>c.num).every(c=>c.clicked)&&!next.TOP_LINE.claimable){next.TOP_LINE={...next.TOP_LINE,claimable:true};if(!announced){announce(`⚡ ${d.nftId} — TOP LINE READY!`);announced=true}}
        if(d.grid[1].filter(c=>c.num).every(c=>c.clicked)&&!next.MIDDLE_LINE.claimable){next.MIDDLE_LINE={...next.MIDDLE_LINE,claimable:true};if(!announced){announce(`⚡ ${d.nftId} — MIDDLE LINE READY!`);announced=true}}
        if(d.grid[2].filter(c=>c.num).every(c=>c.clicked)&&!next.BOTTOM_LINE.claimable){next.BOTTOM_LINE={...next.BOTTOM_LINE,claimable:true};if(!announced){announce(`⚡ ${d.nftId} — BOTTOM LINE READY!`);announced=true}}
        if(all.filter(c=>c.num).every(c=>c.clicked)){const fk=`FULL_HOUSE_${Math.min(bankruptCount+1,3)}` as WinType;if(!next[fk].claimable){next[fk]={...next[fk],claimable:true};if(!announced){announce(`🔥 ${d.nftId} — FULL HOUSE! ALL 15 MATCHED!`);announced=true}}}
      })
      return next
    })
  },[devices,phase])

  const handleCellClick=(devId:number,r:number,c:number)=>{
    if(!clickWindowOpen||!currentNum)return
    setDevices(ds=>ds.map(d=>{
      if(d.id!==devId||!d.active)return d
      const cell=d.grid[r][c]
      if(!cell.num||cell.num!==currentNum||cell.clicked)return d
      return{...d,grid:d.grid.map((row,ri)=>row.map((cl,ci)=>ri===r&&ci===c?{...cl,clicked:true}:cl))}
    }))
  }

  const handleClaim=(devId:number,wt:WinType)=>{
    if(winStates[wt].claimed)return
    const dev=devices.find(d=>d.id===devId)
    setDevices(ds=>ds.map(d=>d.id!==devId?d:{...d,claimed:new Set(Array.from(d.claimed).concat([wt]))}))
    const matchedNums=dev?dev.grid.flat().filter(c=>c.clicked).map(c=>c.num).join(', '):''
    announce(`✅ ${dev?.nftId??`DEV-${devId}`} — ${WIN_LABELS[wt]} CLAIMED!\nMatched: ${matchedNums}`)
    if(wt.startsWith('FULL_HOUSE'))setBankruptCount(b=>Math.min(b+1,3))
    // Start 60s flicker then broken LED for all OTHER devices
    setWinStates(prev=>({...prev,[wt]:{...prev[wt],claimed:true,flickering:true,broken:false}}))
    const key=`flicker_${wt}`
    flickerTimers.current[key]=setTimeout(()=>{
      setWinStates(p=>({...p,[wt]:{...p[wt],flickering:false,broken:true}}))
    },60000)
  }

  const handleActivate=(devId:number)=>{
    setDevices(ds=>ds.map(d=>d.id!==devId?d:{...d,active:true}))
    const dev=devices.find(d=>d.id===devId)
    announce(`⚡ ${dev?.nftId??`DEV-${devId}`} CONNECTED TO ${BANKS[liveBank].name}`)
  }

  const mintDevices=()=>{
    const nd=Array.from({length:mintCount},(_,i)=>generateDevice(devices.length+i))
    setDevices(p=>[...p,...nd])
    announce(`⚡ ${mintCount} NFT DEVICE${mintCount>1?'S':''} MINTED`)
  }

  const enterGame=()=>{
    setPhase('game');startPreGame(300)
    announce('🔴 BREACH INITIATED — HACK STARTS IN 5 MINUTES')
  }

  if(phase==='setup') return(
    <div style={{minHeight:'100vh',background:'#010810'}}>
      <NicknameModal onConfirm={name=>{setNickname(name);setPhase('lobby')}}/>
    </div>
  )

  // ── LOBBY ──────────────────────────────────────────────────────────────────
  if(phase==='lobby') return(
    <div style={{minHeight:'100vh',background:'linear-gradient(180deg,#010810,#020d1a)',color:'#c8d8e8',padding:'20px 16px'}}>
      {showDemo&&<DemoHackModal onClose={()=>setShowDemo(false)}/>}

      {/* Header — RANSOME | Ad space | Agent/Wallet */}
      <div style={{display:'flex',alignItems:'center',marginBottom:20,gap:0}}>
        <div style={{flexShrink:0}}>
          <div style={{fontFamily:'"Syne",sans-serif',fontSize:26,fontWeight:800,color:'#00e5a0',textShadow:'0 0 20px #00e5a060'}}>RANSOME</div>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#2a5a7a',letterSpacing:'0.18em'}}>HACK THE BANKS — CLAIM THE VAULT</div>
        </div>
        {/* Ad banner space — between title and right controls */}
        <div style={{flex:1,margin:'0 16px',height:44,background:'rgba(0,229,160,0.03)',border:'1px dashed #0a2535',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#0a2535',letterSpacing:'0.2em'}}>ADVERTISEMENT SPACE</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#4a7fa5',background:'#0a1628',border:'1px solid #1e3a5f',borderRadius:8,padding:'5px 10px'}}>👤 {nickname}</div>
          <button onClick={()=>setWallet('HaCk...3r0x')} style={{background:wallet?'#0a1628':'linear-gradient(135deg,#00e5a0,#00b8ff)',color:wallet?'#00e5a0':'#000',border:wallet?'1px solid #00e5a040':'none',borderRadius:8,padding:'6px 14px',fontFamily:'"DM Mono",monospace',fontSize:9,cursor:'pointer',fontWeight:600}}>
            {wallet?`✓ ${wallet}`:'CONNECT WALLET'}
          </button>
        </div>
      </div>

      {/* Live bank banner */}
      <div style={{background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.2)',borderRadius:14,padding:'12px 16px',marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#ef4444',letterSpacing:'0.15em',marginBottom:2}}>🔴 LIVE NOW — 1 HOUR WINDOW</div>
          <div style={{fontFamily:'"Syne",sans-serif',fontSize:20,fontWeight:800,color:'#fff'}}>{BANKS[liveBank].name}</div>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#2a5a7a'}}>{BANKS[liveBank].city} · UTC{BANKS[liveBank].tz>=0?'+':''}{BANKS[liveBank].tz}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#2a5a7a'}}>VAULT</div>
          <div style={{fontFamily:'"Syne",sans-serif',fontSize:22,fontWeight:800,color:'#00e5a0'}}>$1,000,000</div>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:9,color:hourCountdown===0?'#22c55e':'#ef4444',marginTop:2,fontWeight:700}}>
            {hourCountdown===0?'🟢 HACK WINDOW OPEN':`⏱ HACK IN ${fmtTime(hourCountdown)}`}
          </div>
        </div>
      </div>

      {/* Bisected: Map (left) + Mint (right) */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
        {/* Left: Full world map with bank table */}
        <div>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#1e4a6a',letterSpacing:'0.12em',marginBottom:6,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>⬡ GLOBAL BANK NETWORK</span>
            {hoveredBank!==null&&<span style={{color:'#00e5a0',fontSize:7}}>{BANKS[hoveredBank].name}</span>}
          </div>
          <LobbyWorldMap selectedBank={selectedBank} onSelect={setSelectedBank} currentHour={currentHour} hoveredBank={hoveredBank} onHover={setHoveredBank}/>
          <button onClick={()=>setShowDemo(true)} style={{width:'100%',marginTop:8,background:'linear-gradient(135deg,#0a1628,#0d1f3a)',border:'1px solid #00e5a040',borderRadius:10,padding:'10px',fontFamily:'"DM Mono",monospace',fontSize:9,color:'#00e5a0',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
            ▶ DEMO HACK — See how to play
          </button>
        </div>

        {/* Right: Mint */}
        <div>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#1e4a6a',letterSpacing:'0.12em',marginBottom:6}}>◈ MINT NFT HACKING DEVICES</div>
          <div style={{background:'#020d1a',border:'1px solid #0a2a4a',borderRadius:14,padding:14,height:'calc(100% - 22px)'}}>
            {!wallet?(
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',gap:12}}>
                <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#1e4a6a',textAlign:'center'}}>Connect wallet to mint NFT devices</div>
                <button onClick={()=>setWallet('HaCk...3r0x')} style={{background:'linear-gradient(135deg,#00e5a0,#00b8ff)',color:'#000',border:'none',borderRadius:9,padding:'10px 20px',fontFamily:'"DM Mono",monospace',fontSize:10,cursor:'pointer',fontWeight:700}}>CONNECT WALLET →</button>
              </div>
            ):(
              <>
                <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
                  {['USDT','USDC','SOL','RNSM'].map(t=>(
                    <button key={t} onClick={()=>setMintToken(t)} style={{background:mintToken===t?'#0a3a5a':'transparent',color:mintToken===t?'#00e5a0':'#2a5a7a',border:`1px solid ${mintToken===t?'#00e5a040':'#0a2535'}`,borderRadius:7,padding:'5px 12px',fontFamily:'"DM Mono",monospace',fontSize:9,cursor:'pointer'}}>{t}</button>
                  ))}
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:10,flexWrap:'wrap'}}>
                  {[1,3,5,10].map(n=>(
                    <button key={n} onClick={()=>setMintCount(n)} style={{background:mintCount===n?'#0a3a5a':'transparent',color:mintCount===n?'#00e5a0':'#2a5a7a',border:`1px solid ${mintCount===n?'#00e5a040':'#0a2535'}`,borderRadius:7,padding:'4px 10px',fontFamily:'"DM Mono",monospace',fontSize:9,cursor:'pointer'}}>{n}</button>
                  ))}
                  <input type="number" value={mintCount} onChange={e=>setMintCount(Math.max(1,parseInt(e.target.value)||1))} style={{width:52,background:'#0a1628',border:'1px solid #0a2535',borderRadius:7,padding:'4px 8px',fontFamily:'"DM Mono",monospace',fontSize:9,color:'#00e5a0',outline:'none'}}/>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div style={{fontFamily:'"DM Mono",monospace',fontSize:11,color:'#fff',fontWeight:600}}>{mintCount} {mintToken}</div>
                  <button onClick={mintDevices} style={{background:'linear-gradient(135deg,#00e5a0,#00b8ff)',color:'#000',border:'none',borderRadius:9,padding:'9px 18px',fontFamily:'"DM Mono",monospace',fontSize:10,cursor:'pointer',fontWeight:700}}>MINT →</button>
                </div>
                {devices.length>0&&(
                  <div style={{background:'rgba(0,229,160,0.05)',border:'1px solid rgba(0,229,160,0.15)',borderRadius:8,padding:'8px 10px'}}>
                    <div style={{fontFamily:'"DM Mono",monospace',fontSize:7.5,color:'#00e5a0',marginBottom:4}}>YOUR NFT DEVICES ({devices.length})</div>
                    {devices.slice(0,5).map(d=>(
                      <div key={d.id} style={{display:'flex',justifyContent:'space-between',padding:'2px 0',fontFamily:'"DM Mono",monospace',fontSize:7}}>
                        <span style={{color:'#2a5a7a'}}>{d.nftId}</span>
                        <span style={{color:d.active?'#22c55e':'#1e4a6a'}}>{d.active?'● ACTIVE':'○ INACTIVE'}</span>
                      </div>
                    ))}
                    {devices.length>5&&<div style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:'#1e4a6a',marginTop:2}}>+{devices.length-5} more...</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {devices.length>0&&(
        <button onClick={enterGame} style={{width:'100%',background:'linear-gradient(135deg,#ef4444,#dc2626)',color:'#fff',border:'none',borderRadius:12,padding:'14px',fontFamily:'"Syne",sans-serif',fontSize:16,fontWeight:800,cursor:'pointer',boxShadow:'0 4px 20px rgba(239,68,68,0.3)'}}>
          🔴 INITIATE HACK — {devices.length} NFT DEVICE{devices.length>1?'S':''} READY
        </button>
      )}

      {announcement&&(
        <div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:'#020d1a',border:'1px solid #00e5a040',borderRadius:10,padding:'10px 20px',fontFamily:'"DM Mono",monospace',fontSize:10,color:'#00e5a0',zIndex:999,whiteSpace:'pre',boxShadow:'0 8px 24px rgba(0,0,0,0.5)'}}>
          {announcement}
        </div>
      )}
    </div>
  )

  // ── GAME SCREEN ──────────────────────────────────────────────────────────
  const pageDevices=devices.slice(devicePage*10,devicePage*10+10)

  return(
    <div style={{background:'linear-gradient(180deg,#010810,#020d1a)',color:'#c8d8e8',minHeight:'100vh'}}>
      {/* Header — RANSOME | Ad space | Status pills */}
      <div style={{padding:'7px 14px',borderBottom:'1px solid #0a1f3a',display:'flex',alignItems:'center',background:'rgba(2,13,26,0.95)',backdropFilter:'blur(12px)',WebkitBackdropFilter:'blur(12px)',position:'sticky',top:0,zIndex:50,gap:0}}>
        <div style={{fontFamily:'"Syne",sans-serif',fontSize:18,fontWeight:800,color:'#00e5a0',textShadow:'0 0 10px #00e5a040',flexShrink:0}}>RANSOME</div>
        {/* Ad space between label and status pills */}
        <div style={{flex:1,margin:'0 12px',height:28,background:'rgba(0,229,160,0.02)',border:'1px dashed #0a2535',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:'#0a2535',letterSpacing:'0.15em'}}>ADVERTISEMENT</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0}}>
          {preGameSecs>0&&<div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#f59e0b',background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.25)',borderRadius:6,padding:'3px 8px'}}>⏱ HACK IN {fmtTime(preGameSecs)}</div>}
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#ef4444',background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.2)',borderRadius:6,padding:'3px 8px'}}>🔴 {BANKS[liveBank].name}</div>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#4a7fa5',background:'#0a1628',borderRadius:6,padding:'3px 8px'}}>👤 {nickname}</div>
        </div>
      </div>

      {/* Top 3-col */}
      <div style={{padding:'10px 14px 0',display:'grid',gridTemplateColumns:'200px 1fr 230px',gap:10,alignItems:'start'}}>
        <GameStats devices={devices} calledNums={calledNums} bankruptCount={bankruptCount} liveBank={liveBank} nickname={nickname} winStates={winStates}/>
        <MatrixHackDisplay calledNums={calledNums} calledOrder={calledOrder} clickWindowOpen={clickWindowOpen} preGameSecs={preGameSecs}/>
        <ChatTerminal nickname={nickname}/>
      </div>

      {/* Win strip */}
      <div style={{margin:'8px 14px 0',padding:'5px 8px',display:'flex',gap:5,overflowX:'auto',borderRadius:10,background:'rgba(2,13,26,0.7)',border:'1px solid #0a1f3a'}}>
        {(Object.entries(WIN_LABELS) as [WinType,string][]).map(([type,label])=>{
          const st=winStates[type]
          return(
            <div key={type} style={{display:'flex',gap:3,alignItems:'center',padding:'3px 7px',borderRadius:6,flexShrink:0,
              background:st.claimed?'rgba(34,197,94,0.08)':st.claimable?'rgba(236,72,153,0.08)':'transparent',
              border:st.claimed?'1px solid rgba(34,197,94,0.25)':st.claimable?'1px solid rgba(236,72,153,0.35)':'1px solid transparent'}}>
              <div style={{width:7,height:5,borderRadius:1,background:LED_COLORS[type],opacity:st.claimed?0.3:1,
                boxShadow:st.claimable&&!st.claimed?`0 0 4px ${LED_COLORS[type]}`:'none',
                animation:st.flickering?'rapidFlicker 0.08s infinite':st.broken?'none':st.claimable&&!st.claimed?'ledBlink 0.5s infinite':'none'}}/>
              <div style={{fontFamily:'"DM Mono",monospace',fontSize:7,color:st.claimed?'#22c55e':st.claimable?'#ec4899':'#1e4a6a',whiteSpace:'nowrap'}}>
                {st.claimed?'✓ ':st.claimable?'⚡ ':'○ '}{label}
              </div>
            </div>
          )
        })}
      </div>

      {/* NFT Hacking Devices */}
      <div style={{padding:'10px 14px 20px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={{fontFamily:'"DM Mono",monospace',fontSize:8,color:'#1e4a6a',letterSpacing:'0.1em'}}>
            ◈ NFT HACKING DEVICES &nbsp;
            <span style={{color:'#2a5a7a'}}>{devices.length} minted · {devices.filter(d=>d.active).length} connected</span>
            {totalPages>1&&<span style={{color:'#1e4a6a'}}> · pg {devicePage+1}/{totalPages}</span>}
          </div>
          <div style={{display:'flex',gap:5,alignItems:'center'}}>
            <button onClick={()=>setDevicePage(p=>Math.max(0,p-1))} disabled={devicePage===0}
              style={{width:24,height:24,borderRadius:6,background:'#0a1628',border:'1px solid #1e3a5f',color:devicePage===0?'#1e3a5f':'#4a7fa5',cursor:devicePage===0?'default':'pointer',fontFamily:'"DM Mono",monospace',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center'}}>‹</button>
            <button onClick={()=>setDevicePage(p=>Math.min(totalPages-1,p+1))} disabled={devicePage>=totalPages-1}
              style={{width:24,height:24,borderRadius:6,background:'#0a1628',border:'1px solid #1e3a5f',color:devicePage>=totalPages-1?'#1e3a5f':'#4a7fa5',cursor:devicePage>=totalPages-1?'default':'pointer',fontFamily:'"DM Mono",monospace',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center'}}>›</button>
            <button onClick={()=>setDevicesExpanded(e=>!e)}
              style={{background:'#0a1628',border:'1px solid #1e3a5f',color:'#2a5a7a',borderRadius:7,padding:'4px 10px',fontFamily:'"DM Mono",monospace',fontSize:7.5,cursor:'pointer'}}>
              {devicesExpanded?'⊟ NORMAL':'⊞ MAXIMIZE'}
            </button>
          </div>
        </div>

        {/* 5 cols when maximized (10 fit per page) */}
        <div style={{display:'grid',gridTemplateColumns:devicesExpanded?'repeat(5,1fr)':'repeat(2,1fr)',gap:8}}>
          {pageDevices.map(d=>(
            <HackingDevice key={d.id} device={d} currentNum={currentNum} clickWindowOpen={clickWindowOpen}
              calledNums={calledNums} onCellClick={handleCellClick} onClaim={handleClaim} onActivate={handleActivate}
              winStates={winStates} bankruptCount={bankruptCount} timer={timer} totalTimer={totalTimer} liveBank={liveBank}/>
          ))}
        </div>

        {totalPages>1&&(
          <div style={{display:'flex',justifyContent:'center',gap:6,marginTop:12}}>
            {Array.from({length:totalPages},(_,i)=>(
              <button key={i} onClick={()=>setDevicePage(i)} style={{width:8,height:8,borderRadius:'50%',border:'none',cursor:'pointer',padding:0,background:i===devicePage?'#00e5a0':'#1e3a5f',boxShadow:i===devicePage?'0 0 6px #00e5a0':'none'}}/>
            ))}
          </div>
        )}
      </div>

      {announcement&&(
        <div style={{position:'fixed',top:52,left:'50%',transform:'translateX(-50%)',background:'#020d1a',border:'1px solid #00e5a040',borderRadius:10,padding:'9px 18px',fontFamily:'"DM Mono",monospace',fontSize:10,color:'#00e5a0',zIndex:999,whiteSpace:'pre',boxShadow:'0 8px 24px rgba(0,0,0,0.5)',animation:'slideDown 0.3s ease'}}>
          {announcement}
        </div>
      )}
    </div>
  )
}
