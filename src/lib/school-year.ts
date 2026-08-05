// Single source of truth for school year / quarter resolution.
// Used by course-hub's API routes and shared as the canonical implementation.

export function currentSchoolYear(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const startYear = month >= 9 ? year : year - 1
  return `${startYear}-${String(startYear + 1).slice(2)}`
}

// Returns today's quarter id from a list of quarters, falling back to the
// most recently-ended quarter if today falls outside all defined quarters
// (e.g. summer break). Returns null if no quarters are defined.
export function resolveCurrentQuarter(
  quarters: Array<{ id: number; start_date: string; end_date: string }>
): number | null {
  if (!quarters.length) return null
  const today = new Date().toISOString().split('T')[0]
  const active = quarters.find(q => today >= q.start_date && today <= q.end_date)
  if (active) return active.id
  const past = quarters
    .filter(q => q.end_date < today)
    .sort((a, b) => b.end_date.localeCompare(a.end_date))
  return past[0]?.id ?? null
}
