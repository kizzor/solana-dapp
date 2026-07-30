export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

// ─── Types ────────────────────────────────────────────────────────────────────
export type Suggestion = {
  id: string
  title: string
  description: string
  author: string        // SUI wallet address
  authorSol?: string    // Solana wallet (if provided)
  status: 'pending' | 'active' | 'passed' | 'rejected'
  votesFor: number
  votesAgainst: number
  totalDelegatedVoters: number  // How many eligible voters could vote
  createdAt: number
  voteEndsAt: number
  voters: Record<string, 'for' | 'against'> // address -> vote
}

// ─── Data Store ───────────────────────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), '.governance_data')
const DATA_FILE = path.join(DATA_DIR, 'suggestions.json')

async function ensureDataDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }) } catch {}
}

async function loadSuggestions(): Promise<Suggestion[]> {
  try {
    await ensureDataDir()
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function saveSuggestions(suggestions: Suggestion[]) {
  await ensureDataDir()
  await fs.writeFile(DATA_FILE, JSON.stringify(suggestions, null, 2), 'utf-8')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/governance
 * Returns all suggestions
 */
export async function GET() {
  try {
    const suggestions = await loadSuggestions()
    return NextResponse.json({ ok: true, suggestions })
  } catch (e: any) {
    console.error('Governance GET error:', e.message)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

/**
 * POST /api/governance
 * Create a new suggestion (author must have delegated MTRX — checked client-side)
 * Body: { title, description, author, authorSol?, voteDurationHours? }
 */
export async function POST(req: Request) {
  try {
    const { title, description, author, authorSol, voteDurationHours } = await req.json()

    if (!title || typeof title !== 'string' || title.length < 5) {
      return NextResponse.json({ ok: false, error: 'Title must be at least 5 characters' }, { status: 400 })
    }
    if (!description || typeof description !== 'string' || description.length < 20) {
      return NextResponse.json({ ok: false, error: 'Description must be at least 20 characters' }, { status: 400 })
    }
    if (!author || typeof author !== 'string') {
      return NextResponse.json({ ok: false, error: 'Author wallet address required' }, { status: 400 })
    }

    const suggestions = await loadSuggestions()
    const hours = Math.min(Math.max(voteDurationHours || 72, 1), 720) // 1h - 30 days
    const now = Date.now()

    const suggestion: Suggestion = {
      id: generateId(),
      title: title.trim(),
      description: description.trim(),
      author,
      authorSol: authorSol?.trim() || undefined,
      status: 'pending',
      votesFor: 0,
      votesAgainst: 0,
      totalDelegatedVoters: 0,
      createdAt: now,
      voteEndsAt: now + hours * 60 * 60 * 1000,
      voters: {},
    }

    suggestions.push(suggestion)
    await saveSuggestions(suggestions)

    return NextResponse.json({ ok: true, suggestion })
  } catch (e: any) {
    console.error('Governance POST error:', e.message)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

/**
 * PUT /api/governance
 * Cast a vote on a suggestion
 * Body: { suggestionId, voter, vote: 'for' | 'against' }
 */
export async function PUT(req: Request) {
  try {
    const { suggestionId, voter, vote } = await req.json()

    if (!suggestionId || !voter || !vote || !['for', 'against'].includes(vote)) {
      return NextResponse.json({ ok: false, error: 'Invalid vote data' }, { status: 400 })
    }

    const suggestions = await loadSuggestions()
    const idx = suggestions.findIndex(s => s.id === suggestionId)
    if (idx === -1) {
      return NextResponse.json({ ok: false, error: 'Suggestion not found' }, { status: 404 })
    }

    const suggestion = suggestions[idx]

    // Check if voting is still open
    if (Date.now() > suggestion.voteEndsAt) {
      // Auto-expire
      suggestion.status = 'pending'
      await saveSuggestions(suggestions)
      return NextResponse.json({ ok: false, error: 'Voting period has ended' }, { status: 400 })
    }

    // Check if already voted
    if (suggestion.voters[voter]) {
      // Change vote — decrement old vote
      const oldVote = suggestion.voters[voter]
      if (oldVote === 'for') suggestion.votesFor = Math.max(0, suggestion.votesFor - 1)
      else suggestion.votesAgainst = Math.max(0, suggestion.votesAgainst - 1)
    }

    // Cast new vote
    suggestion.voters[voter] = vote
    if (vote === 'for') suggestion.votesFor++
    else suggestion.votesAgainst++

    // Auto-activate suggestion when it gets its first vote
    if (suggestion.status === 'pending') {
      suggestion.status = 'active'
    }

    await saveSuggestions(suggestions)

    return NextResponse.json({
      ok: true,
      suggestion: suggestion,
      newVoteCount: { for: suggestion.votesFor, against: suggestion.votesAgainst },
    })
  } catch (e: any) {
    console.error('Governance PUT error:', e.message)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

/**
 * DELETE /api/governance
 * Delete a suggestion (only the author can delete their own)
 * Body: { suggestionId, author }
 */
export async function DELETE(req: Request) {
  try {
    const { suggestionId, author } = await req.json()
    if (!suggestionId || !author) {
      return NextResponse.json({ ok: false, error: 'suggestionId and author required' }, { status: 400 })
    }

    const suggestions = await loadSuggestions()
    const idx = suggestions.findIndex(s => s.id === suggestionId && s.author === author)
    if (idx === -1) {
      return NextResponse.json({ ok: false, error: 'Suggestion not found or not authorized' }, { status: 404 })
    }

    suggestions.splice(idx, 1)
    await saveSuggestions(suggestions)

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('Governance DELETE error:', e.message)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
