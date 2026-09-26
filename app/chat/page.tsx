'use client'
// ─── ORACLE UPLINK — AI chat powered by the local OmniRoute gateway ──────────
// Talks to /api/chat → OmniRoute (http://localhost:20128/v1, OpenAI-compatible).
// Default model `auto` = OmniRoute's virtual combo with auto-fallback across
// every connected provider. Gateway must be running (`omniroute` on :20128).

import React, { useState, useEffect, useRef, useCallback } from 'react'

type Msg = { role: 'user' | 'assistant'; content: string }
type ModelInfo = { id: string; owner: string; context: number | null }

export default function ChatPage() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [model, setModel] = useState('auto')
  const [online, setOnline] = useState<boolean | null>(null)
  const [statusNote, setStatusNote] = useState('ESTABLISHING UPLINK...')
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, busy])

  const loadModels = useCallback(async () => {
    setOnline(null)
    setStatusNote('ESTABLISHING UPLINK...')
    try {
      const res = await fetch('/api/chat')
      const data = await res.json()
      if (!res.ok || !data.online) throw new Error(data.error || 'gateway offline')
      setModels(data.models ?? [])
      setOnline(true)
      setStatusNote(`UPLINK ONLINE — ${data.models?.length ?? 0} MODELS ROUTED`)
    } catch (e) {
      setOnline(false)
      setStatusNote(`UPLINK DOWN — ${String(e instanceof Error ? e.message : e)}`)
    }
  }, [])

  useEffect(() => { loadModels() }, [loadModels])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)

    const history: Msg[] = [...messages, { role: 'user', content: text }]
    setMessages([...history, { role: 'assistant', content: '' }])

    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, model, stream: true }),
        signal: ctrl.signal,
      })
      const contentType = res.headers.get('content-type') ?? ''
      if (!res.ok || !contentType.includes('text/event-stream')) {
        const data = await res.json().catch(() => ({ error: String(res.status) }))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const s = line.trim()
          if (!s.startsWith('data:')) continue
          const payload = s.slice(5).trim()
          if (payload === '[DONE]') continue
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta) {
              acc += delta
              setMessages(p => {
                const next = [...p]
                next[next.length - 1] = { role: 'assistant', content: acc }
                return next
              })
            }
          } catch { /* partial frame — ignore */ }
        }
      }
      if (!acc) {
        setMessages(p => {
          const next = [...p]
          next[next.length - 1] = { role: 'assistant', content: '[empty response]' }
          return next
        })
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError'
      setMessages(p => {
        const next = [...p]
        const last = next[next.length - 1]
        const note = aborted ? '[aborted]' : `⛔ ${String(e instanceof Error ? e.message : e)}`
        if (last?.role === 'assistant' && !last.content) next[next.length - 1] = { role: 'assistant', content: note }
        else if (last?.role === 'assistant' && aborted) next[next.length - 1] = { ...last, content: last.content + ' [aborted]' }
        else next.push({ role: 'assistant', content: note })
        return next
      })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }, [input, busy, messages, model])

  const stop = () => abortRef.current?.abort()

  const comboModels = models.filter(m => m.owner === 'combo')
  const otherModels = models.filter(m => m.owner !== 'combo')

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 12px' }}>
      <div style={{ width: '100%', maxWidth: 860, display: 'flex', flexDirection: 'column', flex: 1, gap: 10, minHeight: 0 }}>

        {/* Header */}
        <div style={{ background: '#0e0819', border: '1px solid #241538', borderRadius: 14, padding: '14px 16px', boxShadow: '0 0 40px rgba(178,107,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: online === true ? '#b26bff' : online === false ? '#ff5c8a' : '#f59e0b', boxShadow: `0 0 10px ${online === true ? '#b26bff' : online === false ? '#ff5c8a' : '#f59e0b'}`, animation: 'dot 1.5s infinite' }} />
            <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 800, color: '#b26bff', textShadow: '0 0 20px #b26bff60' }}>ORACLE UPLINK</div>
            <select value={model} onChange={e => setModel(e.target.value)}
              style={{ background: '#150d24', border: '1px solid #241538', borderRadius: 8, padding: '6px 8px', fontFamily: 'DM Mono,monospace', fontSize: 10, color: '#c084fc', outline: 'none', cursor: 'pointer', maxWidth: 260 }}>
              {models.length === 0 && <option value="auto">auto</option>}
              {comboModels.length > 0 && (
                <optgroup label="◈ COMBOS — auto fallback">
                  {comboModels.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                </optgroup>
              )}
              {otherModels.length > 0 && (
                <optgroup label="◆ MODELS">
                  {otherModels.slice(0, 400).map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
                </optgroup>
              )}
            </select>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={loadModels} style={chipBtn('#150d24', '#a99bc4')}>RECONNECT</button>
              <button onClick={() => setMessages([])} style={chipBtn('#150d24', '#f59e0b')}>WIPE</button>
            </div>
          </div>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: online === true ? '#453071' : '#ff5c8a', marginTop: 8, letterSpacing: '0.12em' }}>{statusNote}</div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} style={{ flex: 1, minHeight: 320, overflowY: 'auto', background: '#0e0819', border: '1px solid #241538', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', fontFamily: 'DM Mono,monospace', color: '#453071', fontSize: 10, letterSpacing: '0.15em', lineHeight: 2.4 }}>
              <div style={{ fontSize: 30, color: '#2d1f4a', fontFamily: 'Syne,sans-serif', fontWeight: 800 }}>◇</div>
              CHANNEL OPEN — NO TRANSMISSIONS YET<br />
              ROUTED THROUGH LOCAL OMNIROUTE GATEWAY
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ maxWidth: '85%', alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 8, color: m.role === 'user' ? '#c084fc' : '#b26bff', marginBottom: 3, letterSpacing: '0.12em' }}>
                {m.role === 'user' ? '▶ YOU' : '◆ ORACLE'}{m.role === 'assistant' && busy && i === messages.length - 1 ? ' ▊' : ''}
              </div>
              <div style={{
                background: m.role === 'user' ? '#150d24' : '#120a1f',
                border: `1px solid ${m.role === 'user' ? '#2d1f4a' : '#241538'}`,
                borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                padding: '9px 12px', fontFamily: 'DM Mono,monospace', fontSize: 11,
                color: m.role === 'user' ? '#f8fafc' : '#e6dcff',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.7,
              }}>{m.content}</div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="TRANSMIT TO THE ORACLE...  (Enter = send · Shift+Enter = newline)"
            rows={2}
            disabled={busy || online === false}
            style={{ flex: 1, resize: 'none', background: '#0e0819', border: '1px solid #241538', borderRadius: 12, padding: '10px 12px', fontFamily: 'DM Mono,monospace', fontSize: 11, color: '#c084fc', outline: 'none', boxSizing: 'border-box', caretColor: '#b26bff' }}
          />
          {busy ? (
            <button onClick={stop} style={sendBtn('#f59e0b')}>ABORT</button>
          ) : (
            <button onClick={send} disabled={!input.trim() || online === false} style={sendBtn(input.trim() ? undefined : '#241538')}>TX →</button>
          )}
        </div>
      </div>
    </main>
  )
}

function chipBtn(bg: string, color: string): React.CSSProperties {
  return {
    background: bg, border: '1px solid #241538', borderRadius: 8, padding: '6px 10px',
    fontFamily: 'DM Mono,monospace', fontSize: 8, letterSpacing: '0.1em',
    color, cursor: 'pointer',
  }
}

function sendBtn(color?: string): React.CSSProperties {
  return {
    background: '#150d24', border: '1px solid #2d1f4a', borderRadius: 12, padding: '0 22px',
    fontFamily: 'DM Mono,monospace', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
    color: color ?? '#b26bff', cursor: 'pointer',
  }
}
