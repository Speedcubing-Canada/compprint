import { describe, it, expect } from 'vitest';
import { buildPdfJobs, downloadTarget, guideSections } from './pdfJobs';
import type { PdfJob } from './pdfJobs';
import { filterParsedByScope } from './generationScope';
import { finalizeEntries, type ParsedWCIF, type ScorecardData, type ScorecardEntry, type CoverEntry, type NametTagEntry } from './wcif-parser';
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

// Past the cap, a bucket becomes one PDF per event.
describe('splitting an oversized scorecard bucket', () => {
  const CAP = MAX_PAGES_PER_SCORECARD_PDF * 4;

  // What the parser hands `buildPdfJobs`: sorted, padded to a multiple of 4, quadrant-reordered.
  function bucket(spec: { eventId: string; timeslot: string; count: number }[]) {
    return finalizeEntries(spec.flatMap(({ eventId, timeslot, count }) =>
      Array.from({ length: count }, (_, i) => ({
        ...sc(), eventId, eventName: `Event ${eventId}`, timeslot,
        name: `Name ${String(i).padStart(4, '0')}`,
      })),
    ));
  }

  it('keeps a bucket at the threshold as a single PDF', () => {
    const jobs = buildPdfJobs(
      mkParsed({ firstRound: bucket([{ eventId: '333', timeslot: 'a01', count: CAP }]) }),
      mkSettings(),
    );
    expect(jobs.map(j => j.filename)).toEqual(['Test2026_round1.pdf']);
  });

  it('splits one PDF per event once past it', () => {
    const jobs = buildPdfJobs(mkParsed({
      firstRound: bucket([
        { eventId: '333', timeslot: 'a01', count: CAP },
        { eventId: '222', timeslot: 'a02', count: 40 },
      ]),
    }), mkSettings());

    expect(jobs.map(j => j.filename))
      .toEqual(['Test2026_round1_333.pdf', 'Test2026_round1_222.pdf']);
    // Ordered by when the round runs, not by event id.
    expect(jobs.map(j => j.label))
      .toEqual(['Round 1 (Event 333)', 'Round 1 (Event 222)']);
  });

  it('pads every file to a full 4-up sheet and loses no card', () => {
    const counts = { '333': CAP, '222': 41, '444': 6 };
    const jobs = buildPdfJobs(mkParsed({
      firstRound: bucket([
        { eventId: '333', timeslot: 'a01', count: counts['333'] },
        { eventId: '222', timeslot: 'a02', count: counts['222'] },
        { eventId: '444', timeslot: 'a03', count: counts['444'] },
      ]),
    }), mkSettings()) as Extract<PdfJob, { kind: 'scorecards' }>[];

    for (const job of jobs) {
      expect(job.entries.length % 4).toBe(0);
      const eventId = job.filename.replace('Test2026_round1_', '').replace('.pdf', '');
      const real = job.entries.filter(e => e.kind === 'scorecard' || e.eventId !== '');
      // Every card of that event, and nothing from another event.
      expect(real).toHaveLength(counts[eventId as keyof typeof counts]);
      expect(new Set(real.map(e => e.eventId))).toEqual(new Set([eventId]));
    }
  });

  it('leaves extras alone - they are not finalizeEntries output', () => {
    const extras = Array.from({ length: 8 }, () => sc());
    const jobs = buildPdfJobs(mkParsed({ extras }), mkSettings());
    const extraJob = jobs.find(j => j.filename === 'Test2026_extras.pdf');
    expect((extraJob as Extract<PdfJob, { kind: 'scorecards' }>).entries).toBe(extras);
  });
});

// One event over the cap on its own gets cut into sheet-aligned parts.
describe('splitting a single oversized event', () => {
  const CAP = MAX_PAGES_PER_SCORECARD_PDF * 4;

  function oneEvent(count: number) {
    return finalizeEntries(Array.from({ length: count }, (_, i) => ({
      ...sc(), eventId: '333', eventName: '3x3x3 Cube', timeslot: 'a01',
      name: `Name ${String(i).padStart(5, '0')}`,
    })));
  }

  const scorecardJobsOf = (count: number) =>
    buildPdfJobs(mkParsed({ firstRound: oneEvent(count) }), mkSettings())
      .filter(j => j.kind === 'scorecards') as Extract<PdfJob, { kind: 'scorecards' }>[];

  it('is one unnumbered file while the event fits', () => {
    expect(scorecardJobsOf(CAP).map(j => j.filename)).toEqual(['Test2026_round1.pdf']);
  });

  it('numbers the parts and keeps every file under the cap', () => {
    const jobs = scorecardJobsOf(CAP * 3 + 4);
    expect(jobs.map(j => j.filename)).toEqual([
      'Test2026_round1_333_part1.pdf',
      'Test2026_round1_333_part2.pdf',
      'Test2026_round1_333_part3.pdf',
      'Test2026_round1_333_part4.pdf',
    ]);
    expect(jobs.map(j => j.label)).toEqual([
      'Round 1 (3x3x3 Cube) 1/4', 'Round 1 (3x3x3 Cube) 2/4',
      'Round 1 (3x3x3 Cube) 3/4', 'Round 1 (3x3x3 Cube) 4/4',
    ]);
    for (const job of jobs) expect(job.entries.length).toBeLessThanOrEqual(CAP);
  });

  it('cuts only on whole 4-up sheets, in pile order, losing nothing', () => {
    const all = oneEvent(CAP * 2 + 17);
    const jobs = buildPdfJobs(mkParsed({ firstRound: all }), mkSettings())
      .filter(j => j.kind === 'scorecards') as Extract<PdfJob, { kind: 'scorecards' }>[];

    // Every part but the last is a whole number of sheets, so no sheet straddles two files.
    for (const job of jobs.slice(0, -1)) expect(job.entries.length % 4).toBe(0);
    // Concatenating the parts reproduces the pile exactly.
    expect(jobs.flatMap(j => j.entries)).toEqual(all);
  });
});

describe('splitting an oversized name tag document', () => {
  const CAP = MAX_PAGES_PER_NAMETAG_PDF * 4;
  const mkTags = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `Tag ${i}` })) as unknown as NametTagEntry[];
  const tagJobs = (n: number) =>
    buildPdfJobs(mkParsed({ nametags: mkTags(n) }), mkSettings())
      .filter(j => j.kind === 'nametags') as Extract<PdfJob, { kind: 'nametags' }>[];

  it('is one unnumbered file at the cap', () => {
    const jobs = tagJobs(CAP);
    expect(jobs.map(j => j.filename)).toEqual(['Test2026_nametags.pdf']);
    expect(jobs[0].nametags).toHaveLength(CAP);
  });

  it('splits into whole-sheet parts past it, in order and losing nobody', () => {
    const tags = mkTags(CAP * 2 + 5);
    const jobs = buildPdfJobs(mkParsed({ nametags: tags }), mkSettings())
      .filter(j => j.kind === 'nametags') as Extract<PdfJob, { kind: 'nametags' }>[];

    expect(jobs.map(j => j.filename)).toEqual([
      'Test2026_nametags_part1.pdf', 'Test2026_nametags_part2.pdf', 'Test2026_nametags_part3.pdf',
    ]);
    for (const job of jobs) expect(job.nametags.length).toBeLessThanOrEqual(CAP);
    for (const job of jobs.slice(0, -1)) expect(job.nametags.length % 4).toBe(0);
    expect(jobs.flatMap(j => j.nametags)).toEqual(tags);
  });
});

// The pile is chronological, so the files are too; same slot tie-breaks on event id.
describe('ordering the per-event files', () => {
  const CAP = MAX_PAGES_PER_SCORECARD_PDF * 4;

  // Two events, each under the cap alone, together over it: splits per event, no _partN files.
  const PER_EVENT = Math.floor(CAP * 0.6 / 4) * 4;

  function bucketOf(spec: { eventId: string; timeslots: string[] }[]) {
    return finalizeEntries(spec.flatMap(({ eventId, timeslots }) => {
      const perSlot = Math.ceil(PER_EVENT / timeslots.length);
      return timeslots.flatMap((timeslot, t) =>
        Array.from({ length: perSlot }, (_, i) => ({
          ...sc(), eventId, eventName: `Event ${eventId}`, timeslot,
          name: `Name ${t}-${String(i).padStart(4, '0')}`,
        })));
    }));
  }
  const names = (parsed: ParsedWCIF) =>
    buildPdfJobs(parsed, mkSettings()).filter(j => j.kind === 'scorecards').map(j => j.filename);

  it('orders by the earliest slot an event runs in, not the first one seen', () => {
    // 444's entries include an early slot that is not its first in encounter order.
    expect(names(mkParsed({ firstRound: bucketOf([
      { eventId: '333', timeslots: ['a05'] },
      { eventId: '444', timeslots: ['a09', 'a01'] },
    ]) }))).toEqual(['Test2026_round1_444.pdf', 'Test2026_round1_333.pdf']);
  });

  it('breaks a same-slot tie on event id, both ways round', () => {
    const tied = (first: string, second: string) => names(mkParsed({
      firstRound: bucketOf([
        { eventId: first, timeslots: ['a01'] },
        { eventId: second, timeslots: ['a01'] },
      ]),
    }));
    expect(tied('333', '222')).toEqual(['Test2026_round1_222.pdf', 'Test2026_round1_333.pdf']);
    expect(tied('222', '333')).toEqual(['Test2026_round1_222.pdf', 'Test2026_round1_333.pdf']);
  });
});

// Colour-coded paper per stage: each stage becomes its own PDF so it is one pile at the printer.
describe('splitting a scorecard bucket by stage', () => {
  const CAP = MAX_PAGES_PER_SCORECARD_PDF * 4;

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

  it('still splits per event and per cap inside a stage', () => {
    const jobs = split({
      firstRound: staged([
        { stage: 'blue', count: CAP, eventId: '333', timeslot: 'b01' },
        { stage: 'blue', count: 40, eventId: '222', timeslot: 'b02' },
        { stage: 'red', count: 8, eventId: '333', timeslot: 'r01' },
      ]),
    });
    expect(jobs.map(j => j.filename)).toEqual([
      'Test2026_round1_blue_333.pdf',
      'Test2026_round1_blue_222.pdf',
      'Test2026_round1_red.pdf',
    ]);
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
  const jobEntries = (a6: boolean) =>
    (buildPdfJobs(mkParsed({ firstRound: entries() }), mkSettings({ scorecardsA6: a6 }))[0] as
      Extract<PdfJob, { kind: 'scorecards' }>).entries;

  it('prints in plain sorted order with no padding covers', () => {
    expect(jobEntries(true).map(e => (e.kind === 'scorecard' ? e.name : 'cover')))
      .toEqual(['cover', 'Amy', 'Bob', 'Cal', 'Dan', 'Eve']);
  });

  it('leaves the 4-up order untouched otherwise', () => {
    expect(jobEntries(false)).toEqual(entries());
  });

  it('drops the padding from extras but keeps their order', () => {
    const extras = finalizeEntries([sc(1, 'Zed')]).reverse();
    const job = buildPdfJobs(mkParsed({ extras }), mkSettings({ scorecardsA6: true }))[0];
    expect(job.kind === 'scorecards' && job.entries).toEqual(extras.filter(e => e.kind === 'scorecard'));
  });
});
