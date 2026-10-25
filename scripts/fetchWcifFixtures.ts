// Refreshes the real-competition fixtures in tests/fixtures/wcif/ from WCA's public WCIF.
//
//   npx vite-node scripts/fetchWcifFixtures.ts -- WaterlooSpring2026 [more ids...]
//
// Always the public endpoint, and scrubbed anyway: these files are committed to a public repo.
// The public endpoint serves v1 only, so it is converted to the v2 the app reads.

import { writeFileSync } from 'node:fs';
import { scrubWcif } from '../src/test/corpus';

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
function wcifV1ToV2(wcif: Record<string, unknown>): Record<string, unknown> {
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

const ids = process.argv.slice(2).filter((a) => a !== '--');
if (ids.length === 0) {
  console.error('usage: vite-node scripts/fetchWcifFixtures.ts -- <competitionId>...');
  process.exit(1);
}

for (const id of ids) {
  const res = await fetch(`https://www.worldcubeassociation.org/api/v0/competitions/${id}/wcif/public`);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const out = `tests/fixtures/wcif/${id}.json`;
  writeFileSync(out, `${JSON.stringify(wcifV1ToV2(scrubWcif(await res.json()) as Record<string, unknown>))}\n`);
  console.log(`wrote ${out}`);
}
