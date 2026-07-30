'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────
type Suggestion = {
  id: string
  title: string
  description: string
  author: string
  authorSol?: string
  status: 'pending' | 'active' | 'passed' | 'rejected'
  votesFor: number
  votesAgainst: number
  totalDelegatedVoters: number
  createdAt: number
  voteEndsAt: number
  voters: Record<string, 'for' | 'against'>
}

// ─── Helper Components ────────────────────────────────────────────────────────
function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: '#030a12', border: '1px solid #0d2035', borderRadius: 8, padding: '10px 14px', textAlign: 'center', flex: 1 }}>
      <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 7, color: '#4a7fa5', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 22, fontWeight: 800, color: color || '#00e5a0' }}>{value}</div>
    </div>
  )
}

function ProgressBar({ for: f, against, total }: { for: number; against: number; total: number }) {
  const fPct = total > 0 ? (f / total) * 100 : 0
  const aPct = total > 0 ? (against / total) * 100 : 0
  return (
    <div style={{ width: '100%', height: 6, background: '#0a1628', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
      <div style={{ height: '100%', width: `${fPct}%`, background: '#22c55e', borderRadius: '3px 0 0 3px', transition: 'width 0.5s ease' }} />
      <div style={{ flex: 1 }} />
      <div style={{ height: '100%', width: `${aPct}%`, background: '#ef4444', borderRadius: '0 3px 3px 0', transition: 'width 0.5s ease' }} />
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function GovernancePage() {
  const router = useRouter()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'proposals' | 'create' | 'delegate'>('proposals')
  const [wallet, setWallet] = useState('')
  const [solAddress, setSolAddress] = useState('')
  const [mtrxDelegated, setMtrxDelegated] = useState(false)
  const [mtrxBalance, setMtrxBalance] = useState(0)
  const [checkingDelegation, setCheckingDelegation] = useState(false)

  // ── New suggestion form ──────────────────────────────────────────────────────
  const [newTitle, setNewTitle] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newVoteHours, setNewVoteHours] = useState(72)
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')

  // ── Voting ───────────────────────────────────────────────────────────────────
  const [votingId, setVotingId] = useState<string | null>(null)

  // ── Load suggestions ─────────────────────────────────────────────────────────
  const loadSuggestions = useCallback(async () => {
    try {
      const r = await fetch('/api/governance')
      if (r.ok) {
        const d = await r.json()
        if (d.ok) setSuggestions(d.suggestions)
      }
    } catch {} finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadSuggestions() }, [loadSuggestions])

  // ── Check MTRX delegation ────────────────────────────────────────────────────
  const checkDelegation = useCallback(async () => {
    if (!solAddress || solAddress.length < 32) return
    setCheckingDelegation(true)
    try {
      const r = await fetch('/api/check-mtrx-delegation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: solAddress }),
      })
      if (r.ok) {
        const d = await r.json()
        if (d.ok) {
          setMtrxDelegated(d.delegated)
          setMtrxBalance(d.balance)
        }
      }
    } catch {} finally {
      setCheckingDelegation(false)
    }
  }, [solAddress])

  // ── Submit suggestion ────────────────────────────────────────────────────────
  const submitSuggestion = async () => {
    if (!wallet || !mtrxDelegated) {
      setSubmitMsg('You must delegate 1,000 MTRX to submit a proposal')
      return
    }
    if (newTitle.length < 5 || newDesc.length < 20) {
      setSubmitMsg('Title (5+ chars) and description (20+ chars) required')
      return
    }
    setSubmitting(true)
    setSubmitMsg('')
    try {
      const r = await fetch('/api/governance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          description: newDesc,
          author: wallet,
          authorSol: solAddress || undefined,
          voteDurationHours: newVoteHours,
        }),
      })
      const d = await r.json()
      if (d.ok) {
        setSubmitMsg('✅ Proposal submitted!')
        setNewTitle('')
        setNewDesc('')
        setNewVoteHours(72)
        loadSuggestions()
        setTimeout(() => setSubmitMsg(''), 3000)
      } else {
        setSubmitMsg(`❌ ${d.error}`)
      }
    } catch (e: any) {
      setSubmitMsg(`❌ ${e.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Cast vote ────────────────────────────────────────────────────────────────
  const castVote = async (suggestionId: string, vote: 'for' | 'against') => {
    if (!wallet || !mtrxDelegated) return
    setVotingId(suggestionId)
    try {
      const r = await fetch('/api/governance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestionId, voter: wallet, vote }),
      })
      const d = await r.json()
      if (d.ok) loadSuggestions()
    } catch {} finally {
      setVotingId(null)
    }
  }

  // ── Format time remaining ────────────────────────────────────────────────────
  const timeRemaining = (endAt: number) => {
    const left = endAt - Date.now()
    if (left <= 0) return 'Ended'
    const h = Math.floor(left / 3600000)
    const m = Math.floor((left % 3600000) / 60000)
    return `${h}h ${m}m`
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#020a14',
    color: '#dce6f3',
    fontFamily: 'DM Mono,monospace',
  }

  const headerStyle: React.CSSProperties = {
    background: 'linear-gradient(180deg, #0d1a2e, #060e1a)',
    borderBottom: '2px solid #1e3a5f',
    padding: '16px 20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
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

  const cardStyle: React.CSSProperties = {
    background: 'linear-gradient(180deg,#0d1a2e,#060e1a)',
    border: '1px solid #1e3a5f',
    borderRadius: 12,
    padding: '14px 16px',
    marginBottom: 12,
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/')} style={{ ...btnBase, background: 'transparent', color: '#4a7fa5', border: '1px solid #1e3a5f', padding: '6px 10px', fontSize: 9 }}>
            ← LOBBY
          </button>
          <div>
            <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 800, color: '#00e5a0' }}>◈ GOVERNANCE</div>
            <div style={{ fontSize: 8, color: '#4a7fa5' }}>MATRIX (MTRX) — Proposal & Voting System</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 8, color: '#4a7fa5' }}>{wallet ? wallet.slice(0, 6) + '...' : 'Not connected'}</div>
          {mtrxDelegated && (
            <div style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, padding: '4px 8px', fontSize: 8, color: '#22c55e' }}>
              ✓ DELEGATED
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '16px 12px' }}>
        {/* Stats bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <StatBox label="Total Proposals" value={suggestions.length} color="#4da6ff" />
          <StatBox label="Active" value={suggestions.filter(s => s.status === 'active').length} color="#22c55e" />
          <StatBox label="Passed" value={suggestions.filter(s => s.status === 'passed').length} color="#a855f7" />
          <StatBox label="MTRX Balance" value={mtrxBalance > 0 ? `${mtrxBalance.toFixed(1)}` : '—'} color="#f59e0b" />
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {([
            ['proposals', '◈ PROPOSALS'],
            ['create', '✚ CREATE'],
            ['delegate', '⛓ DELEGATE'],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              ...btnBase, flex: 1, padding: '10px 6px', fontSize: 9,
              background: tab === k ? '#0a2a4a' : 'transparent',
              color: tab === k ? '#00e5a0' : '#2a5a7a',
              border: `1px solid ${tab === k ? '#00e5a040' : '#0a2535'}`,
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── DELEGATE TAB ────────────────────────────────────────────────── */}
        {tab === 'delegate' && (
          <div style={cardStyle}>
            <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 10, color: '#00e5a0', marginBottom: 12, letterSpacing: '0.05em' }}>
              ⛓ MTRX DELEGATION
            </div>
            <div style={{ fontSize: 8, color: '#4a7fa5', lineHeight: 1.6, marginBottom: 12 }}>
              Delegate 1,000 MTRX tokens to the governance vault to unlock:
              <br />• <strong style={{ color: '#22c55e' }}>50% discount</strong> on minting hacking devices ($0.25 instead of $0.50)
              <br />• <strong style={{ color: '#a855f7' }}>Voting rights</strong> in governance proposals
              <br />• <strong style={{ color: '#f59e0b' }}>Create proposals</strong> for the community
              <br /><br />
              No lockup — withdraw anytime. Your MTRX stays in your wallet; we verify your balance on-chain.
              <br /><br />
              <strong>Delegation vault (Solana):</strong>
              <br />
              <span style={{ color: '#4da6ff', fontSize: 7, wordBreak: 'break-all' }}>
                {process.env.NEXT_PUBLIC_MTRX_DELEGATION_VAULT || 'VAULT_PLACEHOLDER_ADDRESS'}
              </span>
              <br /><br />
              <em style={{ color: '#1e4a6a' }}>Send exactly 1,000 MTRX to the above address to delegate. MTRX contract address will be provided by the team.</em>
            </div>

            <div style={{ background: '#030a12', border: '1px solid #0d2035', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: 8, color: '#4a7fa5', marginBottom: 6 }}>CHECK YOUR DELEGATION STATUS</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Enter your Solana wallet address"
                  value={solAddress}
                  onChange={e => setSolAddress(e.target.value)}
                  style={{
                    flex: 1,
                    background: '#0a1628',
                    border: '1px solid #0a2535',
                    borderRadius: 6,
                    padding: '8px 10px',
                    fontFamily: 'DM Mono,monospace',
                    fontSize: 8,
                    color: '#00e5a0',
                    outline: 'none',
                  }}
                />
                <button onClick={checkDelegation} disabled={checkingDelegation || solAddress.length < 32} style={{
                  ...btnBase,
                  background: 'linear-gradient(135deg,#a855f7,#7c3aed)',
                  color: '#fff',
                  padding: '8px 14px',
                  fontSize: 8,
                  opacity: checkingDelegation ? 0.5 : 1,
                }}>
                  {checkingDelegation ? '...' : 'CHECK'}
                </button>
              </div>
              {mtrxBalance > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontSize: 9, color: mtrxDelegated ? '#22c55e' : '#f59e0b' }}>
                    {mtrxDelegated
                      ? `✓ Delegated — ${mtrxBalance.toFixed(2)} MTRX`
                      : `⚠ ${mtrxBalance.toFixed(2)} MTRX (need 1,000)`}
                  </div>
                  {!mtrxDelegated && mtrxBalance > 0 && (
                    <div style={{ fontSize: 7, color: '#4a7fa5' }}>
                      You have {mtrxBalance.toFixed(2)} MTRX. Send {Math.max(0, 1000 - mtrxBalance).toFixed(2)} more to reach 1,000.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── CREATE TAB ──────────────────────────────────────────────────── */}
        {tab === 'create' && (
          <div style={cardStyle}>
            <div style={{ fontFamily: 'DM Mono,monospace', fontSize: 10, color: '#00e5a0', marginBottom: 6, letterSpacing: '0.05em' }}>
              ✚ NEW PROPOSAL
            </div>
            <div style={{ fontSize: 8, color: '#1e4a6a', marginBottom: 14 }}>
              Submit a suggestion for the community to vote on. You must have 1,000+ MTRX delegated.
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#4a7fa5', marginBottom: 4 }}>YOUR WALLET (SUI)</div>
              <input
                type="text"
                placeholder="0x..."
                value={wallet}
                onChange={e => setWallet(e.target.value)}
                style={{
                  width: '100%',
                  background: '#0a1628',
                  border: '1px solid #0a2535',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontFamily: 'DM Mono,monospace',
                  fontSize: 8,
                  color: '#00e5a0',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#4a7fa5', marginBottom: 4 }}>SOLANA ADDRESS (for MTRX verification)</div>
              <input
                type="text"
                placeholder="Your Solana address with delegated MTRX"
                value={solAddress}
                onChange={e => setSolAddress(e.target.value)}
                style={{
                  width: '100%',
                  background: '#0a1628',
                  border: '1px solid #0a2535',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontFamily: 'DM Mono,monospace',
                  fontSize: 8,
                  color: '#00e5a0',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#4a7fa5', marginBottom: 4 }}>TITLE</div>
              <input
                type="text"
                placeholder="e.g. Increase Full House 3 Jackpot to 45%"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                style={{
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
                }}
              />
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 8, color: '#4a7fa5', marginBottom: 4 }}>DESCRIPTION</div>
              <textarea
                placeholder="Describe your proposal in detail..."
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  background: '#0a1628',
                  border: '1px solid #0a2535',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontFamily: 'DM Mono,monospace',
                  fontSize: 8,
                  color: '#dce6f3',
                  outline: 'none',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 8, color: '#4a7fa5', marginBottom: 4 }}>VOTING DURATION (hours)</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[24, 48, 72, 168].map(h => (
                  <button key={h} onClick={() => setNewVoteHours(h)} style={{
                    ...btnBase, padding: '6px 12px', fontSize: 8,
                    background: newVoteHours === h ? '#0a3a5a' : 'transparent',
                    color: newVoteHours === h ? '#00e5a0' : '#2a5a7a',
                    border: `1px solid ${newVoteHours === h ? '#00e5a040' : '#0a2535'}`,
                  }}>{h}h</button>
                ))}
                <input
                  type="number"
                  value={newVoteHours}
                  onChange={e => setNewVoteHours(Math.max(1, parseInt(e.target.value) || 72))}
                  style={{
                    width: 60,
                    background: '#0a1628',
                    border: '1px solid #0a2535',
                    borderRadius: 6,
                    padding: '6px 8px',
                    fontFamily: 'DM Mono,monospace',
                    fontSize: 8,
                    color: '#00e5a0',
                    outline: 'none',
                    textAlign: 'center',
                  }}
                />
              </div>
            </div>

            <button onClick={submitSuggestion} disabled={submitting || !mtrxDelegated} style={{
              ...btnBase,
              width: '100%',
              background: submitting ? '#0a1628' : 'linear-gradient(135deg,#a855f7,#7c3aed)',
              color: submitting ? '#2a5a7a' : '#fff',
              padding: '12px',
              fontSize: 11,
              opacity: (!mtrxDelegated || submitting) ? 0.5 : 1,
              cursor: (!mtrxDelegated || submitting) ? 'default' : 'pointer',
            }}>
              {!mtrxDelegated ? 'DELEGATE 1K MTRX TO PROPOSE' : submitting ? 'SUBMITTING...' : 'SUBMIT PROPOSAL →'}
            </button>

            {submitMsg && (
              <div style={{ marginTop: 8, fontSize: 8, color: submitMsg.includes('✅') ? '#22c55e' : '#ef4444', textAlign: 'center' }}>
                {submitMsg}
              </div>
            )}
          </div>
        )}

        {/* ── PROPOSALS TAB ────────────────────────────────────────────────── */}
        {tab === 'proposals' && (
          <div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, fontSize: 8, color: '#1e4a6a' }}>Loading proposals...</div>
            ) : suggestions.length === 0 ? (
              <div style={cardStyle}>
                <div style={{ textAlign: 'center', padding: 30 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>🗳</div>
                  <div style={{ fontSize: 9, color: '#4a7fa5', marginBottom: 4 }}>No proposals yet</div>
                  <div style={{ fontSize: 7, color: '#1e4a6a' }}>
                    Delegate 1,000 MTRX and be the first to submit a proposal!
                  </div>
                </div>
              </div>
            ) : (
              suggestions.slice().reverse().map(s => {
                const isActive = s.status === 'active' || s.status === 'pending'
                const hasVoted = !!s.voters[wallet]
                const userVote = s.voters[wallet]
                const totalVotes = s.votesFor + s.votesAgainst
                const timeLeft = timeRemaining(s.voteEndsAt)

                return (
                  <div key={s.id} style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontFamily: 'Syne,sans-serif', fontSize: 13, fontWeight: 700, color: '#dce6f3' }}>{s.title}</span>
                          <span style={{
                            fontSize: 7, padding: '2px 6px', borderRadius: 4,
                            background: s.status === 'passed' ? 'rgba(168,85,247,0.15)' :
                              s.status === 'active' ? 'rgba(34,197,94,0.15)' :
                              s.status === 'rejected' ? 'rgba(239,68,68,0.15)' : 'rgba(79,170,255,0.15)',
                            color: s.status === 'passed' ? '#a855f7' :
                              s.status === 'active' ? '#22c55e' :
                              s.status === 'rejected' ? '#ef4444' : '#4da6ff',
                            textTransform: 'uppercase',
                          }}>
                            {s.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 7.5, color: '#4a7fa5', lineHeight: 1.5, marginBottom: 6 }}>{s.description}</div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 7, color: '#1e4a6a' }}>
                          <span>By {s.author.slice(0, 6)}...{s.author.slice(-4)}</span>
                          <span>⏱ {timeLeft}</span>
                          <span>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    </div>

                    {/* Vote bar */}
                    <div style={{ marginBottom: 8 }}>
                      <ProgressBar for={s.votesFor} against={s.votesAgainst} total={totalVotes} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: '#4a7fa5', marginTop: 3 }}>
                        <span style={{ color: '#22c55e' }}>{s.votesFor} FOR</span>
                        <span style={{ color: '#ef4444' }}>{s.votesAgainst} AGAINST</span>
                      </div>
                    </div>

                    {/* Vote buttons */}
                    {isActive && mtrxDelegated && !hasVoted && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => castVote(s.id, 'for')} disabled={votingId === s.id} style={{
                          ...btnBase, flex: 1, padding: '8px', fontSize: 8,
                          background: 'rgba(34,197,94,0.1)',
                          color: '#22c55e',
                          border: '1px solid rgba(34,197,94,0.3)',
                          opacity: votingId === s.id ? 0.5 : 1,
                        }}>
                          {votingId === s.id ? '...' : '✓ VOTE FOR'}
                        </button>
                        <button onClick={() => castVote(s.id, 'against')} disabled={votingId === s.id} style={{
                          ...btnBase, flex: 1, padding: '8px', fontSize: 8,
                          background: 'rgba(239,68,68,0.1)',
                          color: '#ef4444',
                          border: '1px solid rgba(239,68,68,0.3)',
                          opacity: votingId === s.id ? 0.5 : 1,
                        }}>
                          {votingId === s.id ? '...' : '✕ VOTE AGAINST'}
                        </button>
                      </div>
                    )}
                    {isActive && hasVoted && (
                      <div style={{ fontSize: 8, color: userVote === 'for' ? '#22c55e' : '#ef4444', textAlign: 'center', padding: 6 }}>
                        You voted <strong>{userVote === 'for' ? 'FOR' : 'AGAINST'}</strong>
                      </div>
                    )}
                    {isActive && !mtrxDelegated && (
                      <div style={{ fontSize: 7, color: '#f59e0b', textAlign: 'center', padding: 6 }}>
                        Delegate 1,000 MTRX to vote on this proposal
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid #0d2035', padding: '12px 20px', textAlign: 'center', fontSize: 7, color: '#1e4a6a' }}>
        MATRIX (MTRX) Governance — Your voice in the RANSOME ecosystem
      </div>
    </div>
  )
}
