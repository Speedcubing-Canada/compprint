import { describe, it, expect } from 'vitest';
import { buildPdfJobs, downloadTarget, guideSections, hasOversizedPdf } from './pdfJobs';
import type { PdfJob } from './pdfJobs';
import { filterParsedByScope } from './generationScope';
import { finalizeEntries, stackQuadrants, type ParsedWCIF, type ScorecardData, type ScorecardEntry, type CoverEntry, type NametTagEntry } from './wcif-parser';
import { MAX_PAGES_PER_SCORECARD_PDF, MAX_PAGES_PER_NAMETAG_PDF } from '../pdf/layoutConstants';
import type { CompetitionSettings, CustomEvent } from '../types/settings';

function sc(roundNum = 1, name = '', stage?: string): ScorecardEntry {
  return {
    kind: 'scorecard', timeslot: 'a01', eventId: '333', eventName: '333',
    roundLabel: `Round ${roundNum}`, roundNum, group: 'Group 1 of 1', stage,
    name, wcaId: '', liveId: '', gender: 'm', cutoff: '', limit: '',
    format: 'avg5', isCumulative: false,
  };
}
function cover(roundNum = 1): CoverEntry {
  return {
    kind: 'cover', timeslot: 'a01', eventId: '333', eventName: '333',
    roundLabel: `Round ${roundNum}`, roundNum, group: 'Group 1 of 1', numScorecards: 1, numGroups: 1,
  };
}

function mkParsed(over: Partial<ParsedWCIF> = {}): ParsedWCIF {
  return {
    firstRound: [], intermediate: [], semis: [], finals: [],
    nametags: [], firstTimers: [], extras: [], scheduleDays: [], checkingDays: [],
    groupOverview: [],
    laterRoundsWithAssignments: [], hasGroups: true, stageCount: 1, stations: null,
    ...over,
  };
}

function mkSettings(over: Partial<CompetitionSettings> = {}): CompetitionSettings {
  return {
    competitionId: 'Test2026', competitionName: 'Test 2026',
    language: 'en', secondaryLanguage: null, paperFormat: 'LETTER',
    secondRoundMode: 'blanks', logoDataUrl: null, useDefaultLogo: true,
    wcaLiveId: null, wcaLivePersonIds: null, hideWcaLiveId: false,
    customEvents: [],
    generationScope: { mode: 'everything' },
    isCustomCompetition: false,
    ...over,
  } as CompetitionSettings;
}

const customEvent = (name: string): CustomEvent =>
  ({ name, format: 'avg5', cutoff: '', limit: '', iconDataUrl: null }) as unknown as CustomEvent;

const allDocs = {
  scorecards: true, scheduleTracker: true, nametags: true,
  roundChecklist: true, firstTimerSlips: true, groupOverview: false,
};
const noDocs = {
  scorecards: false, scheduleTracker: false, nametags: false,
  roundChecklist: false, firstTimerSlips: false, groupOverview: false,
};

/** A parse with every bucket populated - the full pre-competition case. */
const fullParsed = mkParsed({
  firstRound: [sc(1, 'A'), cover(1)],
  intermediate: [sc(2, 'A'), cover(2)],
  semis: [sc(3)],
  finals: [sc(4)],
  extras: [sc(1)],
  nametags: [{ name: 'x' } as never],
  firstTimers: [{ name: 'y' } as never],
  scheduleDays: [{ dayLabel: 'Day 1', stages: [] } as never],
  checkingDays: [{ dayLabel: 'Day 1', rows: [] } as never],
});

describe('buildPdfJobs', () => {
  // Locks the filenames and the emission order - these names are what people look for
  // in the ZIP after printing.
  it('emits every document in render order with the established filenames', () => {
    const jobs = buildPdfJobs(fullParsed, mkSettings({ customEvents: [customEvent('Mini Guildford')] }));
    expect(jobs.map(j => j.filename)).toEqual([
      'Test2026_round1.pdf',
      'Test2026_round2.pdf',
      'Test2026_semis.pdf',
      'Test2026_finals.pdf',
      'Test2026_extras.pdf',
      'Test2026_schedule.pdf',
      'Test2026_checklist.pdf',
      'Test2026_nametags.pdf',
      'Test2026_first_timers.pdf',
      'Test2026_custom_Mini_Guildford.pdf',
    ]);
    expect(jobs.map(j => j.kind)).toEqual([
      'scorecards', 'scorecards', 'scorecards', 'scorecards', 'scorecards',
      'schedule', 'checking', 'nametags', 'first-timers', 'custom',
    ]);
  });

  it('skips empty buckets', () => {
    const jobs = buildPdfJobs(mkParsed({ firstRound: [sc(1, 'A')] }), mkSettings());
    expect(jobs.map(j => j.filename)).toEqual(['Test2026_round1.pdf']);
  });

  it('returns nothing for an empty parse with no custom events', () => {
    expect(buildPdfJobs(mkParsed(), mkSettings())).toEqual([]);
  });

  it('carries the scorecard entries on scorecard jobs', () => {
    const parsed = mkParsed({ firstRound: [sc(1, 'A'), sc(1, 'B')] });
    const jobs = buildPdfJobs(parsed, mkSettings());
    expect(jobs[0].kind === 'scorecards' && jobs[0].entries).toHaveLength(2);
  });

  it('carries the raw custom event, not pre-built entries', () => {
    const custom = customEvent('Relay');
    const jobs = buildPdfJobs(mkParsed(), mkSettings({ customEvents: [custom] }));
    expect(jobs[0].kind === 'custom' && jobs[0].custom).toBe(custom);
  });

  it('skips blank-named custom events', () => {
    const jobs = buildPdfJobs(mkParsed(), mkSettings({
      customEvents: [customEvent('   '), customEvent('Real')],
    }));
    expect(jobs.map(j => j.filename)).toEqual(['Test2026_custom_Real.pdf']);
  });

  // Two names that sanitise alike used to share a filename, so the zip held two entries under
  // one name and the organizer's unzip kept only one of them. Case counts as alike: macOS and
  // Windows unzip onto case-insensitive disks.
  it.each([
    [['3x3 OH', '3x3-OH']],
    [['魔方', 'ルービック']],
    [['Mini Guildford', 'mini guildford']],
    // A generated suffix must not land on a name someone actually typed.
    [['Relay 2', 'Relay', 'Relay']],
    [['Relay', 'Relay', 'Relay 2']],
    [['Relay', 'relay ', 'Relay!']],
  ])('gives custom events that sanitise alike distinct filenames: %j', (names) => {
    const jobs = buildPdfJobs(mkParsed(), mkSettings({ customEvents: names.map(customEvent) }));
    const files = jobs.map(j => j.filename);
    expect(files).toHaveLength(names.length);
    expect(new Set(files.map(f => f.toLowerCase())).size).toBe(names.length);
  });

  it('sanitises custom names into filenames and caps them at 40 chars', () => {
    const jobs = buildPdfJobs(mkParsed(), mkSettings({
      customEvents: [customEvent('3x3 / OH — "fun"!'), customEvent('x'.repeat(60))],
    }));
    expect(jobs[0].filename).toBe('Test2026_custom_3x3_OH_fun_.pdf');
    expect(jobs[1].filename).toBe(`Test2026_custom_${'x'.repeat(40)}.pdf`);
  });
});

describe('downloadTarget', () => {
  it('names the bundle after the competition when there are several PDFs', () => {
    const jobs = buildPdfJobs(fullParsed, mkSettings());
    expect(jobs.length).toBeGreaterThan(1);
    expect(downloadTarget(jobs, 'Test2026')).toEqual({
      filename: 'Test2026_pdfs.zip',
      mimeType: 'application/zip',
    });
  });

  it('downloads the PDF itself when exactly one document is generated', () => {
    const jobs = buildPdfJobs(mkParsed({ nametags: [{ name: 'x' } as never] }), mkSettings());
    expect(downloadTarget(jobs, 'Test2026')).toEqual({
      filename: 'Test2026_nametags.pdf',
      mimeType: 'application/pdf',
    });
  });

  // No jobs means the worker errors out before building anything; the target is
  // never used, but it must not claim to be a lone PDF either.
  it('falls back to the zip name when there is nothing to build', () => {
    expect(downloadTarget([], 'Test2026')).toEqual({
      filename: 'Test2026_pdfs.zip',
      mimeType: 'application/zip',
    });
  });
});

// The whole point of the change: picking one document on the scope step has to
// come out as a bare PDF, not a one-file ZIP.
describe('single-document scopes download as a bare PDF', () => {
  const settings = mkSettings();

  it.each([
    ['scheduleTracker', 'Test2026_schedule.pdf'],
    ['roundChecklist',  'Test2026_checklist.pdf'],
    ['nametags',        'Test2026_nametags.pdf'],
    ['firstTimerSlips', 'Test2026_first_timers.pdf'],
  ] as const)('%s only → %s', (doc, filename) => {
    const scoped = filterParsedByScope(fullParsed, {
      mode: 'everything',
      documents: { ...noDocs, [doc]: true },
    });
    const jobs = buildPdfJobs(scoped, settings);
    expect(jobs).toHaveLength(1);
    expect(downloadTarget(jobs, settings.competitionId)).toEqual({
      filename,
      mimeType: 'application/pdf',
    });
  });

  // Scorecards alone still produce one PDF per round bucket, so they zip.
  it('scorecards only → still a ZIP (one PDF per round bucket)', () => {
    const scoped = filterParsedByScope(fullParsed, {
      mode: 'everything',
      documents: { ...noDocs, scorecards: true },
    });
    const jobs = buildPdfJobs(scoped, settings);
    expect(jobs.length).toBeGreaterThan(1);
    expect(downloadTarget(jobs, settings.competitionId).mimeType).toBe('application/zip');
  });

  it('a custom competition with a single event → that event\'s PDF', () => {
    // CustomCompetitionPage forces a scorecards-only scope over an empty parse.
    const scoped = filterParsedByScope(mkParsed(), {
      mode: 'everything',
      documents: { ...noDocs, scorecards: true },
    });
    const jobs = buildPdfJobs(scoped, mkSettings({
      isCustomCompetition: true,
      customEvents: [customEvent('Mini Guildford')],
    }));
    expect(jobs).toHaveLength(1);
    expect(downloadTarget(jobs, 'Test2026')).toEqual({
      filename: 'Test2026_custom_Mini_Guildford.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('two custom events → back to a ZIP', () => {
    const jobs = buildPdfJobs(mkParsed(), mkSettings({
      customEvents: [customEvent('Relay'), customEvent('Mini Guildford')],
    }));
    expect(jobs).toHaveLength(2);
    expect(downloadTarget(jobs, 'Test2026').filename).toBe('Test2026_pdfs.zip');
  });

  it('all documents → ZIP, unchanged from before', () => {
    const scoped = filterParsedByScope(fullParsed, { mode: 'everything', documents: allDocs });
    const jobs = buildPdfJobs(scoped, settings);
    expect(downloadTarget(jobs, settings.competitionId)).toEqual({
      filename: 'Test2026_pdfs.zip',
      mimeType: 'application/zip',
    });
  });
});

// Print-and-cut guide sections
// The download page's guide must only explain the PDFs actually in the download:
// someone generating just the schedule tracker was being told how to cut and stack
// scorecards they never asked for.

describe('guideSections', () => {
  const cards = (label: string): PdfJob =>
    ({ kind: 'scorecards', filename: `c_${label}.pdf`, label, entries: [] });
  const other = (kind: PdfJob['kind']): PdfJob =>
    ({ kind, filename: `c_${kind}.pdf`, label: kind } as PdfJob);

  it('shows nothing when there is nothing to download', () => {
    expect(guideSections([])).toEqual([]);
  });

  it('shows only the schedule note for a schedule-only download', () => {
    expect(guideSections([other('schedule')])).toEqual(['schedule']);
  });

  it('shows only the scorecard section for a scorecard-only download', () => {
    expect(guideSections([cards('Round 1'), cards('Finals')])).toEqual(['scorecards']);
  });

  it('treats custom-event cards as scorecards - they print 4-up on the same sheet', () => {
    expect(guideSections([other('custom')])).toEqual(['scorecards']);
  });

  it('collapses scorecards and custom events into a single section', () => {
    expect(guideSections([cards('Round 1'), other('custom')])).toEqual(['scorecards']);
  });

  it('lists every section for a full download, scorecards first', () => {
    expect(guideSections([
      cards('Round 1'), other('schedule'), other('checking'),
      other('nametags'), other('first-timers'),
    ])).toEqual(['scorecards', 'schedule', 'checking', 'nametags', 'first-timers']);
  });

  it('keeps a fixed section order regardless of job order', () => {
    expect(guideSections([other('first-timers'), other('nametags'), cards('Finals')]))
      .toEqual(['scorecards', 'nametags', 'first-timers']);
  });

  it('never names a document the jobs do not contain', () => {
    const parsed = mkParsed({ firstRound: [cover(), sc(1, 'A')] });
    expect(guideSections(buildPdfJobs(parsed, mkSettings()))).toEqual(['scorecards']);
  });
});

// Size never splits a file: the renderer draws it in page-capped parts and merges them.
describe('an oversized bucket', () => {
  const CAP = MAX_PAGES_PER_SCORECARD_PDF * 4;
  const names = (n: number) => Array.from({ length: n }, (_, i) => `Name ${String(i).padStart(4, '0')}`);

  it('stays one scorecard PDF per round, every event in it', () => {
    const cards = [...names(CAP).map(n => sc(1, n)), ...names(40).map(n => ({ ...sc(1, n), eventId: '222' as const }))];
    const firstRound = finalizeEntries([...cards]);
    const jobs = buildPdfJobs(mkParsed({ firstRound }), mkSettings());
    expect(jobs.map(j => j.filename)).toEqual(['Test2026_round1.pdf']);
    expect((jobs[0] as Extract<PdfJob, { kind: 'scorecards' }>).entries).toBe(firstRound);
  });

  it('stays one name tag PDF', () => {
    const nametags = names(MAX_PAGES_PER_NAMETAG_PDF * 4 * 2 + 5).map(name => ({ name })) as unknown as NametTagEntry[];
    const jobs = buildPdfJobs(mkParsed({ nametags }), mkSettings());
    expect(jobs.map(j => j.filename)).toEqual(['Test2026_nametags.pdf']);
  });
});

describe('merging every round into one scorecard PDF', () => {
  const rounds = mkParsed({
    firstRound: [sc(1, 'A'), cover(1)], intermediate: [sc(2, 'B')], semis: [sc(3, 'C')], finals: [sc(4, 'D')],
    extras: [sc(1)],
  });
  const names = (jobs: PdfJob[]) => jobs.map(j => j.filename);

  it('emits one tagged PDF and leaves extras apart', () => {
    const jobs = buildPdfJobs(rounds, mkSettings({ mergeScorecardRounds: true }));
    expect(names(jobs)).toEqual(['Test2026_scorecards.pdf', 'Test2026_extras.pdf']);
    expect(jobs.map(j => j.kind === 'scorecards' && j.mergedRounds === true)).toEqual([true, false]);
  });

  // The print guide: cut every sheet, then stack the top-left, top-right, bottom-left and
  // bottom-right piles. Joining per-round stacks interleaved the rounds in that deck.
  it('cuts and stacks into each round in turn, keeping prefilled round 2 unsorted', () => {
    const cards = (round: number, ns: string[]) => ns.map(n => sc(round, n));
    const firstRound = finalizeEntries(cards(1, ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']));
    const intermediate = stackQuadrants(cards(2, ['B2', 'B0', 'B1']));
    const jobs = buildPdfJobs(mkParsed({ firstRound, intermediate }), mkSettings({ mergeScorecardRounds: true }));
    const { entries } = jobs[0] as Extract<PdfJob, { kind: 'scorecards' }>;
    expect(entries.length % 4).toBe(0);
    const piles = [0, 1, 2, 3].flatMap(q => entries.filter((_, i) => i % 4 === q));
    expect(piles.flatMap(e => (e.kind === 'scorecard' ? [e.name] : [])))
      .toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'B2', 'B0', 'B1']);
  });

  it('prints each round in turn, unpadded, on A6', () => {
    const firstRound = finalizeEntries([sc(1, 'A1'), sc(1, 'A0')]);
    const finals = finalizeEntries([sc(4, 'D0')]);
    const jobs = buildPdfJobs(mkParsed({ firstRound, finals }), mkSettings({ mergeScorecardRounds: true, scorecardsA6: true }));
    expect((jobs[0] as Extract<PdfJob, { kind: 'scorecards' }>).entries.map(e => e.kind === 'scorecard' && e.name))
      .toEqual(['A0', 'A1', 'D0']);
  });

  // "Latest round only" reprints must still say which round they are.
  it('keeps the round name when only one round has cards', () => {
    const jobs = buildPdfJobs(mkParsed({ finals: [sc(4, 'D')] }), mkSettings({ mergeScorecardRounds: true }));
    expect(names(jobs)).toEqual(['Test2026_finals.pdf']);
  });

  it('gives way to the stage split and the large-file split', () => {
    for (const over of [{ splitPdfsByStage: true }, { splitLargePdfs: true }])
      expect(names(buildPdfJobs(rounds, mkSettings({ mergeScorecardRounds: true, ...over }))))
        .toEqual(['Test2026_round1.pdf', 'Test2026_round2.pdf', 'Test2026_semis.pdf', 'Test2026_finals.pdf', 'Test2026_extras.pdf']);
  });

  it('flags the merged file once it passes the cap, though no round does alone', () => {
    const half = Array.from({ length: MAX_PAGES_PER_SCORECARD_PDF * 2 + 2 }, (_, i) => sc(1, `N${i}`));
    const parsed = mkParsed({ firstRound: half, finals: half.map(e => ({ ...e, roundNum: 4 })) });
    expect(hasOversizedPdf(buildPdfJobs(parsed, mkSettings()), false)).toBe(false);
    expect(hasOversizedPdf(buildPdfJobs(parsed, mkSettings({ mergeScorecardRounds: true })), false)).toBe(true);
  });
});

// Opt-in from /generate, for a machine that cannot hold one merged file.
describe('splitting large files on request', () => {
  const CAP = MAX_PAGES_PER_SCORECARD_PDF * 4;
  const names = (n: number) => Array.from({ length: n }, (_, i) => `Name ${String(i).padStart(4, '0')}`);
  const event = (eventId: string, timeslot: string, n: number) =>
    names(n).map(name => ({ ...sc(1, name), eventId, eventName: `Event ${eventId}`, timeslot }) as ScorecardEntry);
  const split = (parsed: Partial<ParsedWCIF>, over: Partial<CompetitionSettings> = {}) =>
    buildPdfJobs(mkParsed(parsed), mkSettings({ splitLargePdfs: true, ...over }));
  const scorecards = (jobs: PdfJob[]) => jobs as Extract<PdfJob, { kind: 'scorecards' }>[];

  it('leaves a bucket at the cap alone', () => {
    expect(split({ firstRound: finalizeEntries(event('333', 'a01', CAP)) }).map(j => j.filename))
      .toEqual(['Test2026_round1.pdf']);
  });

  it('cuts one PDF per event, in schedule order, then sheet-aligned parts', () => {
    const jobs = scorecards(split({
      firstRound: finalizeEntries([...event('333', 'a02', CAP * 2 + 5), ...event('222', 'a01', 6)]),
    }));
    expect(jobs.map(j => j.filename)).toEqual([
      'Test2026_round1_222.pdf',
      'Test2026_round1_333_part1.pdf', 'Test2026_round1_333_part2.pdf', 'Test2026_round1_333_part3.pdf',
    ]);
    for (const job of jobs) expect(job.entries.length).toBeLessThanOrEqual(CAP);
    for (const job of jobs.slice(1, -1)) expect(job.entries.length % 4).toBe(0);
    // Every 333 card, each part re-finalized together: nothing lost or duplicated.
    const real = jobs.slice(1).flatMap(j => j.entries).filter(e => e.kind === 'scorecard');
    expect(real).toHaveLength(CAP * 2 + 5);
  });

  // A split cut from the 4-up order would interleave every part across the whole event.
  it('on A6, makes each part a contiguous run of the sorted deck', () => {
    const count = MAX_PAGES_PER_SCORECARD_PDF * 2 + 3;
    const cards = event('333', 'a01', count);
    const jobs = scorecards(split({ firstRound: finalizeEntries([...cards]) }, { scorecardsA6: true }));
    expect(jobs.map(j => j.filename)).toEqual([1, 2, 3].map(i => `Test2026_round1_333_part${i}.pdf`));
    for (const job of jobs) expect(job.entries.length).toBeLessThanOrEqual(MAX_PAGES_PER_SCORECARD_PDF);
    expect(jobs.flatMap(j => j.entries).map(e => (e.kind === 'scorecard' ? e.name : 'cover')))
      .toEqual(names(count));
  });

  it('still splits per event inside a stage', () => {
    const staged = (stage: string, eventId: string, ts: string, n: number) =>
      event(eventId, ts, n).map(e => ({ ...e, stage }));
    const jobs = split({
      firstRound: finalizeEntries([
        ...staged('blue', '333', 'a01', CAP), ...staged('blue', '222', 'a02', 40), ...staged('red', '333', 'a01', 8),
      ]),
    }, { splitPdfsByStage: true });
    expect(jobs.map(j => j.filename)).toEqual([
      'Test2026_round1_blue_333.pdf', 'Test2026_round1_blue_222.pdf', 'Test2026_round1_red.pdf',
    ]);
  });

  it('cuts name tags into whole-sheet parts, in order, losing nobody', () => {
    const tagCap = MAX_PAGES_PER_NAMETAG_PDF * 4;
    const nametags = names(tagCap * 2 + 5).map(name => ({ name })) as unknown as NametTagEntry[];
    const jobs = split({ nametags }) as Extract<PdfJob, { kind: 'nametags' }>[];
    expect(jobs.map(j => j.filename)).toEqual([1, 2, 3].map(i => `Test2026_nametags_part${i}.pdf`));
    for (const job of jobs.slice(0, -1)) expect(job.nametags.length % 4).toBe(0);
    expect(jobs.flatMap(j => j.nametags)).toEqual(nametags);
  });

  it('is only offered when a file is past the cap', () => {
    const jobs = (n: number, a6 = false) =>
      buildPdfJobs(mkParsed({ firstRound: finalizeEntries(event('333', 'a01', n)) }), mkSettings({ scorecardsA6: a6 }));
    expect(hasOversizedPdf(jobs(CAP), false)).toBe(false);
    expect(hasOversizedPdf(jobs(CAP + 1), false)).toBe(true);
    // A6 holds a quarter of the cards per page cap.
    expect(hasOversizedPdf(jobs(MAX_PAGES_PER_SCORECARD_PDF + 1, true), true)).toBe(true);
  });
});

// Colour-coded paper per stage: each stage becomes its own PDF so it is one pile at the printer.
describe('splitting a scorecard bucket by stage', () => {
  /** What the parser hands `buildPdfJobs`: sorted, padded, quadrant-reordered. */
  function staged(spec: { stage?: string; count: number; eventId?: string; timeslot?: string }[]) {
    return finalizeEntries(spec.flatMap(({ stage, count, eventId = '333', timeslot = 'a01' }) =>
      Array.from({ length: count }, (_, i) => ({
        ...sc(1, `Name ${stage ?? 'x'} ${String(i).padStart(4, '0')}`, stage),
        eventId, eventName: `Event ${eventId}`, timeslot,
      })),
    ));
  }

  const split = (parsed: Partial<ParsedWCIF>) =>
    buildPdfJobs(mkParsed(parsed), mkSettings({ splitPdfsByStage: true }));

  it('writes one PDF per stage', () => {
    const jobs = split({ firstRound: staged([{ stage: 'blue', count: 6 }, { stage: 'red', count: 6 }]) });

    expect(jobs.map(j => j.filename))
      .toEqual(['Test2026_round1_blue.pdf', 'Test2026_round1_red.pdf']);
    expect(jobs.map(j => j.label)).toEqual(['Round 1 (Blue)', 'Round 1 (Red)']);
  });

  it('puts every card in its own stage file and loses none', () => {
    const jobs = split({
      firstRound: staged([{ stage: 'blue', count: 6 }, { stage: 'red', count: 9 }]),
    }) as Extract<PdfJob, { kind: 'scorecards' }>[];

    const real = (j: PdfJob & { kind: 'scorecards' }) =>
      j.entries.filter(e => e.kind === 'scorecard' || e.eventId !== '');
    expect(real(jobs[0])).toHaveLength(6);
    expect(real(jobs[1])).toHaveLength(9);
    for (const job of jobs) {
      // Each file pads on its own, so no printed sheet straddles two stages.
      expect(job.entries.length % 4).toBe(0);
      expect(new Set(real(job).map(e => e.stage))).toHaveLength(1);
    }
  });

  it('splits every round bucket, not just round 1', () => {
    const jobs = split({
      firstRound: staged([{ stage: 'blue', count: 4 }, { stage: 'red', count: 4 }]),
      finals: staged([{ stage: 'blue', count: 4 }, { stage: 'red', count: 4 }]),
    });
    expect(jobs.map(j => j.filename)).toEqual([
      'Test2026_round1_blue.pdf', 'Test2026_round1_red.pdf',
      'Test2026_finals_blue.pdf', 'Test2026_finals_red.pdf',
    ]);
  });

  it('leaves the bucket alone when the setting is off', () => {
    const firstRound = staged([{ stage: 'blue', count: 6 }, { stage: 'red', count: 6 }]);
    expect(buildPdfJobs(mkParsed({ firstRound }), mkSettings()).map(j => j.filename))
      .toEqual(['Test2026_round1.pdf']);
  });

  it('leaves a single-stage competition alone', () => {
    const jobs = split({ firstRound: staged([{ stage: 'main', count: 8 }]) });
    expect(jobs.map(j => j.filename)).toEqual(['Test2026_round1.pdf']);
  });

  // Prefilled round 2 deals the round-1 qualifiers before stages are known, so those cards
  // carry no stage and the whole bucket has to stay in one file.
  it('leaves the bucket alone when any real card has no stage', () => {
    const jobs = split({
      intermediate: staged([{ stage: 'blue', count: 4 }, { stage: undefined, count: 4 }]),
    });
    expect(jobs.map(j => j.filename)).toEqual(['Test2026_round2.pdf']);
  });

  it('gives stage names that sanitise alike distinct filenames', () => {
    const jobs = split({
      firstRound: staged([{ stage: 'salle rouge', count: 4 }, { stage: 'salle/rouge', count: 4 }]),
    });
    expect(new Set(jobs.map(j => j.filename)).size).toBe(jobs.length);
    expect(jobs.map(j => j.filename))
      .toEqual(['Test2026_round1_salle_rouge.pdf', 'Test2026_round1_salle_rouge_2.pdf']);
  });

  it('zips the stage files rather than shipping a bare PDF', () => {
    const jobs = split({ firstRound: staged([{ stage: 'blue', count: 4 }, { stage: 'red', count: 4 }]) });
    expect(downloadTarget(jobs, 'Test2026').filename).toBe('Test2026_pdfs.zip');
  });
});

// A6 prints one card per page, so the cut-and-stack order and its padding must be gone.
describe('A6 scorecards', () => {
  const names = ['Eve', 'Bob', 'Dan', 'Amy', 'Cal'];
  const entries = (): ScorecardData[] => finalizeEntries([cover(), ...names.map(n => sc(1, n))]);
  const scorecardJobs = (parsed: ParsedWCIF, a6: boolean) =>
    buildPdfJobs(parsed, mkSettings({ scorecardsA6: a6 })) as Extract<PdfJob, { kind: 'scorecards' }>[];
  const label = (e: ScorecardData) => (e.kind === 'scorecard' ? e.name : 'cover');

  it('prints in plain sorted order with no padding covers', () => {
    expect(scorecardJobs(mkParsed({ firstRound: entries() }), true)[0].entries.map(label))
      .toEqual(['cover', 'Amy', 'Bob', 'Cal', 'Dan', 'Eve']);
  });

  it('leaves the 4-up order untouched otherwise', () => {
    expect(scorecardJobs(mkParsed({ firstRound: entries() }), false)[0].entries).toEqual(entries());
  });

  it('keeps each stage file in sorted order', () => {
    const staged = finalizeEntries(['Bob', 'Amy', 'Cal'].flatMap(n => [sc(1, n, 'blue'), sc(1, n, 'red')]));
    const jobs = buildPdfJobs(mkParsed({ firstRound: staged }), mkSettings({ scorecardsA6: true, splitPdfsByStage: true })) as
      Extract<PdfJob, { kind: 'scorecards' }>[];
    expect(jobs.map(j => j.entries.map(label))).toEqual([['Amy', 'Bob', 'Cal'], ['Amy', 'Bob', 'Cal']]);
  });
});
