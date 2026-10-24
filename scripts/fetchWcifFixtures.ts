// Refreshes the real-competition fixtures in tests/fixtures/wcif/ from WCA's public WCIF.
//
//   npx vite-node scripts/fetchWcifFixtures.ts -- WaterlooSpring2026 [more ids...]
//
// Always the public endpoint, and scrubbed anyway: these files are committed to a public repo.

import { writeFileSync } from 'node:fs';
import { scrubWcif } from '../src/test/corpus';

const ids = process.argv.slice(2).filter((a) => a !== '--');
if (ids.length === 0) {
  console.error('usage: vite-node scripts/fetchWcifFixtures.ts -- <competitionId>...');
  process.exit(1);
}

for (const id of ids) {
  const res = await fetch(`https://www.worldcubeassociation.org/api/v0/competitions/${id}/wcif/public`);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const out = `tests/fixtures/wcif/${id}.json`;
  writeFileSync(out, `${JSON.stringify(scrubWcif(await res.json()))}\n`);
  console.log(`wrote ${out}`);
}
