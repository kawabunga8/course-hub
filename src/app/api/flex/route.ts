import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey } from '@/lib/require-api-key'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentSchoolYear } from '@/lib/school-year'

// GET /api/flex?date=2026-10-20               → that day, or null if the schedule has no entry
// GET /api/flex?from=2026-10-19&to=2026-10-23 → those days, by date
// GET /api/flex?school_year=2026-27           → the whole year (default: current year)
//
// Each day: { day, school_year, heading, details, flex_letter, room, room_note }.
// heading and details are the flex schedule sheet's text for that day ("C Flex",
// "Assembly" + "Club List Reveal", "No School" + "Thanksgiving"). flex_letter is
// A–D on A–D Flex days, and room / room_note say where this teacher goes then
// (flex_rooms). Dates the sheet doesn't list (weekends, breaks) are absent.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type FlexDayRow = { day: string; school_year: string; heading: string; details: string | null; flex_letter: string | null }
type FlexRoomRow = { school_year: string; flex_letter: string; room: string; note: string | null }

export async function GET(req: NextRequest) {
  const auth = requireApiKey(req)
  if (auth) return auth

  const params = req.nextUrl.searchParams
  const date = params.get('date')
  const from = params.get('from')
  const to = params.get('to')
  for (const value of [date, from, to]) {
    if (value && !ISO_DATE.test(value)) {
      return NextResponse.json({ error: `Dates must be YYYY-MM-DD, got "${value}"` }, { status: 400 })
    }
  }

  const supabase = createAdminClient()
  let query = supabase.from('flex_days').select('day,school_year,heading,details,flex_letter').order('day')
  if (date) {
    query = query.eq('day', date)
  } else if (from || to) {
    if (from) query = query.gte('day', from)
    if (to) query = query.lte('day', to)
  } else {
    query = query.eq('school_year', params.get('school_year') || currentSchoolYear())
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const days = (data ?? []) as FlexDayRow[]

  const years = [...new Set(days.map(d => d.school_year))]
  let rooms: FlexRoomRow[] = []
  if (years.length > 0) {
    const { data: roomData, error: roomError } = await supabase
      .from('flex_rooms')
      .select('school_year,flex_letter,room,note')
      .in('school_year', years)
    if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 })
    rooms = (roomData ?? []) as FlexRoomRow[]
  }
  const roomFor = new Map(rooms.map(r => [`${r.school_year}|${r.flex_letter}`, r]))

  const result = days.map(d => {
    const room = d.flex_letter ? roomFor.get(`${d.school_year}|${d.flex_letter}`) : undefined
    return { ...d, room: room?.room ?? null, room_note: room?.note ?? null }
  })

  return NextResponse.json(date ? (result[0] ?? null) : result)
}
