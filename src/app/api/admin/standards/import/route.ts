import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';

// Standards are authored as one CSV per subject in Supabase Storage.
const BUCKET = 'learning-standards-data';
const SUBJECTS = ['ADST', 'FA', 'Bible', 'Worship Leadership'] as const;
type Subject = (typeof SUBJECTS)[number];

const LEVELS = ['emerging', 'developing', 'proficient', 'extending'] as const;
type Level = (typeof LEVELS)[number];
const GRADES = [9, 10, 11, 12];

function isSubject(s: string): s is Subject {
  return (SUBJECTS as readonly string[]).includes(s);
}
function isLevel(x: string): x is Level {
  return (LEVELS as readonly string[]).includes(x);
}

function normKey(k: string): string {
  return String(k ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

// Minimal RFC4180 reader: quoted fields, doubled quotes, newlines inside quotes.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const header = (rows.shift() ?? []).map((h) => h.trim());
  return rows
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

type Cell = { standard_key: string; standard_title: string; grade: number; level: Level; text: string };

/**
 * Re-import the standards CSVs.
 *
 * This replaces an importer in TOC Day Plans that deleted every standard in a
 * subject and re-inserted it with fresh UUIDs. That silently broke every
 * reference held elsewhere (the Report Card Tool keys its own rows on these ids),
 * destroyed version history, and wiped hand-edited rubric text.
 *
 * Nothing is deleted here. Standards are matched by (subject, standard_key) and
 * keep their id, so references survive. A standard present in the database but
 * absent from the CSV is reported, never removed — retiring one is a deliberate
 * act, not a side effect of a re-import. Rubric rows are upserted with
 * original_text only, so edited_text is left untouched.
 */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ error: 'Supabase environment variables are not configured.' }, { status: 500 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (all) => { for (const c of all) cookieStore.set(c); },
    },
  });

  // /api/* is exempt from the middleware, so this route checks for itself.
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const target = String(body?.subject ?? 'all');
  const dryRun = body?.dryRun !== false; // default to a preview; writing must be asked for

  if (target !== 'all' && !isSubject(target)) {
    return NextResponse.json({ error: `Unknown subject: ${target}` }, { status: 400 });
  }
  const subjects: Subject[] = target === 'all' ? [...SUBJECTS] : [target];

  const report: Record<string, unknown> = { dryRun, bucket: BUCKET, subjects: {} };

  for (const subject of subjects) {
    const csvUrl = `${url}/storage/v1/object/public/${encodeURIComponent(BUCKET)}/${encodeURIComponent(subject)}.csv`;
    const res = await fetch(csvUrl, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: `Could not read ${subject}.csv from storage (${res.status}).` }, { status: 400 });
    }
    const rows = parseCsv(await res.text());

    const cells: Cell[] = [];
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const standard_key = normKey(r.standard_key ?? '');
      const standard_title = String(r.standard_title ?? '').trim();
      const grade = Number(String(r.grade ?? '').trim());
      const level = String(r.level ?? '').trim();
      const text = String(r.text ?? '').trim();
      const line = i + 2;

      if (!standard_key) errors.push(`row ${line}: missing standard_key`);
      else if (!standard_title) errors.push(`row ${line}: missing standard_title`);
      else if (!GRADES.includes(grade)) errors.push(`row ${line}: invalid grade "${r.grade}"`);
      else if (!isLevel(level)) errors.push(`row ${line}: invalid level "${r.level}"`);
      else if (!text) errors.push(`row ${line}: missing text`);
      else cells.push({ standard_key, standard_title, grade, level, text });
    }
    if (errors.length) {
      return NextResponse.json(
        { error: `${subject}.csv did not validate — nothing was written.`, details: errors.slice(0, 30) },
        { status: 400 },
      );
    }

    // Live rows only: a superseded row keeps its old title on purpose.
    const { data: existing, error: exErr } = await supabase
      .from('learning_standards')
      .select('id, standard_key, standard_title')
      .eq('subject', subject)
      .is('superseded_by', null);
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });

    const byKey = new Map((existing ?? []).map((r) => [r.standard_key as string, r]));
    const csvTitles = new Map<string, string>();
    for (const c of cells) if (!csvTitles.has(c.standard_key)) csvTitles.set(c.standard_key, c.standard_title);

    const toInsert = [...csvTitles.entries()].filter(([k]) => !byKey.has(k));
    const toRetitle = [...csvTitles.entries()]
      .filter(([k, t]) => byKey.has(k) && byKey.get(k)!.standard_title !== t);
    const absentFromCsv = (existing ?? [])
      .filter((r) => !csvTitles.has(r.standard_key as string))
      .map((r) => r.standard_title as string);

    const summary = {
      csv_rows: cells.length,
      new_standards: toInsert.map(([k]) => k),
      retitled: toRetitle.map(([k, t]) => `${k} → ${t}`),
      in_database_but_not_in_csv: absentFromCsv,
      rubric_cells: cells.length,
      edited_text_preserved: true,
    };
    (report.subjects as Record<string, unknown>)[subject] = summary;
    if (dryRun) continue;

    let sortBase = (existing ?? []).length;
    for (const [key, title] of toInsert) {
      const { error } = await supabase.from('learning_standards').insert({
        subject, standard_key: key, standard_title: title,
        sort_order: ++sortBase, school_year: null,
      });
      if (error) return NextResponse.json({ error: `Adding ${key}: ${error.message}` }, { status: 500 });
    }
    for (const [key, title] of toRetitle) {
      const { error } = await supabase.from('learning_standards')
        .update({ standard_title: title }).eq('id', byKey.get(key)!.id);
      if (error) return NextResponse.json({ error: `Renaming ${key}: ${error.message}` }, { status: 500 });
    }

    // Re-read so the newly inserted standards have ids to hang rubrics on.
    const { data: after, error: afterErr } = await supabase
      .from('learning_standards')
      .select('id, standard_key')
      .eq('subject', subject)
      .is('superseded_by', null);
    if (afterErr) return NextResponse.json({ error: afterErr.message }, { status: 500 });
    const idByKey = new Map((after ?? []).map((r) => [r.standard_key as string, r.id as string]));

    // original_text only — omitting edited_text leaves any hand-edit in place.
    const rubricRows = cells
      .map((c) => ({
        learning_standard_id: idByKey.get(c.standard_key),
        grade: c.grade,
        level: c.level,
        original_text: c.text,
      }))
      .filter((r) => !!r.learning_standard_id);

    for (let i = 0; i < rubricRows.length; i += 200) {
      const { error } = await supabase
        .from('learning_standard_rubrics')
        .upsert(rubricRows.slice(i, i + 200), { onConflict: 'learning_standard_id,grade,level' });
      if (error) return NextResponse.json({ error: `Rubric text: ${error.message}` }, { status: 500 });
    }
  }

  return NextResponse.json(report);
}
