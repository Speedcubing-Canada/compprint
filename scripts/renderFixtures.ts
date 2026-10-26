// Render every PDF document from the REAL components, headlessly, for layout verification.
//
//   npm run render:fixtures            # vertical nametags (default)
//   npm run render:fixtures -- --horizontal
//
// Writes to ../current-output/, which the pdf-print-edit skill diffs against
// ../original-output/. Renders the shipping components, never a copy of them.
//
// Run through vite-node, not node: the documents are .tsx, and Node's native type
// stripping does not handle JSX.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';

import { NametTagDocument } from '../src/pdf/NametTagDocument';
import { FirstTimerSlipDocument } from '../src/pdf/FirstTimerSlipDocument';
import { ScorecardDocument } from '../src/pdf/ScorecardDocument';
import { ScheduleTrackerDocument } from '../src/pdf/ScheduleTrackerDocument';
import { CheckingSheetDocument } from '../src/pdf/CheckingSheetDocument';
import { GroupOverviewDocument } from '../src/pdf/GroupOverviewDocument';
import type {
  NametTagEntry, FirstTimerEntry, ScorecardData, ScheduleDay, CheckingDay, GroupOverviewEntry,
} from '../src/lib/wcif-parser';
import { finalizeEntries, parseWCIF } from '../src/lib/wcif-parser';
import { buildCustomEntries } from '../src/lib/customScorecards';
import type { CompetitionSettings } from '../src/types/settings';
import { testSettings } from '../src/test/fixtures';
import { corpus } from '../src/test/corpus';
import { buildPdfJobs } from '../src/lib/pdfJobs';
import { jobElement } from '../src/pdf/jobElement';
import { scorecardsPerPage } from '../src/pdf/layoutConstants';

const __dir = dirname(fileURLToPath(import.meta.url));
// ../../current-output is outside the git repo, so CI overrides this.
const OUT_DIR = process.env.FIXTURE_OUT_DIR
  ? resolve(process.env.FIXTURE_OUT_DIR)
  : resolve(__dir, '../../current-output');

// Pinned rather than inherited: a test that changes a testSettings default must not be able
// to silently rewrite every fixture PDF. New fields still default from testSettings.
function settings(over: Partial<CompetitionSettings> = {}): CompetitionSettings {
  return testSettings({
    language: 'en',
    secondaryLanguage: null,
    paperFormat: 'LETTER',
    secondRoundMode: 'prefilled',
    useDefaultLogo: true,
    scorecardCompNameWithLogo: false,
    logoDataUrl: null,
    liveResultsMode: 'wca-live',
    hideWcaLiveId: false,
    nametagLogoMode: 'with-name',
    nametagQrMode: 'back-only',
    nametagLayout: 'vertical',
    scorecardCheckMode: 'per-group-card',
    scrambleDoubleCheck: false,
    scorecardsA6: false,
    ...over,
  });
}

// The real Gros Jouets 2026 export, vendored into the repo: the original lives above the git
// root, and its directory names carry accents that do not round-trip on WSL/NTFS.
function loadNametagFixture(): {
  entries: NametTagEntry[];
  wcaLivePersonIds: Record<number, string>;
  competitionId: string;
  competitionName: string;
  wcaLiveId: string;
} {
  const raw = readFileSync(resolve(__dir, '../tests/fixtures/gj_2026_nametags.js'), 'utf-8');

  // The legacy export is a script that assigns onto `window`.
  const fake: Record<string, unknown> = {};
  new Function('window', raw)(fake);

  type LegacyCompetitor = {
    name: string; wca_id?: string; live_id: string; competitor_id: string;
    gender: 'm' | 'f' | 'o'; title_en: string; title_fr: string; events: string[];
    groups?: string[]; scramble?: string[]; judge?: string[]; run?: string[];
  };
  const competitors = fake.competitors as LegacyCompetitor[];

  // The export carries the rendered title, not the role, and the role drives the badge fill.
  // The live app reads `person.roles` off the WCIF instead.
  const roleOf = (titleEn: string): NametTagEntry['role'] =>
    titleEn === 'DELEGATE' ? 'delegate'
      : titleEn === 'ORGANIZER' ? 'organizer'
      : titleEn === 'NEW COMPETITOR' ? 'new-competitor'
      : 'competitor';

  const entries: NametTagEntry[] = competitors.map((c) => ({
    name: c.name,
    wcaId: c.wca_id || '',
    // live_id is competitiongroups' sequential person id (registrantId);
    // competitor_id is the WCA user account id used by WCA Live.
    registrantId: parseInt(c.live_id, 10),
    wcaUserId: parseInt(c.competitor_id, 10),
    // Unused here: the fixture renders WCA Live QR codes, which key off registrantId.
    registrationId: 0,
    gender: c.gender,
    role: roleOf(c.title_en),
    // From the export rather than getNametTagTitleStrings, so the fixture reproduces the
    // original PDF exactly. The fixture supplies data, the component supplies layout.
    titleFront: c.title_fr,
    titleBack: c.title_en,
    events: c.events,
    // 'Aucun' stays in the arrays (it is a rendered value, not an absence).
    compete: (c.groups ?? []).sort(),
    scramble: (c.scramble ?? []).sort(),
    judge: (c.judge ?? []).sort(),
    run: (c.run ?? []).sort(),
  }));

  // Production fills this from the WCA Live GraphQL API. Without it QrSection falls back to
  // the bare domain, whose QR is too sparse to judge how a real code block prints.
  //
  // Seeded from wcaUserId to keep the baseline byte-identical. The account id is NOT a WCA
  // Live person id, so these QR codes do not resolve: fixture-only, never production.
  const wcaLivePersonIds: Record<number, string> = {};
  for (const e of entries) wcaLivePersonIds[e.registrantId] = String(e.wcaUserId);

  return {
    entries,
    wcaLivePersonIds,
    competitionId: fake.competitionId as string,
    competitionName: fake.competitionName as string,
    wcaLiveId: fake.wcaLive as string,
  };
}

// The real newcomer list, reconstructed from the original slips PDF so the output can be
// diffed against original-output/. A live WCIF shows birthdates only when DOB is exposed.
const FIRST_TIMERS: FirstTimerEntry[] = [
  { name: 'Alex Yang',           gender: 'm', birthdate: '2008-12-06', countryIso2: 'CA', eventIds: ['444', '555', '666', '777'] },
  { name: 'Alexandre Fredette',  gender: 'm', birthdate: '2015-01-13', countryIso2: 'CA', eventIds: ['444', 'minx'] },
  { name: 'Alexandre Mailloux',  gender: 'm', birthdate: '2016-01-26', countryIso2: 'CA', eventIds: ['555', 'minx'] },
  { name: 'Ali Hakim',           gender: 'm', birthdate: '2016-01-29', countryIso2: 'CA', eventIds: ['444'] },
  { name: 'Brandon Morrissette', gender: 'm', birthdate: '2014-02-13', countryIso2: 'CA', eventIds: ['minx'] },
  { name: 'Lou Brunet',          gender: 'm', birthdate: '2017-01-29', countryIso2: 'CA', eventIds: ['444'] },
  { name: 'Paul Boutin',         gender: 'm', birthdate: '2015-04-29', countryIso2: 'CA', eventIds: ['444'] },
  { name: 'Raphaël Rishan',      gender: 'm', birthdate: '2016-06-04', countryIso2: 'CA', eventIds: ['444', 'minx'] },
  { name: 'Ryan Lee',            gender: 'm', birthdate: '2015-07-21', countryIso2: 'CA', eventIds: ['444'] },
  { name: 'Shawn Kang',          gender: 'm', birthdate: '2012-09-07', countryIso2: 'KR', eventIds: ['444'] },
  { name: 'Yuri Famelis',        gender: 'm', birthdate: '2015-07-02', countryIso2: 'CA', eventIds: ['444', 'minx'] },
];

// A 4-up sheet with one card per ROW_HEIGHTS entry, so a change to any shows on one page.
function scorecardFixture(): ScorecardData[] {
  const base = {
    kind: 'scorecard' as const,
    timeslot: '2026-05-30T09:00:00',
    roundLabel: 'Round 1',
    roundNum: 1,
    group: '1',
    wcaId: '2019FRED01',
    gender: 'm',
    isCumulative: false,
  };
  return finalizeEntries([
    { ...base, name: 'Alexandre Fredette', eventId: '333',  eventName: '3x3x3 Cube',        liveId: '1', format: 'avg5', cutoff: '',     limit: '10:00' },
    { ...base, name: 'Marie-Ève Tremblay', eventId: '444',  eventName: '4x4x4 Cube',        liveId: '2', format: 'mo3',  cutoff: '1:30', limit: '2:00'  },
    { ...base, name: 'Jean-Philippe Roy',  eventId: '666',  eventName: '6x6x6 Cube',        liveId: '3', format: 'bo2',  cutoff: '',     limit: '6:00'  },
    { ...base, name: 'Yuri Famelis',       eventId: '333fm', eventName: 'FMC',              liveId: '4', format: 'bo1',  cutoff: '',     limit: ''      },
  ]);
}

// Header name sizing: two lines, one line above the wrap threshold, no space, short, and two
// that need the embedded font (Polish, Vietnamese).
const LONG_NAMES = ['André Rodrigo César Pinheiro Monte Amado', 'Matheus de Souza Macêdo',
  'Wolfeschlegelsteinhausenbergerdorff', 'Ali Hakim', 'Łukasz Żółtowski-Świętochowski',
  'Nguyễn Thị Minh Khai Phương'];
function longNameFixture(): ScorecardData[] {
  const cards = scorecardFixture();
  return LONG_NAMES.map((name, i) => ({ ...cards[i % cards.length], name }));
}

// Name tag sizing: one line, the old 12pt line, and names that wrap (one at the 20pt cap).
const LONG_TAG_NAMES = ['Ali Hakim', 'Jean-Philippe Beaulieu-Roy', 'Juan Nicolás Pinzón Martínez',
  'Łukasz Żółtowski-Świętochowski'];

// A per-group cover (French, long labels) and a per-round one: the delegate's check card.
const COVERS: ScorecardData[] = finalizeEntries([
  { kind: 'cover', timeslot: 'A01', eventId: '555', eventName: 'Cube 5x5x5', roundLabel: 'Tour Final',
    roundNum: 3, group: 'Groupe 1 de 3', stage: 'hall', numScorecards: 14, numGroups: 1,
    startTime: '10:30', endTime: '11:15' },
  { kind: 'cover', timeslot: 'A02', eventId: '333', eventName: '3x3x3 Cube', roundLabel: 'Round 2',
    roundNum: 2, group: '', stage: 'hall', numScorecards: 48, numGroups: 3,
    startTime: '13:00', endTime: '14:30' },
]);

// Two days, a second room on day 1 (the tracker's room dimension, which the checklist has
// not) and a lunch break each day (the thick break rule). Both are ruled tables: their
// borders and row tints show up in a pixel diff and nowhere else.
const SCHEDULE_DAYS: ScheduleDay[] = [
  {
    dayLabel: 'Day 1 - Saturday',
    stages: [
      {
        stageName: 'Red Stage',
        rows: [
          { startTime: '09:00', endTime: '10:00', eventRound: '3x3x3 Cube Round 1',  breakBefore: false },
          { startTime: '10:00', endTime: '11:00', eventRound: '2x2x2 Cube Round 1',  breakBefore: false },
          { startTime: '13:00', endTime: '14:30', eventRound: '4x4x4 Cube Round 1',  breakBefore: true  },
        ],
      },
      {
        stageName: 'Blue Stage',
        rows: [
          { startTime: '09:00', endTime: '10:30', eventRound: 'Megaminx Round 1',    breakBefore: false },
          { startTime: '13:00', endTime: '14:00', eventRound: 'Pyraminx Round 1',    breakBefore: true  },
        ],
      },
    ],
  },
  {
    dayLabel: 'Day 2 - Sunday',
    stages: [
      {
        stageName: 'Red Stage',
        rows: [
          { startTime: '09:00', endTime: '10:00', eventRound: '3x3x3 Cube Round 2',  breakBefore: false },
          { startTime: '12:30', endTime: '13:30', eventRound: '3x3x3 Cube Final',    breakBefore: true  },
        ],
      },
    ],
  },
];

const CHECKING_DAYS: CheckingDay[] = [
  {
    dayLabel: 'Day 1 - Saturday',
    rows: [
      // Round 1 ships with its first two boxes already ticked; later rounds ship blank.
      { startTime: '09:00', endTime: '10:00', eventRound: '3x3x3 Cube Round 1', groupCount: 3, preChecked: true,  breakBefore: false },
      { startTime: '09:00', endTime: '10:30', eventRound: 'Megaminx Round 1',   groupCount: 2, preChecked: true,  breakBefore: false },
      { startTime: '13:00', endTime: '14:30', eventRound: '4x4x4 Cube Round 1', groupCount: 2, preChecked: true,  breakBefore: true  },
    ],
  },
  {
    dayLabel: 'Day 2 - Sunday',
    rows: [
      { startTime: '09:00', endTime: '10:00', eventRound: '3x3x3 Cube Round 2', groupCount: 2, preChecked: false, breakBefore: false },
      { startTime: '12:30', endTime: '13:30', eventRound: '3x3x3 Cube Final',   groupCount: 1, preChecked: false, breakBefore: true  },
    ],
  },
];

// Worst case on purpose: a long event+stage heading, a full 14-competitor group next to a
// 12-judge one, and a group with no staff at all (the pre-assignment state).
const NAMES = [
  'Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Katherine Johnson', 'Edsger Dijkstra',
  'Barbara Liskov', 'Donald Knuth', 'Margaret Hamilton', 'Alonzo Church', 'Radia Perlman',
  'John von Neumann', 'Frances Allen', 'Claude Shannon', 'Jean Bartik',
];

const GROUP_OVERVIEW: GroupOverviewEntry[] = [
  {
    dayLabel: 'Day 1 - Saturday',
    heading: '3x3x3 One-Handed Round 1 - Group 1 (Red)',
    startTime: '09:00', endTime: '09:25', room: 'Salon des Congrès',
    eventId: '333oh', roundNum: 1,
    competitors: NAMES,
    scramblers: NAMES.slice(0, 2),
    runners: NAMES.slice(2, 4),
    judges: NAMES.slice(1, 13),
  },
  {
    dayLabel: 'Day 1 - Saturday',
    heading: '3x3x3 One-Handed Round 1 - Group 2 (Blue)',
    startTime: '09:25', endTime: '09:50', room: 'Salon des Congrès',
    eventId: '333oh', roundNum: 1,
    competitors: NAMES.slice(0, 6),
    scramblers: NAMES.slice(4, 5),
    runners: NAMES.slice(5, 6),
    judges: NAMES.slice(6, 11),
  },
  {
    dayLabel: 'Day 2 - Sunday',
    heading: '3x3x3 Cube Final - Group 1',
    startTime: '12:30', endTime: '13:30', room: 'Main Stage',
    eventId: '333', roundNum: 3,
    competitors: NAMES.slice(0, 8),
    scramblers: [], runners: [], judges: [],
  },
];

/**
 * One file of a real competition, through the real parser and job planner, cut to its first
 * `sheets` pages so the baseline stays small.
 */
function corpusFile(id: string, over: Partial<CompetitionSettings>, suffix: string, sheets: number) {
  const wcif = corpus().find(([cid]) => cid === id)![1];
  const s = settings({ competitionId: id, competitionName: wcif.name, ...over });
  const parsed = parseWCIF(wcif, s);
  const job = buildPdfJobs(parsed, s).find((j) => j.filename === `${id}_${suffix}.pdf`);
  if (job?.kind !== 'scorecards') throw new Error(`${id} has no ${suffix} scorecards`);
  const cut = { ...job, entries: job.entries.slice(0, sheets * scorecardsPerPage(s.scorecardsA6)) };
  return jobElement(cut, parsed, s);
}

async function write(name: string, element: React.ReactElement): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(element as any);
  mkdirSync(OUT_DIR, { recursive: true });
  const out = resolve(OUT_DIR, name);
  writeFileSync(out, buffer);
  console.log(`  → ${out}`);
}

async function main() {
  const horizontal = process.argv.includes('--horizontal');
  const e = React.createElement;

  const nt = loadNametagFixture();
  // Matches the original name tags: French main, English back, no logo. Change these and
  // the diff against original-output/ stops meaning anything.
  const ntSettings = settings({
    competitionId: nt.competitionId,
    competitionName: nt.competitionName,
    wcaLiveId: nt.wcaLiveId,
    wcaLivePersonIds: nt.wcaLivePersonIds,
    language: 'fr',
    secondaryLanguage: 'en',
    useDefaultLogo: false,
    nametagLogoMode: 'hidden',
    nametagLayout: horizontal ? 'horizontal' : 'vertical',
  });

  console.log(`Rendering ${nt.entries.length} name tags (${ntSettings.nametagLayout})…`);
  await write(
    `${nt.competitionId}_nametags.pdf`,
    e(NametTagDocument, { nametags: nt.entries, settings: ntSettings }),
  );

  console.log(`Rendering ${FIRST_TIMERS.length} first-timer slips…`);
  await write(
    `${nt.competitionId}_first_timers.pdf`,
    e(FirstTimerSlipDocument, { entries: FIRST_TIMERS, settings: settings() }),
  );

  const cards = scorecardFixture();
  console.log(`Rendering ${cards.length} scorecards…`);
  await write(
    'scorecard-layout-test.pdf',
    e(ScorecardDocument, { entries: cards, settings: settings() }),
  );
  await write(
    'scorecard-layout-test-a4.pdf',
    e(ScorecardDocument, { entries: cards, settings: settings({ paperFormat: 'A4' }) }),
  );
  await write(
    'scorecard-layout-test-a6.pdf',
    e(ScorecardDocument, { entries: cards, settings: settings({ scorecardsA6: true }) }),
  );

  await write(
    'scorecard-long-names-test.pdf',
    e(ScorecardDocument, { entries: longNameFixture(), settings: settings() }),
  );

  // The tightest header: small logo beside the comp name.
  await write(
    'nametag-long-names-test.pdf',
    e(NametTagDocument, {
      nametags: LONG_TAG_NAMES.map((name, i) => ({ ...nt.entries[i], name })),
      settings: { ...ntSettings, useDefaultLogo: true, nametagLogoMode: 'with-name', nametagLayout: 'vertical' },
    }),
  );

  // Non-competing staff: QR codes on both sides, no events, competition-level links.
  const [d, v, ...rest] = nt.entries;
  await write(
    'nametag-staff-test.pdf',
    e(NametTagDocument, {
      nametags: [
        { ...d!, role: 'delegate', staff: true, events: [] },
        { ...v!, role: 'staff', staff: true, events: [], wcaId: '', titleFront: 'STAFF', titleBack: 'STAFF' },
        ...rest.slice(0, 2),
      ],
      settings: ntSettings,
    }),
  );

  await write(
    'cover-layout-test.pdf',
    e(ScorecardDocument, { entries: COVERS, settings: settings({ language: 'fr' }) }),
  );

  // A custom event with a CSV list (named cards padded to a sheet) beside one of blanks.
  const custom = settings({
    customEvents: [
      { name: 'Team Blind', iconDataUrl: null, format: 'mo3', cutoff: '', limit: '5:00',
        competitors: [{ name: 'Ali Hakim', wcaId: '2019HAKI01' }, { name: 'Matheus de Souza Macêdo', wcaId: '' }] },
      { name: '3x3 With Feet', iconDataUrl: null, format: 'avg5', cutoff: '1:30', limit: '3:00' },
    ],
  });
  await write('custom-event-test.pdf', e(ScorecardDocument, {
    entries: custom.customEvents.flatMap((c) => buildCustomEntries(c)), settings: custom,
  }));

  // Brazil's preset: every round in one cut deck, Portuguese.
  await write('merged-rounds-test.pdf',
    corpusFile('CuberBrasilSumare2026', { language: 'pt', mergeScorecardRounds: true }, 'scorecards', 3));
  // Spare cards per event, plus the OTS blanks.
  await write('extras-test.pdf',
    corpusFile('PickeringBlindfolded2026', { otsBlanks: true }, 'extras', 6));

  console.log(`Rendering schedule tracker (${SCHEDULE_DAYS.length} days)…`);
  await write(
    'schedule-layout-test.pdf',
    e(ScheduleTrackerDocument, { days: SCHEDULE_DAYS, settings: settings() }),
  );

  console.log(`Rendering Round Checklist (${CHECKING_DAYS.length} days)…`);
  await write(
    'checklist-layout-test.pdf',
    e(CheckingSheetDocument, { days: CHECKING_DAYS, settings: settings() }),
  );

  for (const language of ['fr', 'es', 'pt'] as const) {
    await write(
      `checklist-layout-test-${language}.pdf`,
      e(CheckingSheetDocument, { days: CHECKING_DAYS, settings: settings({ language }) }),
    );
  }

  console.log(`Rendering Group Overview (${GROUP_OVERVIEW.length} groups)…`);
  await write(
    'group-overview-layout-test.pdf',
    e(GroupOverviewDocument, { entries: GROUP_OVERVIEW, settings: settings() }),
  );

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
