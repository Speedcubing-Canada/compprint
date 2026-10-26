// Fixtures shared by the tests and by scripts/renderFixtures.ts, so a new setting
// has one place to be added rather than three.

import type {
  Activity, Assignment, ChildActivity, Event, EventId, Person, Room, RoundFormat, WCIF,
} from '../types/wcif';
import type { CompetitionSettings } from '../types/settings';
import type { WCAToken, WCAUser } from '../auth/wca';

export const organizer: WCAUser = {
  id: 1, name: 'Test Organizer', wca_id: '2010TEST01', email: '', avatar: { thumb_url: '' },
};

/** Issued now, so it has its whole 2h life ahead. */
export function freshToken(over: Partial<WCAToken> = {}): WCAToken {
  return {
    access_token: 'test-token', refresh_token: 'test-refresh', token_type: 'Bearer',
    scope: 'public manage_competitions', expires_in: 7200, created_at: Math.floor(Date.now() / 1000), ...over,
  };
}

/** A complete, plausible settings object. Override only what the test exercises. */
export function testSettings(over: Partial<CompetitionSettings> = {}): CompetitionSettings {
  return {
    competitionId: 'GrosJouetsaMontreal2026',
    competitionName: 'Gros Jouets à Montréal 2026',
    language: 'en',
    secondaryLanguage: null,
    paperFormat: 'LETTER',
    secondRoundMode: 'prefilled',
    logoDataUrl: null,
    useDefaultLogo: true,
    scorecardCompNameWithLogo: false,
    liveResultsMode: 'wca-live',
    wcaLiveId: null,
    wcaLivePersonIds: null,
    hideWcaLiveId: false,
    nametagLogoMode: 'with-name',
    nametagQrMode: 'back-only',
    nametagLayout: 'vertical',
    customEvents: [],
    scorecardCheckMode: 'per-group-card',
    splitPdfsByStage: false, mergeScorecardRounds: false,
    scorecardsA6: false,
    otsBlanks: false,
    staffNametags: true,
    finalStationNumbers: true,
    stationsPerStage: null,
    scrambleDoubleCheck: false,
    scrambleDoubleCheckRounds: ['finals'],
    scrambleDoubleCheckOverrides: {},
    scrambleDoubleCheckWorldTop: null,
    scrambleDoubleCheckRegionTop: null,
    scrambleDoubleCheckRegionScope: 'national',
    generationScope: {
      mode: 'everything',
      documents: {
        scorecards: true, scheduleTracker: true, nametags: true,
        roundChecklist: true, firstTimerSlips: true, groupOverview: true,
      },
    },
    isCustomCompetition: false,
    ...over,
  };
}

const DAY = '2026-05-16';
const at = (hhmm: string) => `${DAY}T${hhmm}:00Z`;

function round(id: string, format: RoundFormat) {
  return {
    id, format,
    timeLimit: { centiseconds: 18000, cumulativeRoundIds: [] },
    cutoff: null,
    participationRuleset: null,
    scrambleSetCount: 1,
    results: [],
  };
}

function group(id: number, code: string, start: string, end: string): ChildActivity {
  return { id, name: '', activityCode: code, startTime: at(start), endTime: at(end), childActivities: [], scrambleSets: [] };
}

function activity(id: number, code: string, start: string, end: string, children: ChildActivity[]): Activity {
  return { id, name: '', activityCode: code, startTime: at(start), endTime: at(end), childActivities: children, scrambleSets: [] };
}

function person(
  registrantId: number, name: string, wcaId: string | null,
  eventIds: EventId[], activityIds: number[],
  staff: Partial<Record<'staff-scrambler' | 'staff-runner' | 'staff-judge', number[]>> = {},
): Person {
  return {
    registrantId, name, wcaUserId: registrantId, wcaId,
    countryIso2: 'CA', gender: registrantId % 2 ? 'm' : 'f',
    registration: { wcaRegistrationId: registrantId, eventIds, status: 'accepted', isCompeting: true },
    avatar: null, roles: [], personalBests: [],
    assignments: [
      ...activityIds.map((activityId, i) => ({
        activityId, assignmentCode: 'competitor' as const, stationNumber: i + 1,
      })),
      ...Object.entries(staff).flatMap(([code, ids]) =>
        ids.map((activityId) => ({
          activityId, assignmentCode: code as Assignment['assignmentCode'], stationNumber: null,
        }))),
    ],
  };
}

/**
 * A one-day competition that fills every bucket `parseWCIF` produces, so
 * `buildPdfJobs` on it emits one job of every kind. Two 3x3 rounds (groups in
 * round 1, a final), a 2x2 final, and one competitor with no WCA ID so the
 * first-timer slips are non-empty.
 */
export function sampleWcif(): WCIF {
  const events: Event[] = [
    { id: '333', rounds: [round('333-r1', 'a'), round('333-r2', 'a')], qualification: null },
    { id: '222', rounds: [round('222-r1', 'a')], qualification: null },
  ];

  const room: Room = {
    id: 1, name: 'Main Stage', color: '#2196f3',
    activities: [
      activity(10, '333-r1', '09:00', '10:30', [
        group(101, '333-r1-g1', '09:00', '09:45'),
        group(102, '333-r1-g2', '09:45', '10:30'),
      ]),
      activity(20, '222-r1', '10:30', '11:30', [group(201, '222-r1-g1', '10:30', '11:30')]),
      activity(30, '333-r2', '13:00', '14:00', [group(301, '333-r2-g1', '13:00', '14:00')]),
    ],
  };

  const persons: Person[] = [
    person(1, 'Ada Lovelace',   '2018LOVE01', ['333', '222'], [101, 201, 301], { 'staff-judge': [102] }),
    person(2, 'Grace Hopper',   '2019HOPP01', ['333'],        [101, 301],      { 'staff-scrambler': [102], 'staff-runner': [201] }),
    person(3, 'Alan Turing',    '2020TURI01', ['333', '222'], [102, 201],      { 'staff-judge': [101, 301] }),
    person(4, 'Nouvelle Venue', null,         ['333', '222'], [102, 201],      { 'staff-scrambler': [101] }),
  ];

  return {
    formatVersion: '2.2',
    id: 'GrosJouetsaMontreal2026',
    name: 'Gros Jouets à Montréal 2026',
    shortName: 'Gros Jouets 2026',
    persons, events,
    schedule: {
      startDate: DAY, numberOfDays: 1,
      venues: [{
        id: 1, name: 'Venue', latitudeMicrodegrees: 45508888, longitudeMicrodegrees: -73561668,
        countryIso2: 'CA', timezone: 'America/Toronto', rooms: [room],
      }],
    },
    competitorLimit: null,
  };
}
