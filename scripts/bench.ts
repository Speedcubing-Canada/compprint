// Generation benchmark. See "Generation performance" in the README.
//
//   npm run bench                 # WC2025-scale profile (~1800 competitors)
//   npm run bench -- small        # small / medium / wc
//   npm run bench -- wc --only=nametags
//
// Run through vite-node, not node: the documents are .tsx and the icon assets are
// `?inline` imports. --expose-gc makes the per-job heap numbers attributable.

import { renderToBuffer } from '@react-pdf/renderer';
import type { CompetitionSettings } from '../src/types/settings';
import { parseWCIF } from '../src/lib/wcif-parser';
import { filterParsedByScope } from '../src/lib/generationScope';
import { buildPdfJobs } from '../src/lib/pdfJobs';
import { jobElements } from '../src/pdf/jobElement';
import { mergePdfs } from '../src/pdf/mergePdfs';
import { testSettings } from '../src/test/fixtures';
import { PROFILES, buildWcif } from '../src/test/wcifGen';

// ---------------------------------------------------------------------------

const MB = 1024 * 1024;
const mb = (bytes: number) => (bytes / MB).toFixed(0).padStart(6);
const ms = (t: number) => `${(t / 1000).toFixed(2).padStart(7)}s`;

function collect() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
}

/** Peak heapUsed and rss over the life of one measured step. */
function watchMemory() {
  let peakHeap = process.memoryUsage().heapUsed;
  let peakRss = process.memoryUsage().rss;
  const timer = setInterval(() => {
    const m = process.memoryUsage();
    if (m.heapUsed > peakHeap) peakHeap = m.heapUsed;
    if (m.rss > peakRss) peakRss = m.rss;
  }, 20);
  timer.unref();
  return () => { clearInterval(timer); return { peakHeap, peakRss }; };
}

async function main() {
  const args = process.argv.slice(2);
  const key = args.find((a) => !a.startsWith('--')) ?? 'wc';
  const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;
  const profile = PROFILES[key];
  if (!profile) {
    console.error(`Unknown profile "${key}". Options: ${Object.keys(PROFILES).join(', ')}`);
    process.exit(1);
  }
  if (typeof globalThis.gc !== 'function')
    console.warn('! gc() unavailable - run with --expose-gc for attributable heap numbers\n');

  console.log(`Profile: ${profile.name}\n`);

  const settings: CompetitionSettings = testSettings({
    competitionId: 'BenchmarkComp2026',
    competitionName: 'Benchmark Competition 2026',
    scorecardsA6: args.includes('--a6'),
    mergeScorecardRounds: args.includes('--merge'),
  });

  collect();
  let stop = watchMemory();
  let t = performance.now();
  const wcif = buildWcif(profile);
  console.log(`  build wcif   ${ms(performance.now() - t)}  ${mb(stop().peakHeap)} MB heap  ` +
    `(${wcif.persons.length} persons, ${wcif.events.length} events)`);

  collect();
  stop = watchMemory();
  t = performance.now();
  const parsed = parseWCIF(wcif, settings);
  const parseMem = stop();
  console.log(`  parseWCIF    ${ms(performance.now() - t)}  ${mb(parseMem.peakHeap)} MB heap  ` +
    `(${parsed.firstRound.length} r1 cards, ${parsed.nametags.length} tags, ${parsed.firstTimers.length} slips)`);

  const scoped = filterParsedByScope(parsed, settings.generationScope!);
  const jobs = buildPdfJobs(scoped, settings).filter((j) => !only || j.kind === only);

  console.log(`\n  ${'document'.padEnd(34)} ${'time'.padStart(8)} ${'heap'.padStart(9)} ${'rss'.padStart(9)} ${'output'.padStart(9)}`);
  console.log(`  ${'-'.repeat(34)} ${'-'.repeat(8)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(9)}`);

  let totalTime = 0;
  let totalBytes = 0;
  let worstHeap = 0;
  for (const job of jobs) {
    collect();
    const stopJob = watchMemory();
    const start = performance.now();
    // The worker's path: page-capped parts, merged when there is more than one.
    const parts = jobElements(job, scoped, settings).map((el) => () => renderToBuffer(el));
    const bytes = (parts.length === 1 ? await parts[0]() : await mergePdfs(parts)).byteLength;
    const elapsed = performance.now() - start;
    const m = stopJob();
    totalTime += elapsed;
    totalBytes += bytes;
    worstHeap = Math.max(worstHeap, m.peakHeap);
    console.log(`  ${job.filename.padEnd(34)} ${ms(elapsed)} ${mb(m.peakHeap)} MB ${mb(m.peakRss)} MB ${mb(bytes)} MB`);
  }

  console.log(`  ${'-'.repeat(34)} ${'-'.repeat(8)} ${'-'.repeat(9)} ${'-'.repeat(9)} ${'-'.repeat(9)}`);
  console.log(`  ${`${jobs.length} documents`.padEnd(34)} ${ms(totalTime)} ${mb(worstHeap)} MB ${''.padStart(9)} ${mb(totalBytes)} MB`);
}

main().catch((err) => { console.error(err); process.exit(1); });
