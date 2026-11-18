import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

// Validates inter-app requests from consuming apps (KawaHoot, group-maker,
// toc-dayplans, report-card-tool). Each app sends:
//   Authorization: Bearer <key>
//
// Keys, either or both:
//   COURSE_HUB_API_KEYS  per-app keys, "name:key,name:key". Revoking or
//                        rotating one app means editing one entry; the others
//                        keep working. A name may list the endpoints it may call
//                        in brackets, joined with +:
//                          "kawahoot[students+courses+roster]:abc,toc[attendance]:def"
//                        A name with no brackets may call everything.
//   COURSE_HUB_API_KEY   the original single shared key (all endpoints). Still
//                        accepted, so consumers can move over one at a time.
//
// Scopes, one per endpoint: students, courses, roster, quarters, flex, attendance.
// Every request is logged as one JSON line: app, scope, path, outcome. Never the
// key and never any response data.
// Set COURSE_HUB_URL + their key in each consuming app's env vars.

const digest = (s: string) => createHash('sha256').update(s).digest()

export type Scope = 'students' | 'courses' | 'roster' | 'quarters' | 'flex' | 'attendance'
type Consumer = { name: string; hash: Buffer; scopes: Set<string> | null } // null = every scope

function loadConsumers(): Consumer[] {
  const out: Consumer[] = []
  for (const entry of (process.env.COURSE_HUB_API_KEYS ?? '').split(',')) {
    const m = /^\s*([^:[\]\s]+)\s*(?:\[([^\]]*)\])?\s*:(.+)$/.exec(entry)
    const key = m?.[3]?.trim()
    if (!m || !key) continue
    const scopes = m[2] === undefined
      ? null
      : new Set(m[2].split('+').map(x => x.trim()).filter(Boolean))
    out.push({ name: m[1]!, hash: digest(key), scopes })
  }
  const shared = process.env.COURSE_HUB_API_KEY
  if (shared) out.push({ name: 'shared', hash: digest(shared), scopes: null })
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

function log(app: string, scope: Scope, req: NextRequest, outcome: string) {
  console.info(JSON.stringify({
    at: 'course-hub-api', app, scope, path: req.nextUrl.pathname, outcome, ip: clientId(req),
  }))
}

export function requireApiKey(req: NextRequest, scope: Scope): NextResponse | null {
  const consumers = loadConsumers()
  if (consumers.length === 0) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const id = clientId(req)
  const now = Date.now()
  const seen = failures.get(id)
  if (seen && seen.resetAt > now && seen.count >= MAX_FAILURES) {
    log('unknown', scope, req, 'throttled')
    return NextResponse.json(
      { error: 'Too many failed attempts' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((seen.resetAt - now) / 1000)) } },
    )
  }

  const auth = req.headers.get('authorization') ?? ''
  const presented = auth.startsWith('Bearer ') ? digest(auth.slice(7)) : null
  // Compare against every key (no early exit) so timing doesn't reveal which matched.
  let match: Consumer | null = null
  if (presented) for (const c of consumers) if (timingSafeEqual(presented, c.hash)) match = c

  if (!match) {
    log('unknown', scope, req, 'unauthorized')
    if (failures.size > 1000) for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k)
    if (seen && seen.resetAt > now) seen.count++
    else failures.set(id, { count: 1, resetAt: now + WINDOW_MS })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (match.scopes && !match.scopes.has(scope)) {
    log(match.name, scope, req, 'forbidden')
    return NextResponse.json({ error: `This key may not call ${scope}` }, { status: 403 })
  }
  log(match.name, scope, req, 'ok')
  return null
}
