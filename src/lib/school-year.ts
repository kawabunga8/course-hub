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
