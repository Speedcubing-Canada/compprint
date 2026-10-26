// Real competitions, from WCA's public WCIF endpoint, checked into tests/fixtures/wcif/ by
// scripts/fetchWcifFixtures.ts. The repo is public: nothing private may ever land there.

import type { WCIF } from '../types/wcif';

/** Keys only a manager's WCIF carries, or that a registrant typed in. Removed at any depth. */
export const PRIVATE_KEYS = ['email', 'birthdate', 'comments', 'administrativeNotes', 'guests', 'dob'] as const;

/** Keys the app never reads, dropped to keep the fixtures small. */
const UNUSED_KEYS = ['results', 'avatar'];

export function scrubWcif(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubWcif);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([k]) => !(PRIVATE_KEYS as readonly string[]).includes(k) && !UNUSED_KEYS.includes(k))
      .map(([k, v]) => [k, scrubWcif(v)]));
  }
  return value;
}

const files = import.meta.glob<WCIF>('../../tests/fixtures/wcif/*.json', { eager: true, import: 'default' });

/** One fixture, as a fresh copy. */
export const corpusWcif = (id: string): WCIF => corpus().find(([cid]) => cid === id)![1];

/** Every fixture, by competition id. A fresh copy per call: the parser must not see another test's edits. */
export function corpus(): [string, WCIF][] {
  return Object.values(files).map((w) => [w.id, structuredClone(w)]);
}
