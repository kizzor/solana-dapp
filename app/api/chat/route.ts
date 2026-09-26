// ─── OmniRoute Chat Proxy ─────────────────────────────────────────────────────
// Bridges the app's chat UIs to the local OmniRoute AI gateway
// (http://localhost:20128/v1 — OpenAI-compatible). Credentials live in .env.local.
//
//   GET  /api/chat            → list models available on the gateway
//   POST /api/chat            → chat completion (stream: SSE pass-through,
//                               stream: false → JSON { content })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BASE_URL = (process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128').replace(/\/+$/, '')
const API_KEY = process.env.OMNIROUTE_API_KEY || ''
const DEFAULT_MODEL = 'auto' // OmniRoute virtual combo — auto-fallback across connected providers

function authHeaders(extra: Record<string, string> = {}) {
  return {
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    ...extra,
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// ─── GET: model catalog ───────────────────────────────────────────────────────
export async function GET() {
  try {
    const res = await fetch(`${BASE_URL}/v1/models`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return json({ error: `OmniRoute ${res.status}: ${text.slice(0, 200)}` }, 502)
    }
    const data = (await res.json()) as {
      data?: Array<{ id: string; owned_by?: string; context_length?: number; capabilities?: Record<string, unknown> }>
    }
    const models = (data.data ?? [])
      .filter(m => typeof m.id === 'string')
      .map(m => ({
        id: m.id,
        owner: m.owned_by ?? 'omniroute',
        context: m.context_length ?? null,
      }))
    // Combos first (auto/...), then everything else alphabetically
    models.sort((a, b) => {
      const ac = a.owner === 'combo' ? 0 : 1
      const bc = b.owner === 'combo' ? 0 : 1
      return ac - bc || a.id.localeCompare(b.id)
    })
    return json({ online: true, defaultModel: DEFAULT_MODEL, models })
  } catch (e) {
    return json({ online: false, error: `OmniRoute unreachable at ${BASE_URL} — is the gateway running? (${String(e)})` }, 502)
  }
}

// ─── POST: chat completion ────────────────────────────────────────────────────
export async function POST(req: Request) {
  let body: { messages?: ChatMessage[]; model?: string; stream?: boolean; maxTokens?: number }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const messages = (body.messages ?? []).filter(
    m => m && typeof m.content === 'string' && m.content.trim().length > 0,
  )
  if (messages.length === 0) return json({ error: 'messages[] required' }, 400)

  const stream = body.stream ?? true
  const payload = {
    model: body.model || DEFAULT_MODEL,
    messages,
    stream,
    max_tokens: Math.min(Math.max(body.maxTokens ?? 2048, 64), 32768),
  }

  let upstream: Response
  try {
    upstream = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    return json({ error: `OmniRoute unreachable at ${BASE_URL} — is the gateway running? (${String(e)})` }, 502)
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    return json({ error: `OmniRoute ${upstream.status}: ${text.slice(0, 300)}` }, 502)
  }

  // Streaming → pass the SSE bytes straight through
  if (stream && upstream.body) {
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    })
  }

  // Non-streaming → extract the assistant content for simple clients
  try {
    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return json({ content: data.choices?.[0]?.message?.content ?? '' })
  } catch (e) {
    return json({ error: `Bad response from OmniRoute: ${String(e)}` }, 502)
  }
}
