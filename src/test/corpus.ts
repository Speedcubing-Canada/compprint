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

type V1Round = Record<string, unknown> & {
  id: string;
  cutoff: { numberOfAttempts: number; attemptResult?: number; resultValue?: number } | null;
  advancementCondition?: { type: 'ranking' | 'percent' | 'attemptResult'; level: number } | null;
};

/**
 * WCA serves the public WCIF as v1 only, and the app reads v2 (src/auth/wca.ts). Converted the
 * way the v2 endpoint shapes the same data: a cutoff's `attemptResult` is its `resultValue`, a
 * round's advancementCondition becomes the next round's participationRuleset, and a personal
 * best's `best` is its `value`.
 */
export function wcifV1ToV2(wcif: Record<string, unknown>): Record<string, unknown> {
  const w = structuredClone(wcif) as { formatVersion: string; events: { rounds: V1Round[] }[]; persons: { personalBests?: Record<string, unknown>[] }[] };
  w.formatVersion = '2.0';
  for (const event of w.events) {
    event.rounds.forEach((round, i) => {
      const prev = event.rounds[i - 1];
      if (round.cutoff && round.cutoff.attemptResult !== undefined) {
        round.cutoff = { numberOfAttempts: round.cutoff.numberOfAttempts, resultValue: round.cutoff.attemptResult };
      }
      const adv = prev?.advancementCondition;
      round.participationRuleset = {
        participationSource: i === 0 ? { type: 'registrations' } : adv ? {
          type: 'round', roundId: prev.id,
          resultCondition: {
            type: adv.type === 'attemptResult' ? 'resultAchieved' : adv.type, scope: 'average', value: adv.level,
          },
        } : null,
        reservedPlaces: null,
      };
    });
    for (const round of event.rounds) delete round.advancementCondition;
  }
  for (const p of w.persons) {
    for (const pb of p.personalBests ?? []) {
      if ('best' in pb) { pb.value = pb.best; delete pb.best; }
    }
  }
  return w;
}

const files = import.meta.glob<WCIF>('../../tests/fixtures/wcif/*.json', { eager: true, import: 'default' });

/** Every fixture, by competition id. A fresh copy per call: the parser must not see another test's edits. */
export function corpus(): [string, WCIF][] {
  return Object.values(files).map((w) => [w.id, structuredClone(w)]);
}
