'use client'
import { useState } from 'react'
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'

const PID = 'CZmrXHfMXuP3uUPGApinsKH9dfQZVdNehAmsnpLqTw6d'
const RPC = 'https://api.devnet.solana.com'
const trunc = (a: string) => a.slice(0,6)+'...'+a.slice(-4)
const ACTIONS = [
  {id:0,key:'validate',label:'Validate Clickables',color:'#00e5a0',cat:'Device',desc:'Verify device clickable state via PDA',disc:[202,41,83,18,198,210,164,74]},
  {id:1,key:'claim',label:'Trigger Claim Window',color:'#00b8ff',cat:'Rewards',desc:'Open claim window in queue PDA',disc:[207,176,244,90,254,236,166,172]},
  {id:2,key:'distribute',label:'Distribute Payouts',color:'#f7c948',cat:'Finance',desc:'Execute payout distribution from bank PDA',disc:[226,196,33,224,8,117,184,243]},
  {id:3,key:'bankrupt',label:'Trigger Bankrupt Sequence',color:'#ff6b6b',cat:'Admin',desc:'Initiate bankruptcy sequence against bank',disc:[69,173,97,35,30,34,56,65]},
  {id:4,key:'trash',label:'Trash Devices',color:'#b47cf7',cat:'Device',desc:'Deregister and wipe device PDAs',disc:[98,104,235,118,235,56,81,63]},
]
export default function Home() {
  const [wallet, setWallet] = useState<string|null>(null)
  const [bal, setBal] = useState<number|null>(null)
  const [status, setStatus] = useState<Record<string,string>>(Object.fromEntries(ACTIONS.map(a=>[a.key,'idle'])))
  const [sigs, setSigs] = useState<Record<string,string>>({})
  const connect = async () => {
    const p = (window as any).solana
    if (!p?.isPhantom) { window.open('https://phantom.app/','_blank'); return }
    const r = await p.connect()
    const addr = r.publicKey.toString()
    setWallet(addr)
    try { const c = new Connection(RPC,'confirmed'); setBal((await c.getBalance(new PublicKey(addr)))/1e9) } catch {}
  }
  const disconnect = async () => { try { await (window as any).solana?.disconnect() } catch {}; setWallet(null); setBal(null) }
  const run = async (a: typeof ACTIONS[0]) => {
    if (!wallet) return
    const p = (window as any).solana
    const pid = new PublicKey(PID), user = new PublicKey(wallet)
    setStatus(s=>({...s,[a.key]:'signing'}))
    try {
      const conn = new Connection(RPC,'confirmed')
      let accounts: any[] = []
      if (a.id===0||a.id===4) {
        const [d] = await PublicKey.findProgramAddress([Buffer.from('device'),user.toBuffer()],pid)
        accounts = [{pubkey:d,isSigner:false,isWritable:true},{pubkey:user,isSigner:true,isWritable:false}]
      } else if (a.id===1) {
        const [q] = await PublicKey.findProgramAddress([Buffer.from('claim_queue')],pid)
        accounts = [{pubkey:q,isSigner:false,isWritable:true},{pubkey:user,isSigner:true,isWritable:false}]
      } else if (a.id===2) {
        const [d] = await PublicKey.findProgramAddress([Buffer.from('distribution')],pid)
        const [b] = await PublicKey.findProgramAddress([Buffer.from('bank')],pid)
        accounts = [{pubkey:d,isSigner:false,isWritable:true},{pubkey:b,isSigner:false,isWritable:false},{pubkey:user,isSigner:true,isWritable:false}]
      } else if (a.id===3) {
        const [b] = await PublicKey.findProgramAddress([Buffer.from('bank')],pid)
        accounts = [{pubkey:b,isSigner:false,isWritable:true},{pubkey:user,isSigner:true,isWritable:false}]
      }
      const tx = new Transaction().add(new TransactionInstruction({keys:accounts,programId:pid,data:Buffer.from(Uint8Array.of(...a.disc))}))
      tx.feePayer = user
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
      setStatus(s=>({...s,[a.key]:'sending'}))
      const signed = await p.signTransaction(tx)
      const sig = await conn.sendRawTransaction(signed.serialize())
      setStatus(s=>({...s,[a.key]:'confirming'}))
      await conn.confirmTransaction(sig)
      setStatus(s=>({...s,[a.key]:'done'}))
      setSigs(s=>({...s,[a.key]:sig}))
    } catch(e:any) { setStatus(s=>({...s,[a.key]:'error'})); alert(e?.message) }
  }
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#080c10;color:#e8f0f7;font-family:Syne,sans-serif;min-height:100vh}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        .fu{animation:fadeUp .5s ease both}
        .dot{width:7px;height:7px;border-radius:50%;background:#00e5a0;box-shadow:0 0 8px #00e5a0;display:inline-block;animation:blink 2s infinite}
        .cbtn{background:#00e5a0;color:#080c10;font-weight:700;border:none;padding:9px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-family:Syne,sans-serif}
        .cbtn:hover{opacity:.85}
        .wbtn{background:#141b22;border:1px solid rgba(255,255,255,.13);color:#e8f0f7;font-family:"DM Mono",monospace;font-size:12px;padding:6px 14px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:8px}
        .card{background:#0e1318;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:24px;transition:border-color .2s,transform .2s,box-shadow .2s}
        .card:hover{transform:translateY(-2px)}
        .tag{display:inline-block;font-family:"DM Mono",monospace;font-size:10px;padding:2px 7px;border-radius:4px;text-transform:uppercase;letter-spacing:.08em}
        .ebtn{width:100%;margin-top:14px;padding:11px 0;border-radius:8px;border:1px solid;background:transparent;font-family:"DM Mono",monospace;font-size:12px;letter-spacing:.1em;cursor:pointer;transition:background .2s,color .2s}
        .ebtn:hover:not(:disabled){color:#080c10!important}
        .ebtn:disabled{opacity:.4;cursor:not-allowed}
        footer{border-top:1px solid rgba(255,255,255,.07);padding:20px 32px;display:flex;justify-content:space-between;color:#4a5a6a;font-size:11px;font-family:"DM Mono",monospace;flex-wrap:wrap;gap:10px}
      `}</style>
      <header style={{position:'sticky',top:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 32px',height:64,background:'rgba(8,12,16,.9)',backdropFilter:'blur(20px)',borderBottom:'1px solid rgba(255,255,255,.07)'}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:32,height:32,borderRadius:8,background:'linear-gradient(135deg,#00e5a0,#00b8ff)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,color:'#080c10',fontSize:16}}>R</div>
          <span style={{fontSize:17,fontWeight:700,letterSpacing:'-.02em'}}>Ransome</span>
          <span style={{fontFamily:'"DM Mono",monospace',fontSize:11,background:'#141b22',border:'1px solid rgba(255,255,255,.07)',padding:'2px 8px',borderRadius:4,color:'#7a8fa6'}}>Devnet</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:11,color:'#4a5a6a',fontFamily:'"DM Mono",monospace',display:'flex',alignItems:'center',gap:6}}><span className="dot"/>LIVE</span>
          {wallet ? (
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              {bal!==null&&<span style={{fontFamily:'"DM Mono",monospace',fontSize:12,color:'#00e5a0',background:'rgba(0,229,160,.08)',border:'1px solid rgba(0,229,160,.2)',padding:'4px 10px',borderRadius:6}}>&#9678; {bal.toFixed(4)}</span>}
              <button className="wbtn" onClick={disconnect}><span style={{width:6,height:6,borderRadius:'50%',background:'#00e5a0',display:'inline-block'}}/>{trunc(wallet)}</button>
            </div>
          ) : <button className="cbtn" onClick={connect}>Connect Wallet</button>}
        </div>
      </header>
      <main style={{maxWidth:1100,margin:'0 auto',padding:'48px 24px 80px'}}>
        <div className="fu" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:24,marginBottom:56}}>
          <div>
            <div style={{fontSize:11,fontFamily:'"DM Mono",monospace',color:'#00e5a0',letterSpacing:'.15em',marginBottom:12,display:'flex',alignItems:'center',gap:8}}><span className="dot"/>SOLANA PROGRAM INTERFACE</div>
            <h1 style={{fontSize:'clamp(28px,5vw,48px)',fontWeight:800,lineHeight:1.1,letterSpacing:'-.03em',marginBottom:16}}>Ransome<br/><span style={{background:'linear-gradient(90deg,#00e5a0,#00b8ff)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>Protocol</span></h1>
            <p style={{color:'#7a8fa6',fontSize:14,lineHeight:1.7,maxWidth:420}}>On-chain device management and payout distribution on Solana Devnet.</p>
          </div>
          <div style={{background:'#0e1318',border:'1px solid rgba(255,255,255,.07)',borderRadius:16,padding:'18px 22px',minWidth:260}}>
            <div style={{fontSize:10,fontFamily:'"DM Mono",monospace',color:'#4a5a6a',letterSpacing:'.1em',marginBottom:8}}>PROGRAM ID</div>
            <div style={{fontFamily:'"DM Mono",monospace',fontSize:11,color:'#7a8fa6',wordBreak:'break-all',lineHeight:1.6}}>{PID}</div>
            <a href={`https://explorer.solana.com/address/${PID}?cluster=devnet`} target="_blank" rel="noopener" style={{fontSize:11,color:'#00b8ff',fontFamily:'"DM Mono",monospace',textDecoration:'none',display:'inline-block',marginTop:10}}>View on Explorer &#8599;</a>
          </div>
        </div>
        {!wallet && (
          <div className="fu" style={{textAlign:'center',padding:'80px 24px',background:'#0e1318',border:'1px solid rgba(255,255,255,.07)',borderRadius:20,marginBottom:48}}>
            <div style={{fontSize:56,marginBottom:24}}>&#9678;</div>
            <h2 style={{fontSize:22,fontWeight:700,marginBottom:12}}>Connect to Get Started</h2>
            <p style={{color:'#7a8fa6',fontSize:14,marginBottom:32}}>Link your Phantom wallet to access all 5 on-chain program instructions.</p>
            <button className="cbtn" style={{padding:'14px 28px',fontSize:14,borderRadius:10,boxShadow:'0 0 32px rgba(0,229,160,.3)'}} onClick={connect}>Connect Phantom Wallet</button>
          </div>
        )}
        {wallet && (
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:40}}>
              {[{l:'WALLET',v:trunc(wallet),c:'#00e5a0'},{l:'BALANCE',v:bal!==null?`&#9678; ${bal.toFixed(4)}`:'--',c:'#00b8ff'},{l:'NETWORK',v:'Devnet',c:'#e8f0f7'},{l:'PROGRAM',v:trunc(PID),c:'#7a8fa6'}].map(s=>(
                <div key={s.l} style={{background:'#0e1318',border:'1px solid rgba(255,255,255,.07)',borderRadius:12,padding:'16px 20px'}}>
                  <div style={{fontSize:10,fontFamily:'"DM Mono",monospace',color:'#4a5a6a',letterSpacing:'.1em',marginBottom:6}}>{s.l}</div>
                  <div style={{fontFamily:'"DM Mono",monospace',fontSize:14,fontWeight:500,color:s.c}}>{s.v}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:11,fontFamily:'"DM Mono",monospace',color:'#4a5a6a',letterSpacing:'.12em',marginBottom:20}}>PROGRAM INSTRUCTIONS</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:16}}>
              {ACTIONS.map(a=>{
                const st=status[a.key]; const sig=sigs[a.key]
                const loading=['signing','sending','confirming'].includes(st)
                return (
                  <div key={a.key} className="card" style={{borderColor:st==='done'?a.color+'55':'rgba(255,255,255,.07)',boxShadow:st==='done'?`0 0 24px ${a.color}22`:'none'}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:18}}>
                      <span className="tag" style={{color:a.color,background:a.color+'18',border:`1px solid ${a.color}40`}}>{a.cat}</span>
                      <span style={{fontSize:11,fontFamily:'"DM Mono",monospace',color:'#4a5a6a'}}>#{String(a.id).padStart(2,'0')}</span>
                    </div>
                    <div style={{fontSize:15,fontWeight:700,marginBottom:6,letterSpacing:'-.01em'}}>{a.label}</div>
                    <div style={{fontSize:12,color:'#7a8fa6',lineHeight:1.5,marginBottom:14}}>{a.desc}</div>
                    {st==='done'&&sig&&<div style={{marginBottom:8,fontSize:11}}><a href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`} target="_blank" rel="noopener" style={{color:a.color,fontFamily:'"DM Mono",monospace',textDecoration:'none'}}>&#10003; Confirmed &middot; View &#8599;</a></div>}
                    {st==='error'&&<div style={{fontSize:11,color:'#ff6b6b',marginBottom:8,fontFamily:'"DM Mono",monospace'}}>Transaction failed</div>}
                    <button className="ebtn" disabled={loading||st==='done'} onClick={()=>run(a)} style={{borderColor:a.color,color:st==='done'?'#080c10':a.color,background:st==='done'?a.color:'transparent'}}>
                      {loading?`${st.toUpperCase()}...`:st==='done'?'EXECUTED':`EXECUTE`}
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </main>
      <footer><span>RANSOME PROTOCOL &middot; SOLANA DEVNET</span><span>{PID.slice(0,18)}...</span></footer>
    </>
  )
}
