import { NextRequest, NextResponse } from 'next/server'

// Validates inter-app requests from consuming apps (KawaHoot, group-maker,
// toc-dayplans, report-card-tool). Each app sends:
//   Authorization: Bearer <COURSE_HUB_API_KEY>
// Set COURSE_HUB_API_KEY in course-hub's Vercel env vars.
// Set COURSE_HUB_URL + COURSE_HUB_API_KEY in each consuming app's env vars.
export function requireApiKey(req: NextRequest): NextResponse | null {
  const apiKey = process.env.COURSE_HUB_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  const auth = req.headers.get('authorization')
  if (!auth || auth !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
