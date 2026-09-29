// Single source of truth for school year / quarter resolution.
// Used by course-hub's API routes and shared as the canonical implementation.

export function currentSchoolYear(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  // >= 7 (July): new school year planning starts in summer before September
  const startYear = month >= 7 ? year : year - 1
  return `${startYear}-${String(startYear + 1).slice(2)}`
}

// Returns today's quarter label (e.g. "Q1") from a list of quarters, falling
// back to the most recently-ended quarter if today falls outside all defined
// quarters (e.g. summer break). Returns null if no quarters are defined.
//
// Must use `label`, not `id` — `id` is just the row's primary key (a global
// auto-increment, not a per-year quarter number: 2025-26's rows landed on
// ids 1-4 by coincidence, but 2026-27's are 101-104), so it never matches the
// "1"/"2"/"3"/"4" quarter tags stored on courses.quarters.
export function resolveCurrentQuarter(
  quarters: Array<{ label: string; start_date: string; end_date: string }>
): string | null {
  if (!quarters.length) return null
  const today = new Date().toISOString().split('T')[0]
  const active = quarters.find(q => today >= q.start_date && today <= q.end_date)
  if (active) return active.label
  const past = quarters
    .filter(q => q.end_date < today)
    .sort((a, b) => b.end_date.localeCompare(a.end_date))
  return past[0]?.label ?? null
}

// Quarters are stored as free text (the Courses screen offers "e.g. Q1, Q2"), so a
// course may carry "Q1" or "1" depending on who typed it, and quarter labels look
// like "Q1". Compare on digits so any of those spellings agree.
export function quarterKey(q: string | number | null): string {
  return String(q ?? '').replace(/[^0-9]/g, '')
}

// The quarter label (e.g. "Q1") whose dates contain `isoDate` (YYYY-MM-DD), or
// null when no quarter covers it — unlike resolveCurrentQuarter, this does not
// fall back to the last quarter, since a break or an unset quarter should not
// quietly pick one.
export function quarterForDate(
  quarters: Array<{ label: string; start_date: string | null; end_date: string | null }>,
  isoDate: string
): string | null {
  const q = quarters.find(q => q.start_date && q.end_date && isoDate >= q.start_date && isoDate <= q.end_date)
  return q?.label ?? null
}
