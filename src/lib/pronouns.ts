// Pronouns for a student: what is recorded, else a default taken from gender.
// Used by the Students page (to show the default) and by the read APIs, so every
// consumer (RCS Report Card Tool etc.) gets the same answer.

export const PRONOUN_OPTIONS = ['he/him', 'she/her', 'they/them', 'he/they', 'she/they'];

// male -> he/him, female -> she/her; anything else, or no gender recorded -> they/them.
export function defaultPronouns(gender: string | null | undefined): string {
  if (gender === 'male') return 'he/him';
  if (gender === 'female') return 'she/her';
  return 'they/them';
}

// The recorded pronouns when there are any, otherwise the gender default.
export function effectivePronouns(pronouns: string | null | undefined, gender: string | null | undefined): string {
  const p = (pronouns ?? '').trim();
  return p || defaultPronouns(gender);
}
