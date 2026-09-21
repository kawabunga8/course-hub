// Seeds/updates a row in public.school_documents from a PDF, extracting text
// with poppler's pdftotext so the document is readable in Course Hub without
// a file download. Re-runnable: matches on (title, school_year) and updates
// the existing row instead of inserting a duplicate, since the table has no
// unique constraint to upsert against.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
//     node scripts/seed-school-documents.mjs
//
// Reads the two Supabase vars from the environment — run with `env $(cat
// .env.local | grep -v '^#' | xargs)` or similar, never paste them inline.

import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const PDF_PATH = "/Users/shingokawamura/Desktop/RCS Procedural/Admin & Policies/RCS Staff Handbook/RCS Employee Handbook (2026-27).pdf"
const TITLE = 'RCS Employee Handbook'
const SCHOOL_YEAR = '2026-27'
const SOURCE_FILENAME = 'RCS Employee Handbook (2026-27).pdf'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.')
  process.exit(1)
}

const rawText = execFileSync('pdftotext', ['-layout', PDF_PATH, '-'], {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20,
})
// pdftotext separates pages with a form-feed character, not a newline.
const content = rawText.replace(/\f/g, '\n')

const supabase = createClient(supabaseUrl, serviceRoleKey)

const { data: existing, error: selectError } = await supabase
  .from('school_documents')
  .select('id')
  .eq('title', TITLE)
  .eq('school_year', SCHOOL_YEAR)
  .maybeSingle()

if (selectError) {
  console.error('Lookup failed:', selectError.message)
  process.exit(1)
}

if (existing) {
  const { error } = await supabase
    .from('school_documents')
    .update({ source_filename: SOURCE_FILENAME, content, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
  if (error) { console.error('Update failed:', error.message); process.exit(1) }
  console.log(`Updated existing school_documents row ${existing.id} (${content.length} chars).`)
} else {
  const { data, error } = await supabase
    .from('school_documents')
    .insert({ title: TITLE, school_year: SCHOOL_YEAR, source_filename: SOURCE_FILENAME, content })
    .select('id')
    .single()
  if (error) { console.error('Insert failed:', error.message); process.exit(1) }
  console.log(`Inserted new school_documents row ${data.id} (${content.length} chars).`)
}
