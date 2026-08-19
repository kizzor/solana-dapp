'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────
type RegistryState = {
  authority: string
  treasury: string
  currentSessionId: string
  paused: boolean
  pauseEndMs: number
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#020a14',
  color: '#dce6f3',
  fontFamily: 'DM Mono,monospace',
}
const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg,#0d1a2e,#060e1a)',
  border: '1px solid #1e3a5f',
  borderRadius: 12,
  padding: '14px 16px',
  marginBottom: 12,
}
const btnBase: React.CSSProperties = {
  fontFamily: 'DM Mono,monospace',
  fontSize: 10,
  cursor: 'pointer',
  borderRadius: 8,
  padding: '8px 16px',
  fontWeight: 700,
  border: 'none',
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0a1628',
  border: '1px solid #0a2535',
  borderRadius: 6,
  padding: '8px 10px',
  fontFamily: 'DM Mono,monospace',
  fontSize: 9,
  color: '#dce6f3',
  outline: 'none',
  boxSizing: 'border-box',
}

export default function AdminPage() {
  const [secret, setSecret] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [registry, setRegistry] = useState<RegistryState | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [actionLoading, setActionLoading] = useState('')

  // ── Pause form ──────────────────────────────────────────────────────────
  const [pauseHours, setPauseHours] = useState(1)
  const [pauseMinutes, setPauseMinutes] = useState(0)

  // ── Treasury form ───────────────────────────────────────────────────────
  const [newTreasury, setNewTreasury] = useState('')

  // ── Fetch registry state ────────────────────────────────────────────────
  const fetchRegistry = useCallback(async () => {
    if (!secret) return
    setLoading(true)
    try {
      const r = await fetch('/api/admin', {
        headers: { Authorization: `Bearer ${secret}` },
      })
      const d = await r.json()
      if (d.ok) {
        setRegistry(d)
        setAuthenticated(true)
      } else {
        setMsg(`❌ ${d.error}`)
        setAuthenticated(false)
      }
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [secret])

  // ── Auto-fetch on auth ──────────────────────────────────────────────────
  useEffect(() => {
    if (authenticated) fetchRegistry()
  }, [authenticated, fetchRegistry])

  // ── Admin action ────────────────────────────────────────────────────────
  const doAction = async (action: string, params: Record<string, any> = {}) => {
    setActionLoading(action)
    setMsg('')
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ action, ...params }),
      })
      const d = await r.json()
      if (d.ok) {
        setMsg(`✅ ${action} succeeded — digest: ${d.digest?.slice(0, 10)}…`)
        fetchRegistry() // refresh state
      } else {
        setMsg(`❌ ${action} failed: ${d.error}`)
      }
    } catch (e: any) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setActionLoading('')
    }
  }

  // ── Login form ──────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
          <div style={{ maxWidth: 400, width: '100%', padding: 20 }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>
              <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 800, color: '#f59e0b' }}>
                ADMIN ACCESS
              </div>
              <div style={{ fontSize: 8, color: '#4a7fa5', marginTop: 4 }}>
                RANSOME NETWORK — Turbulent Operations
              </div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 8, color: '#4a7fa5', marginBottom: 6 }}>ADMIN SECRET</div>
              <input
                type="password"
                placeholder="Enter admin secret"
                value={secret}
                onChange={e => setSecret(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchRegistry()}
                style={inputStyle}
              />
              <button
                onClick={fetchRegistry}
                disabled={!secret || loading}
                style={{
                  ...btnBase,
                  width: '100%',
                  marginTop: 10,
                  background: loading ? '#0a1628' : 'linear-gradient(135deg,#f59e0b,#d97706)',
                  color: loading ? '#4a7fa5' : '#000',
                  padding: '10px',
                }}
              >
                {loading ? '...' : 'AUTHENTICATE →'}
              </button>
              {msg && (
                <div style={{ marginTop: 8, fontSize: 8, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444', textAlign: 'center' }}>
                  {msg}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Admin dashboard ─────────────────────────────────────────────────────
  const pauseEndLeft = registry?.pauseEndMs ? Math.max(0, registry.pauseEndMs - Date.now()) : 0
  const fmtDuration = (ms: number) => {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    return `${h}h ${m}m`
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(180deg, #0d1a2e, #060e1a)',
        borderBottom: '2px solid #f59e0b',
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 800, color: '#f59e0b' }}>
            ⚡ TURBULENT ADMIN
          </div>
          <div style={{ fontSize: 8, color: '#4a7fa5' }}>
            RANSOME NETWORK — Operations Control
          </div>
        </div>
        <button onClick={() => { setAuthenticated(false); setRegistry(null); setSecret('') }}
          style={{ ...btnBase, background: '#0a1628', border: '1px solid #1e3a5f', color: '#4a7fa5', padding: '6px 10px', fontSize: 8 }}>
          LOGOUT
        </button>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '16px 12px' }}>
        {/* Status message */}
        {msg && (
          <div style={{
            background: msg.startsWith('✅') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${msg.startsWith('✅') ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            borderRadius: 8, padding: '10px 14px', marginBottom: 12,
            fontSize: 9, color: msg.startsWith('✅') ? '#22c55e' : '#ef4444',
          }}>
            {msg}
          </div>
        )}

        {/* Registry Info */}
        <div style={cardStyle}>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 10, color: '#f59e0b', marginBottom: 10, letterSpacing: '0.05em' }}>
            📊 GAME STATE
          </div>
          {loading ? (
            <div style={{ fontSize: 9, color: '#4a7fa5' }}>Loading...</div>
          ) : registry ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <InfoRow label="Status" value={registry.paused ? '🔴 PAUSED' : '🟢 ACTIVE'} color={registry.paused ? '#ef4444' : '#22c55e'} />
              {registry.paused && pauseEndLeft > 0 && (
                <InfoRow label="Resumes in" value={fmtDuration(pauseEndLeft)} color="#f59e0b" />
              )}
              {registry.paused && registry.pauseEndMs === 0 && (
                <InfoRow label="Pause" value="Indefinite (manual resume)" color="#f59e0b" />
              )}
              <InfoRow label="Authority" value={registry.authority?.slice(0, 16) + '…'} />
              <InfoRow label="Treasury" value={registry.treasury?.slice(0, 16) + '…'} />
              <InfoRow label="Session" value={registry.currentSessionId?.slice(0, 16) + '…'} />
            </div>
          ) : null}
          <button onClick={fetchRegistry} disabled={loading}
            style={{ ...btnBase, background: '#0a1628', border: '1px solid #1e3a5f', color: '#4a7fa5', marginTop: 10, padding: '6px 12px', fontSize: 8 }}>
            ↻ REFRESH
          </button>
        </div>

        {/* Pause/Resume */}
        <div style={cardStyle}>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 10, color: '#f59e0b', marginBottom: 10, letterSpacing: '0.05em' }}>
            ⏸ PAUSE / RESUME
          </div>
          <div style={{ fontSize: 8, color: '#4a7fa5', marginBottom: 10 }}>
            Pause the game to show "Under Construction" to all players.
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 7, color: '#1e4a6a', marginBottom: 3 }}>HOURS</div>
              <input type="number" value={pauseHours} onChange={e => setPauseHours(Math.max(0, parseInt(e.target.value) || 0))}
                style={{ ...inputStyle, width: 60, textAlign: 'center' }} />
            </div>
            <div>
              <div style={{ fontSize: 7, color: '#1e4a6a', marginBottom: 3 }}>MINUTES</div>
              <input type="number" value={pauseMinutes} onChange={e => setPauseMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                style={{ ...inputStyle, width: 60, textAlign: 'center' }} />
            </div>
            <div style={{ fontSize: 7, color: '#4a7fa5', alignSelf: 'flex-end', paddingBottom: 4 }}>
              = {pauseHours}h {pauseMinutes}m pause
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => doAction('pause', { durationMs: (pauseHours * 3600 + pauseMinutes * 60) * 1000 })}
              disabled={!!actionLoading || registry?.paused}
              style={{
                ...btnBase, flex: 1, padding: '10px',
                background: registry?.paused ? '#0a1628' : 'linear-gradient(135deg,#ef4444,#dc2626)',
                color: registry?.paused ? '#3f1010' : '#fff',
                opacity: registry?.paused ? 0.5 : 1,
                cursor: registry?.paused ? 'default' : 'pointer',
              }}>
              {actionLoading === 'pause' ? '...' : '⏸ PAUSE'}
            </button>
            <button onClick={() => doAction('resume')}
              disabled={!!actionLoading || !registry?.paused}
              style={{
                ...btnBase, flex: 1, padding: '10px',
                background: !registry?.paused ? '#0a1628' : 'linear-gradient(135deg,#22c55e,#16a34a)',
                color: !registry?.paused ? '#1a3f1a' : '#fff',
                opacity: !registry?.paused ? 0.5 : 1,
                cursor: !registry?.paused ? 'default' : 'pointer',
              }}>
              {actionLoading === 'resume' ? '...' : '▶ RESUME'}
            </button>
          </div>
        </div>

        {/* Change Treasury */}
        <div style={cardStyle}>
          <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 10, color: '#f59e0b', marginBottom: 10, letterSpacing: '0.05em' }}>
            💰 CHANGE TREASURY
          </div>
          <div style={{ fontSize: 8, color: '#4a7fa5', marginBottom: 10 }}>
            Change the treasury wallet that receives unclaimed funds and fees.
            <br /><strong style={{ color: '#ef4444' }}>⚠ Requires OTP verification from 2 email addresses + phone.</strong>
          </div>
          <div style={{ fontSize: 8, color: '#4a7fa5', marginBottom: 6 }}>NEW TREASURY ADDRESS (0x...)</div>
          <input
            type="text"
            placeholder="0x..."
            value={newTreasury}
            onChange={e => setNewTreasury(e.target.value)}
            style={{ ...inputStyle, marginBottom: 10 }}
          />
          <button onClick={() => doAction('change-treasury', { newTreasury })}
            disabled={!newTreasury.startsWith('0x') || newTreasury.length < 20 || !!actionLoading}
            style={{
              ...btnBase, width: '100%', padding: '10px',
              background: 'linear-gradient(135deg,#f59e0b,#d97706)',
              color: '#000',
            }}>
            {actionLoading === 'change-treasury' ? '...' : '💰 CHANGE TREASURY →'}
          </button>
          <div style={{ fontSize: 7, color: '#1e4a6a', marginTop: 8, textAlign: 'center' }}>
            ⚠️ This is a sensitive operation. Verify the address carefully.
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #0d2035', padding: '12px 0', textAlign: 'center', fontSize: 7, color: '#1e4a6a' }}>
          RANSOME NETWORK — Turbulent Operations Panel
        </div>
      </div>
    </div>
  )
}

// ─── Helper Components ────────────────────────────────────────────────────────
function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #0d2035' }}>
      <span style={{ fontSize: 8, color: '#4a7fa5' }}>{label}</span>
      <span style={{ fontSize: 8, color: color || '#dce6f3', fontFamily: 'DM Mono,monospace', wordBreak: 'break-all', textAlign: 'right', maxWidth: '60%' }}>
        {value}
      </span>
    </div>
  )
}
