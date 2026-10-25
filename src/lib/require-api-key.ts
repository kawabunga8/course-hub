import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

// Validates inter-app requests from consuming apps (KawaHoot, group-maker,
// toc-dayplans, report-card-tool). Each app sends:
//   Authorization: Bearer <key>
//
// Keys, either or both:
//   COURSE_HUB_API_KEYS  per-app keys, "name:key,name:key" (e.g.
//                        "kawahoot:abc,toc:def"). Revoking or rotating one app
//                        means editing one entry; the others keep working.
//   COURSE_HUB_API_KEY   the original single shared key. Still accepted, so
//                        consumers can move to their own key one at a time.
// Set COURSE_HUB_URL + their key in each consuming app's env vars.

const digest = (s: string) => createHash('sha256').update(s).digest()

type Consumer = { name: string; hash: Buffer }

function loadConsumers(): Consumer[] {
  const out: Consumer[] = []
  for (const entry of (process.env.COURSE_HUB_API_KEYS ?? '').split(',')) {
    const i = entry.indexOf(':')
    const name = entry.slice(0, i).trim()
    const key = entry.slice(i + 1).trim()
    if (i > 0 && name && key) out.push({ name, hash: digest(key) })
  }
  const shared = process.env.COURSE_HUB_API_KEY
  if (shared) out.push({ name: 'shared', hash: digest(shared) })
  return out
}

// Failed-attempt throttle per client address. In memory, so it resets on
// restart and is per instance: it slows guessing, it is not a hard limit.
const MAX_FAILURES = 20
const WINDOW_MS = 60_000
const failures = new Map<string, { count: number; resetAt: number }>()

function clientId(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

export function requireApiKey(req: NextRequest): NextResponse | null {
  const consumers = loadConsumers()
  if (consumers.length === 0) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const id = clientId(req)
  const now = Date.now()
  const seen = failures.get(id)
  if (seen && seen.resetAt > now && seen.count >= MAX_FAILURES) {
    return NextResponse.json(
      { error: 'Too many failed attempts' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((seen.resetAt - now) / 1000)) } },
    )
  }

  const auth = req.headers.get('authorization') ?? ''
  const presented = auth.startsWith('Bearer ') ? digest(auth.slice(7)) : null
  // Compare against every key (no early exit) so timing doesn't reveal which matched.
  let ok = false
  if (presented) for (const c of consumers) if (timingSafeEqual(presented, c.hash)) ok = true

  if (!ok) {
    if (failures.size > 1000) for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k)
    if (seen && seen.resetAt > now) seen.count++
    else failures.set(id, { count: 1, resetAt: now + WINDOW_MS })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
