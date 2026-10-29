import type { WCIF, Round, EventId, Assignment, ChildActivity, PersonalBest } from '../types/wcif';
import type { CompetitionSettings, DoubleCheckRound } from '../types/settings';
import { getStrings, getEventName, getFirstTimerSlipStrings, getNametTagTitleStrings, getNametTagStrings, getShortNametTagNames, type NametTagTitleStrings } from './i18n';
import { packSlipPages } from '../pdf/firstTimerSlipLines';
import { buildScheduleDays, scheduleLabels, type CheckingDay, type ScheduleDay } from './scheduleRows';
import { cmp } from './sort';
import { buildVenueSchedule, type VenueSchedule } from './venueSchedule';
import { parseActivityCode, roundIdOf, type ActivityCode } from './activityCode';

export type ScorecardFormat = 'avg5' | 'bo2-avg5' | 'mo3' | 'bo1-mo3' | 'bo2' | 'bo1';


export const WCA_EVENT_ORDER: EventId[] = [
  '333','222','444','555','666','777','333bf','333fm','333oh',
  'clock','minx','pyram','skewb','sq1','fto','444bf','555bf','333mbf',
];

export type NametTagRole = 'delegate' | 'organizer' | 'new-competitor' | 'competitor' | 'staff';

export interface NametTagEntry {
  name: string;
  wcaId: string;
  // Three different ids, none interchangeable:
  //   registrantId   - 1..N within the competition; the number scoretakers type, and the
  //                    Competition Groups / WCA Live person key
  //   wcaUserId      - the person's WCA website account id
  //   registrationId - the global registration row id; the one in an ILR competitor URL
  registrantId: number;
  wcaUserId: number;
  registrationId: number;
  gender: 'm' | 'f' | 'o';
  role: NametTagRole;
  titleFront: string;
  titleBack: string;
  events: EventId[];
  compete: string[];
  scramble: string[];
  judge: string[];
  run: string[];
  // On-the-spot fill-in tag: QR codes point at the competition, not a person.
  blank?: boolean;
  // Non-competing staff or official: no personal results to link.
  staff?: boolean;
}

// One per accepted newcomer, for the confirmation slip the delegate attaches after the
// first solve.
export interface FirstTimerEntry {
  name: string;
  gender: 'm' | 'f' | 'o';
  // ISO date (YYYY-MM-DD) or null/undefined when the WCIF doesn't expose DOB.
  birthdate?: string | null;
  countryIso2: string;
  eventIds: EventId[];
  // On-the-spot fill-in slip: every field is a line to write on.
  blank?: boolean;
}

// Drops the "(local name)" suffix. NFC, since the PDF fonts have accented letters but no
// standalone combining marks (a decomposed ư would lose its horn).
export function printedName(name: string): string {
  return name.replace(/ \(.*\)$/, '').normalize('NFC');
}

function buildDuties(
  assignments: Assignment[],
  code: Assignment['assignmentCode'],
  activityCodeMap: Record<number, string>,
  shortNames: Record<string, string>,
  dutyGroup: (groupList: string) => string,
): string[] {
  const byEvent: Record<string, Set<number>> = {};
  for (const a of assignments) {
    if (a.assignmentCode !== code) continue;
    const actCode = activityCodeMap[a.activityId];
    if (!actCode) continue;
    const parsed = parseActivityCode(actCode);
    if (parsed?.group === undefined) continue;
    (byEvent[parsed.eventId] ??= new Set()).add(parsed.group);
  }

  if (Object.keys(byEvent).length === 0) return [];

  return Object.entries(byEvent)
    .map(([eventId, groups]) => {
      const shortName = shortNames[eventId] ?? eventId;
      const groupList = [...groups].sort((a, b) => a - b).join(' & ');
      return `${shortName}: ${dutyGroup(groupList)}`;
    })
    .sort();
}

export interface ScorecardEntry {
  kind: 'scorecard';
  timeslot: string;
  eventId: string;
  eventName: string;
  roundLabel: string;
  // 1-based, 0 for custom events. Lets the scope filter select by (eventId, roundNum)
  // without re-parsing labels.
  roundNum: number;
  group: string;
  // The cover label of the group when `group` is a station number, so the cover sorts on top.
  coverGroup?: string;
  // Keeps stages grouped in finalizeEntries when `group` is a station number that omits the
  // stage. Undefined on blank/prefilled entries, which fall through to group sorting.
  stage?: string;
  name: string;
  wcaId: string;
  liveId: string;
  gender: string;
  cutoff: string;
  // '' leaves the prompt for the delegate to fill in; null is a custom event with no limit.
  limit: string | null;
  format: ScorecardFormat;
  isCumulative: boolean;
  // Overrides EVENT_ICONS lookup when set (used for custom events).
  iconDataUrl?: string;
  // When true, render a second scrambler-signature column (scramble double-checking).
  scrambleDoubleCheck?: boolean;
}

export interface CoverEntry {
  kind: 'cover';
  timeslot: string;
  eventId: string;
  eventName: string;
  roundLabel: string;
  roundNum: number;
  group: string;
  // See ScorecardEntry.stage - keeps a stationary round's cover with its own stage's cards.
  stage?: string;
  numScorecards: number;
  // Always 1 for per-group covers; the collapsed count for 'per-round-card' ones, which
  // render it instead of a group label.
  numGroups: number;
  // Scheduled local "HH:MM"; a 'per-round-card' cover spans its whole round.
  startTime?: string;
  endTime?: string;
}

export type ScorecardData = ScorecardEntry | CoverEntry;

// One scheduled group, with everyone assigned to it. The inverse of the per-person duty
// lines on a nametag: this is what gets posted at the stage.
export interface GroupOverviewEntry {
  // Chronological sort key, also used to group blocks under a day heading.
  dayLabel: string;
  heading: string;    // "3x3x3 Cube Round 1 - Group 2"
  startTime: string;  // local "09:00"
  endTime: string;
  room: string;
  eventId: string;
  roundNum: number;
  // Station order when the WCIF assigns stations, alphabetical otherwise. The document
  // prints the 1..N ordinal, which is the station number in the former case.
  competitors: string[];
  scramblers: string[];
  runners: string[];
  judges: string[];
}

export interface ParsedWCIF {
  firstRound: ScorecardData[];
  // Round 2 of events with 3+ rounds. Prefilled means N covers plus every round-1
  // participant on a blank group label; blanks means blank entries per group.
  intermediate: ScorecardData[];
  // Rounds 3..N-1 of events with 4+ rounds (semi-finals). Always blank.
  semis: ScorecardData[];
  // Final round of every event with 2+ rounds. Always blank.
  finals: ScorecardData[];
  nametags: NametTagEntry[];
  // One confirmation slip per accepted newcomer (no WCA ID), sorted by name.
  firstTimers: FirstTimerEntry[];
  // One blank scorecard per round per event (sorted by schedule order).
  extras: ScorecardData[];
  // Schedule tracker data in chronological (day-primary) order.
  scheduleDays: ScheduleDay[];
  // One row per round, always built. filterParsedByScope empties it unless the Round
  // Checklist was selected, which is what gates rendering.
  checkingDays: CheckingDay[];
  // One entry per scheduled group, chronological. Emptied by filterParsedByScope unless the
  // Group Overview was selected.
  groupOverview: GroupOverviewEntry[];
  // The WCA-style events table and daily schedule. Nulled by filterParsedByScope unless selected.
  venueSchedule: VenueSchedule | null;
  // True once the schedule has group child-activities. False for a fresh pre-competition
  // WCIF, which is why scorecard counts read 0.
  hasGroups: boolean;
  // Rounds >= 2 whose groups were generated mid-competition. Empty for a pre-competition
  // WCIF. Drives the scope prompt, sorted by event order then round number.
  laterRoundsWithAssignments: { eventId: string; roundNum: number }[];
  // Most stages any one round runs across. 1 when the competition uses a single room.
  stageCount: number;
  // First room's station count found in the WCIF, `null` when no tool recorded one.
  stations: { count: number; source: 'groupifier' | 'assignments' } | null;
}

// A ParsedWCIF with nothing in it - used by custom (non-WCA) competitions, which
// have no WCIF at all: only settings.customEvents drive the generated PDFs.
export function emptyParsedWcif(): ParsedWCIF {
  return {
    firstRound: [],
    intermediate: [],
    semis: [],
    finals: [],
    nametags: [],
    firstTimers: [],
    extras: [],
    scheduleDays: [],
    checkingDays: [],
    groupOverview: [],
    venueSchedule: null,
    hasGroups: true,
    laterRoundsWithAssignments: [],
    stageCount: 1,
    stations: null,
  };
}

const EMPTY_COVER: CoverEntry = {
  kind: 'cover', timeslot: 'ZZZ', eventId: '' as EventId,
  eventName: '', roundLabel: '', roundNum: 0, group: '', numScorecards: 0, numGroups: 0,
};

function padToMultipleOfFour(arr: ScorecardData[]): void {
  const rem = arr.length % 4;
  if (rem !== 0) for (let i = 0; i < 4 - rem; i++) arr.push(EMPTY_COVER);
}

// Blind events always show 3 attempt rows regardless of round.format in WCIF.
const BLIND_EVENTS = new Set(['444bf', '555bf']);

function getScorecardFormat(eventId: string, round: Round): ScorecardFormat {
  if (eventId === '333mbf') return 'bo2';
  if (BLIND_EVENTS.has(eventId)) return round.cutoff ? 'bo1-mo3' : 'mo3';
  if (round.format === '2') return 'bo2';
  if (round.format === '3' || round.format === 'm') return round.cutoff ? 'bo1-mo3' : 'mo3';
  return round.cutoff ? 'bo2-avg5' : 'avg5';
}

function reorderQuadrants<T>(items: T[]): T[] {
  const n = items.length;
  if (n === 0) return items;
  const indices = Array.from({ length: n }, (_, i) => i);
  let quadrant = 0;
  for (let i = 1; i < n; i++) {
    let next = indices[i - 1] + 4;
    if (next >= n) { quadrant++; next = quadrant; }
    indices[i] = next;
  }
  const result = new Array<T>(n);
  indices.forEach((out, inp) => { result[out] = items[inp]; });
  return result;
}

/** Inverse of the cut-and-stack order, minus padding covers: plain sorted order for 1-up printing. */
export function unstackQuadrants(items: ScorecardData[]): ScorecardData[] {
  const out: ScorecardData[] = [];
  for (let q = 0; q < 4; q++)
    for (let i = q; i < items.length; i += 4) out.push(items[i]);
  return realEntries(out);
}

/** Cut-and-stack order for an already sorted 1-up list, padded to whole sheets. */
export function stackQuadrants(items: ScorecardData[]): ScorecardData[] {
  const out = [...items];
  padToMultipleOfFour(out);
  return reorderQuadrants(out);
}

// Names and stage keys (from room names) need collation; timeslots, event ids and group labels
// are ASCII and compare as plain strings. Shared Collators, because `localeCompare` rebuilds
// one per call and these comparators run n log n times.
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base' });
const stageCollator = new Intl.Collator();
const byName = (a: string, b: string) => nameCollator.compare(a, b);

// Padding covers (added to round a bucket up to a multiple of 4) carry an empty eventId.
// Strip them before re-filtering or re-splitting, so finalizeEntries can re-pad cleanly.
export function realEntries(entries: ScorecardData[]): ScorecardData[] {
  return entries.filter((e) => e.kind === 'scorecard' || e.eventId !== '');
}

const pileOf = (e: ScorecardData) => (e.kind === 'scorecard' && e.coverGroup) || e.group;

// Sort by timeslot → eventId → stage → group → cover-before-scorecard → station → name.
// The stage key keeps each stage's cards together on stationary rounds, where `group` is a
// station number that omits the stage; on rotation rounds it is a no-op.
// Group before kind puts each cover immediately ahead of its own scorecards, so the
// quad-reorder yields one correctly ordered pile per group.
export function finalizeEntries(entries: ScorecardData[]): ScorecardData[] {
  if (entries.length === 0) return [];
  entries.sort((a, b) => {
    if (a.timeslot !== b.timeslot) return a.timeslot < b.timeslot ? -1 : 1;
    if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1;
    const as = a.stage ?? '', bs = b.stage ?? '';
    if (as !== bs) return as < bs ? -1 : 1;
    const ag = pileOf(a), bg = pileOf(b);
    if (ag !== bg) return ag < bg ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.group !== b.group) return a.group < b.group ? -1 : 1;
    const an = a.kind === 'scorecard' ? a.name : '';
    const bn = b.kind === 'scorecard' ? b.name : '';
    return byName(an, bn);
  });
  return stackQuadrants(entries);
}

// Intermediate prefilled finalize: sort by timeslot → eventId → cover-before-scorecard → name.
// This keeps each event's covers and participant cards as a contiguous block.
function finalizeEntriesIntermediate(entries: ScorecardData[]): ScorecardData[] {
  if (entries.length === 0) return [];
  entries.sort((a, b) => {
    if (a.timeslot !== b.timeslot) return a.timeslot < b.timeslot ? -1 : 1;
    if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const an = a.kind === 'scorecard' ? a.name : '';
    const bn = b.kind === 'scorecard' ? b.name : '';
    return byName(an, bn);
  });
  return stackQuadrants(entries);
}

// Group words that precede a group number in a group activity name, across locales.
const GROUP_WORDS = new Set(['group', 'groupe', 'grupo', 'gruppe', 'gr']);

/**
 * The stage named inside a group activity's own name, relative to its parent round's name.
 *
 * Competitions model stages two ways. Most give each stage its own WCIF room ("Blue Stage",
 * "Red Stage"), which `distinguishingNames` handles. The rest pack every stage into one room
 * and name the stage in each group instead, reusing the same activity code across stages
 * (NAC 2026: one "Hall B" holding Red/Blue/Green/Orange, all as `555-r1-g1`..`g3`).
 *
 * Takes what follows the round-name prefix and drops the group-number tokens: a bare number,
 * a "g1" token, or a group word. What is left is the stage. Returns '' when the name does not
 * start with the round name, so an unexpected format never invents a stage.
 */
export function subStageLabel(roundName: string, groupName: string): string {
  if (!groupName.startsWith(roundName)) return '';
  return groupName.slice(roundName.length)
    .split(/[\s,]+/)
    .filter(t => t !== '' && !/^\d+$/.test(t) && !/^g\d+$/i.test(t) && !GROUP_WORDS.has(t.toLowerCase()))
    .join(' ');
}

export function parseWCIF(wcif: WCIF, settings: CompetitionSettings): ParsedWCIF {
  const { language, secondaryLanguage, secondRoundMode } = settings;
  // Station labels are primary-only, so the secondary language is irrelevant here.
  const strings = getStrings(language);

  // The round rule keys off the destination bucket (1:1 with the emitted PDFs); the override
  // and ranking rules match a named card's WCA ID + event across every round.
  const dcEnabled = settings.scrambleDoubleCheck === true;
  const dcRounds = new Set(settings.scrambleDoubleCheckRounds ?? []);
  const dcOverrides = settings.scrambleDoubleCheckOverrides ?? {};
  const dcWorldTop = settings.scrambleDoubleCheckWorldTop ?? null;
  const dcRegionTop = settings.scrambleDoubleCheckRegionTop ?? null;
  const dcRegionScope = settings.scrambleDoubleCheckRegionScope ?? 'national';

  // Personal bests per WCA ID, for the ranking rule. Newcomers have neither an ID nor bests.
  const dcPersonalBests = new Map<string, PersonalBest[]>();
  if (dcEnabled && (dcWorldTop || dcRegionTop))
    for (const person of wcif.persons)
      if (person.wcaId) dcPersonalBests.set(person.wcaId, person.personalBests ?? []);

  // Regulation 11i1a/b: a mis-scramble owes a replacement attempt only on a regional record
  // or a world-top-50 personal record. Single or average qualifies; below 1 means unranked.
  function rankedForDoubleCheck(wcaId: string, eventId: string): boolean {
    for (const pb of dcPersonalBests.get(wcaId) ?? []) {
      if (pb.eventId !== eventId) continue;
      if (dcWorldTop && pb.worldRanking >= 1 && pb.worldRanking <= dcWorldTop) return true;
      const regional = dcRegionScope === 'national' ? pb.nationalRanking : pb.continentalRanking;
      if (dcRegionTop && regional >= 1 && regional <= dcRegionTop) return true;
    }
    return false;
  }

  // `buckets` lists every round-category the card belongs to. A single-round event's
  // only round is both 'firstRound' and 'finals', so selecting either covers it.
  function wantsDoubleCheck(buckets: DoubleCheckRound[], wcaId: string, eventId: string): boolean {
    if (!dcEnabled) return false;
    if (buckets.some(b => dcRounds.has(b))) return true;
    if (!wcaId) return false; // override and ranking rules match named cards only
    const evs = dcOverrides[wcaId];
    if (evs && evs.includes(eventId)) return true;
    return rankedForDoubleCheck(wcaId, eventId);
  }

  // Front panels use the primary language; back panels use the secondary (or the
  // primary when there is none).
  const nametTagTitles = getNametTagTitleStrings(language, secondaryLanguage);
  const nametTagDutyStrings = getNametTagStrings(language);
  const shortNametTagNames = getShortNametTagNames(language);

  // Round keys with at least one real group child-activity. Drives the hasGroups flag and the
  // synthesis below: a later round is only synthesized when it has no real groups anywhere.
  const roundsWithRealGroups = new Set<string>();
  for (const venue of wcif.schedule.venues)
    for (const room of venue.rooms)
      for (const activity of room.activities)
        if (activity.childActivities.length > 0) {
          const code = parseActivityCode(activity.activityCode);
          if (code) roundsWithRealGroups.add(roundIdOf(code));
        }

  // Scramble-set count per round id ("333-r2") - used to pick how many implicit groups to
  // synthesize for a bare later round (organizers configure this when setting up the round).
  const roundScrambleSetCount: Record<string, number> = {};
  for (const event of wcif.events)
    for (const round of event.rounds)
      roundScrambleSetCount[round.id] = round.scrambleSetCount;

  // Accepted registrations per event id - the Round-1 field size for the advancement chain.
  const registeredCount: Record<string, number> = {};
  for (const person of wcif.persons) {
    if (!person.registration || person.registration.status !== 'accepted') continue;
    for (const eid of person.registration.eventIds)
      registeredCount[eid] = (registeredCount[eid] ?? 0) + 1;
  }

  // The child activities, one per scheduled group. A Round >= 2 scheduled as a bare time block
  // instead gets implicit groups synthesized from its scramble-set count (min 1) so its
  // scorecards still generate; round 1 and rounds with real groups never are.
  // Synthetic ids are deterministic negatives (-(activity.id*100+g)): the two call sites agree,
  // they cannot collide with real WCA ids, and the assignment-driven loops skip them.
  interface GroupUnit { id: number; name: string; activityCode: string; startTime: string; endTime: string; synthetic: boolean; }
  function groupUnitsOf(activity: { id: number; activityCode: string; startTime: string; endTime: string; childActivities: ChildActivity[] }): GroupUnit[] {
    if (activity.childActivities.length > 0)
      return activity.childActivities.map(c => ({
        id: c.id, name: c.name, activityCode: c.activityCode,
        startTime: c.startTime, endTime: c.endTime, synthetic: false,
      }));
    const code = parseActivityCode(activity.activityCode);
    if (code && code.group === undefined && code.attempt === undefined) {
      if (code.round >= 2 && !roundsWithRealGroups.has(activity.activityCode)) {
        const n = Math.max(1, roundScrambleSetCount[activity.activityCode] ?? 1);
        const units: GroupUnit[] = [];
        for (let g = 1; g <= n; g++)
          units.push({
            id: -(activity.id * 100 + g),
            // Synthesized, so there is no name to read a stage from.
            name: '',
            activityCode: `${activity.activityCode}-g${g}`,
            startTime: activity.startTime,
            endTime: activity.endTime,
            synthetic: true,
          });
        return units;
      }
    }
    return [];
  }

  const labels = scheduleLabels(wcif, settings.language);

  // Scheduled local times per `${roundKey}|${groupNum}|${stage}`, for the cover cards.
  const groupTimes: Record<string, { startTime: string; endTime: string }> = {};
  const timesOf = (rid: string, gNum: string, stage: string) => groupTimes[`${rid}|${gNum}|${stage}`];

  // Activity maps
  const activityCode: Record<number, string> = {};
  const activityStage: Record<number, string> = {};
  // Full room name per group activity - the Group Overview prints it verbatim, where
  // activityStage carries only the trimmed distinguishing token.
  const activityRoom: Record<number, string> = {};
  // WCIF room order per group activity, the Group Overview's tiebreak within a start time.
  const activityRoomIdx: Record<number, number> = {};
  const startTimes: Record<string, number[]> = {};
  // Unique group codes (e.g. "g1", "g2") per round key - avoids double-counting when
  // one logical group runs simultaneously across multiple rooms/stages.
  const roundGroupCodes: Record<string, Set<string>> = {};
  const roundStages: Record<string, Set<string>> = {}; // distinct stage colors per round key

  // A stage key is whatever distinguishes the rooms running THAT round; words shared by all of
  // them carry no information and are dropped ("Blue Stage"/"Red Stage" → blue/red). Scoped per
  // round, so an FMC side room elsewhere cannot stop the two main stages from trimming.
  function distinguishingNames(names: string[]): string[] {
    const full = names.map((n) => n.trim().toLowerCase());
    const words = full.map((n) => n.split(/\s+/));
    const shared = words[0].filter((w) => words.every((ws) => ws.includes(w)));
    const trimmed = words.map((ws) => ws.filter((w) => !shared.includes(w)).join(' '));
    // The key doubles as a sort key, so it has to stay distinct and non-empty per room.
    return trimmed.some((t) => !t) || new Set(trimmed).size !== new Set(full).size
      ? full : trimmed;
  }

  const allRooms = wcif.schedule.venues.flatMap((v) => v.rooms);
  // Only rooms that host groups: check-in/lunch/tutorial rooms would dilute the shared words.
  const roundRoomIdx = new Map<string, number[]>();
  allRooms.forEach((room, i) => {
    for (const activity of room.activities) {
      if (groupUnitsOf(activity).length === 0) continue;
      const code = parseActivityCode(activity.activityCode);
      if (!code) continue;
      const list = roundRoomIdx.get(roundIdOf(code)) ?? [];
      if (!list.includes(i)) list.push(i);
      roundRoomIdx.set(roundIdOf(code), list);
    }
  });
  const stageKey = new Map<string, string>(); // `${roundKey}|${roomIndex}` → stage key
  for (const [rk, idxs] of roundRoomIdx) {
    const keys = distinguishingNames(idxs.map((i) => allRooms[i].name));
    idxs.forEach((i, k) => stageKey.set(`${rk}|${i}`, keys[k]));
  }

  allRooms.forEach((room, roomIdx) => {
    for (const activity of room.activities) {
      const code = parseActivityCode(activity.activityCode);
      const roundKey = code ? roundIdOf(code) : '';
      const color = stageKey.get(`${roundKey}|${roomIdx}`) ?? room.name.trim().toLowerCase();
      // A room that packs several stages names them in its groups instead. Prefixed with the
      // room key only when the round also spans rooms, so two rooms' "Red" stay distinct.
      const sharesRound = (roundRoomIdx.get(roundKey)?.length ?? 1) > 1;
      for (const child of groupUnitsOf(activity)) {
        const token = subStageLabel(activity.name, child.name).trim().toLowerCase();
        const stage = !token ? color : sharesRound ? `${color} ${token}` : token;
        activityCode[child.id] = child.activityCode;
        activityStage[child.id] = stage;
        activityRoom[child.id] = room.name;
        activityRoomIdx[child.id] = roomIdx;
        if (!startTimes[child.startTime]) startTimes[child.startTime] = [];
        startTimes[child.startTime].push(child.id);
        // Unique codes, so one group split across rooms still counts once.
        const cCode = parseActivityCode(child.activityCode);
        if (cCode?.group !== undefined) {
          const rk = roundIdOf(cCode);
          groupTimes[`${rk}|${cCode.group}|${stage}`] = {
            startTime: labels.localTime(child.startTime), endTime: labels.localTime(child.endTime),
          };
          (roundGroupCodes[rk] ??= new Set()).add(`g${cCode.group}`);
        }
        if (roundKey) {
          if (!roundStages[roundKey]) roundStages[roundKey] = new Set();
          roundStages[roundKey].add(stage);
        }
      }
    }
  });

  // Groupifier records each room's station count. Delegate Dashboard only numbers stations per
  // assignment, so the highest one used in the room is the floor.
  const roomStations: ParsedWCIF['stations'][] = allRooms.map((room) => {
    const n = (room.extensions?.find((e) => e.id === 'groupifier.RoomConfig')?.data as
      { stations?: unknown } | undefined)?.stations;
    return typeof n === 'number' && n > 0 ? { count: n, source: 'groupifier' } : null;
  });
  for (const person of wcif.persons)
    for (const { activityId, stationNumber } of person.assignments ?? []) {
      const idx = activityRoomIdx[activityId];
      if (stationNumber == null || idx == null || roomStations[idx]?.source === 'groupifier') continue;
      roomStations[idx] = { count: Math.max(stationNumber, roomStations[idx]?.count ?? 0), source: 'assignments' };
    }

  // Derived from unique group codes, so one group running in two rooms counts once.
  const numGroups: Record<string, number> = Object.fromEntries(
    Object.entries(roundGroupCodes).map(([k, s]) => [k, s.size]),
  );

  // Chronological timeslot labels
  const timeslots: Record<number, string> = {};
  let slot = 1;
  for (const time of Object.keys(startTimes).sort()) {
    const stageSlots: Record<string, number[]> = {};
    for (const id of startTimes[time]) {
      const stage = activityStage[id];
      if (!stageSlots[stage]) stageSlots[stage] = [];
      stageSlots[stage].push(id);
    }
    for (const ids of Object.values(stageSlots))
      for (const id of ids) timeslots[id] = `${activityStage[id][0]}${String(slot).padStart(2, '0')}`;
    slot++;
  }

  // Round metadata
  const numRounds: Record<string, number> = {};
  const roundCutoff: Record<string, string> = {};
  const roundLimit: Record<string, string> = {};
  const roundFormat: Record<string, ScorecardFormat> = {};
  const roundCumulative: Record<string, boolean> = {};

  for (const event of wcif.events) {
    const eid = event.id;
    if (eid === '333fm') continue;
    numRounds[eid] = event.rounds.length;
    for (const round of event.rounds) {
      const rid = round.id;
      roundCutoff[rid] = round.cutoff ? centisecondsToTime(round.cutoff.resultValue) : '';
      roundLimit[rid] = eid === '333mbf' ? 'H1b'
        : round.timeLimit ? centisecondsToTime(round.timeLimit.centiseconds) : '';
      roundFormat[rid] = getScorecardFormat(eid, round);
      roundCumulative[rid] = round.timeLimit
        ? round.timeLimit.cumulativeRoundIds.length > 0 : false;
    }
  }

  // Chained forward from the accepted registration count: each round applies its participation
  // source to the source round's field (ranking → top X, percent → floor(value/100 x field)).
  // Linked (dual) rounds take the largest linked field. A resultAchieved or absent condition stops
  // the chain, leaving the flat blank fallback.
  const roundFieldSize: Record<string, number> = {};
  for (const event of wcif.events) {
    const eid = event.id;
    if (eid === '333fm') continue;
    const field: Record<string, number> = {};
    for (const [j, round] of event.rounds.entries()) {
      const src = round.participationRuleset?.participationSource;
      let n: number | undefined;
      if (src?.type === 'registrations' || (!src && j === 0)) n = registeredCount[eid] ?? 0;
      else if (src) {
        const ids = src.type === 'round' ? [src.roundId] : src.roundIds;
        const base = Math.max(...ids.map((id) => field[id] ?? NaN));
        const { type, value } = src.resultCondition;
        if (type === 'ranking' && value != null) n = value;
        else if (type === 'percent' && value != null && !Number.isNaN(base)) n = Math.floor((value / 100) * base);
      }
      if (n === undefined) break;
      field[round.id] = n;
      if (j > 0) roundFieldSize[round.id] = n;
    }
  }

  function centisecondsToTime(cs: number): string {
    const s = Math.floor(cs / 100);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function getRoundLabel(eventId: string, roundNum: number): string {
    const total = numRounds[eventId] ?? 1;
    if (roundNum === total) return strings.finalRound;
    return strings.roundName(roundNum, total);
  }

  // Used when a round spans multiple stages: "Rouge 3 of 4", "Rouge 3 de 4", etc.
  function buildGroupLabel(gNum: string, colour: string, total: number): string {
    const c = colour.charAt(0).toUpperCase() + colour.slice(1);
    return strings.colorGroupLabel(c, gNum, total);
  }

  // Used when all groups for a round are in a single stage: "Group 1 of 3".
  function simpleGroupLabel(gNum: string, total: number): string {
    return strings.groupLabel(gNum, total);
  }

  // One group per stage: "Red 1". There is no "of N" to add, and the competitor still has to
  // be told which stage to go to.
  function stageGroupLabel(colour: string, gNum: string): string {
    return `${colour.charAt(0).toUpperCase() + colour.slice(1)} ${gNum}`;
  }

  function resolveGroupLabel(rid: string, gNum: string, colour: string, total: number): string {
    // A round confined to one stage has nothing to name.
    if ((roundStages[rid]?.size ?? 1) <= 1) return simpleGroupLabel(gNum, total);
    return total > 1 ? buildGroupLabel(gNum, colour, total) : stageGroupLabel(colour, gNum);
  }

  function buildBlankGroupLabel(totalGroups: number): string {
    return strings.blankGroupLabel(totalGroups);
  }

  // Entry buckets
  const firstRoundEntries: ScorecardData[] = [];
  const intermediateEntries: ScorecardData[] = [];
  const semisEntries: ScorecardData[] = [];
  const finalsEntries: ScorecardData[] = [];

  // Round-1 participant list per event (for prefilled intermediate cards)
  const round1Participants: Record<string, ScorecardEntry[]> = {};
  // Group sizes per activity (for cover cards), keyed by activityId - covers every
  // round that has real assignments (round 1 always; rounds 2+ only when assigned).
  const namedGroupSizes: Record<number, Set<number>> = {};
  // Rounds (rid like "333-r2") with real competitor assignments and roundNum >= 2.
  // These are rendered as named scorecards and skipped by the blank/prefilled loops.
  const liveRounds = new Set<string>();
  // Whether the intermediate bucket holds any real-assignment named cards (vs prefilled
  // placeholders) - selects the finalize strategy below.
  let intermediateHasNamed = false;

  // Cover-card emission
  // Every cover goes through `pushCover`, so the mode is decided once. Gating must happen
  // here: finalizeEntries sorts, pads to a multiple of 4 and quadrant-reorders, so removing
  // entries afterwards corrupts the printed pile order.
  const checkMode = settings.scorecardCheckMode ?? 'per-group-card';
  // Keyed bucket → partition, the same partition the sort uses, so a collapsed cover still
  // lands at the head of its pile. Named rounds carry `stage` and get one cover per stage;
  // blank buckets have none and get one per round, unless `blankStage` turns it on.
  const roundCovers = new Map<ScorecardData[], Map<string, CoverEntry>>();

  // Blank rounds deliberately carry no stage: tagging them would split their collapsed
  // per-round cover (see the key below) and reorder their piles (finalizeEntries sorts on
  // stage). Only the per-stage PDF split, which needs both, turns it on.
  const blankStage = (stage: string) => (settings.splitPdfsByStage ? stage : undefined);

  function pushCover(target: ScorecardData[], cover: Omit<CoverEntry, 'numGroups'>): void {
    if (checkMode === 'none') return;
    if (checkMode === 'per-group-card') {
      target.push({ ...cover, numGroups: 1 });
      return;
    }
    const key = `${cover.eventId}|${cover.roundNum}|${cover.stage ?? ''}`;
    let bucket = roundCovers.get(target);
    if (!bucket) { bucket = new Map(); roundCovers.set(target, bucket); }
    const existing = bucket.get(key);
    if (existing) {
      // Mutated in place - `target` already holds this object, and finalize runs later.
      existing.numScorecards += cover.numScorecards;
      existing.numGroups += 1;
      if (cover.timeslot < existing.timeslot) existing.timeslot = cover.timeslot;
      if (cover.startTime && (!existing.startTime || cover.startTime < existing.startTime)) existing.startTime = cover.startTime;
      if (cover.endTime && (!existing.endTime || cover.endTime > existing.endTime)) existing.endTime = cover.endTime;
      return;
    }
    // '' sorts before every real group label, keeping the cover ahead of its cards.
    const collapsed: CoverEntry = { ...cover, group: '', numGroups: 1 };
    bucket.set(key, collapsed);
    target.push(collapsed);
  }

  // Named scorecard entries from person assignments
  for (const person of wcif.persons) {
    if (!person.registration || person.registration.status !== 'accepted') continue;

    const name = printedName(person.name);
    const isFemale = person.gender === 'f';
    const wcaId = person.wcaId
      ? person.wcaId
      : isFemale && strings.newCompetitorF !== strings.newCompetitor
        ? strings.newCompetitorF
        : strings.newCompetitor;
    const liveId = String(person.registrantId);

    for (const assignment of person.assignments) {
      if (assignment.assignmentCode !== 'competitor') continue;
      const aid = assignment.activityId;
      const code = activityCode[aid];
      if (!code) continue;

      const parsed = parseActivityCode(code);
      if (parsed?.group === undefined) continue;
      const { eventId, round: roundNum } = parsed;
      if (eventId === '333fm' || eventId === '333mbf') continue;
      const rid = roundIdOf(parsed);
      if (!roundFormat[rid]) continue;

      const total = numRounds[eventId] ?? 1;
      const isFirst = roundNum === 1;
      const isFinal = roundNum === total && total > 1;
      const isRound2 = roundNum === 2 && total >= 3;
      const isSemis = roundNum >= 3 && roundNum < total && total >= 4;

      // Round 1 is always named; rounds 2+ only when the WCIF carries this assignment. Each
      // card routes to the bucket matching its round, as the schedule loop classifies them.
      let targetBucket: ScorecardData[];
      let dcBuckets: DoubleCheckRound[];
      if (isFirst) {
        targetBucket = firstRoundEntries;
        dcBuckets = total === 1 ? ['firstRound', 'finals'] : ['firstRound'];
      } else if (isFinal) {
        targetBucket = finalsEntries;
        dcBuckets = ['finals'];
      } else if (isRound2) {
        targetBucket = intermediateEntries;
        dcBuckets = ['intermediate'];
        intermediateHasNamed = true;
      } else if (isSemis) {
        targetBucket = semisEntries;
        dcBuckets = ['semis'];
      } else {
        continue;
      }

      const gNum = String(parsed.group);
      const stage = activityStage[aid]?.toLowerCase() ?? 'hall';
      const totalGroups = numGroups[rid] ?? 1;

      const groupLabel = resolveGroupLabel(rid, gNum, stage, totalGroups);
      const group = assignment.stationNumber != null
        ? strings.stationLabel(String(assignment.stationNumber).padStart(2, '0'))
        : groupLabel;

      const entry: ScorecardEntry = {
        kind: 'scorecard',
        timeslot: timeslots[aid] ?? 'Z99',
        eventId,
        eventName: getEventName(eventId, language),
        roundLabel: getRoundLabel(eventId, roundNum),
        roundNum,
        group,
        ...(group !== groupLabel ? { coverGroup: groupLabel } : {}),
        stage,
        name,
        wcaId,
        liveId,
        gender: person.gender,
        cutoff: roundCutoff[rid],
        limit: roundLimit[rid],
        format: roundFormat[rid],
        isCumulative: roundCumulative[rid],
        scrambleDoubleCheck: wantsDoubleCheck(dcBuckets, wcaId, eventId),
      };

      targetBucket.push(entry);
      if (isFirst) {
        if (!round1Participants[eventId]) round1Participants[eventId] = [];
        round1Participants[eventId].push(entry);
      } else {
        liveRounds.add(rid);
      }
      if (!namedGroupSizes[aid]) namedGroupSizes[aid] = new Set();
      namedGroupSizes[aid].add(person.registrantId);
    }
  }

  // Cover cards (one per group) for every named round
  for (const [aidStr, ids] of Object.entries(namedGroupSizes)) {
    const aid = Number(aidStr);
    const code = activityCode[aid];
    if (!code) continue;
    const parsed = parseActivityCode(code);
    if (parsed?.group === undefined) continue;
    const { eventId, round: roundNum } = parsed;
    if (eventId === '333fm') continue;

    const rid = roundIdOf(parsed);
    const total = numRounds[eventId] ?? 1;
    const gNum = String(parsed.group);
    const stage = activityStage[aid]?.toLowerCase() ?? 'hall';
    const totalGroups = numGroups[rid] ?? 1;

    const isFinal = roundNum === total && total > 1;
    const isRound2 = roundNum === 2 && total >= 3;
    const isSemis = roundNum >= 3 && roundNum < total && total >= 4;
    const target = roundNum === 1 ? firstRoundEntries
      : isFinal ? finalsEntries
      : isRound2 ? intermediateEntries
      : isSemis ? semisEntries
      : null;
    if (!target) continue;

    pushCover(target, {
      kind: 'cover',
      timeslot: timeslots[aid] ?? 'Z99',
      eventId: eventId as EventId,
      eventName: getEventName(eventId, language),
      roundLabel: getRoundLabel(eventId, roundNum),
      roundNum,
      group: resolveGroupLabel(rid, gNum, stage, totalGroups),
      stage,
      numScorecards: ids.size,
      ...timesOf(rid, gNum, stage),
    });
  }

  // Collect schedule data for intermediate rounds and finals
  interface GroupInfo { gNum: string; stage: string; totalGroups: number; timeslot: string; roomIdx: number; }
  interface RoundData { eventId: string; roundNum: number; rid: string; groups: GroupInfo[]; minTs: string; }

  const finalsRounds: Record<string, RoundData> = {};
  const round2Rounds: Record<string, RoundData> = {};
  const semisRounds:  Record<string, RoundData> = {};

  for (const venue of wcif.schedule.venues) {
    for (const room of venue.rooms) {
      for (const activity of room.activities) {
        for (const child of groupUnitsOf(activity)) {
          const parsed = parseActivityCode(child.activityCode);
          if (parsed?.group === undefined) continue;
          const { eventId, round: roundNum } = parsed;
          if (eventId === '333fm') continue;
          if (roundNum === 1) continue;

          const rid = roundIdOf(parsed);
          if (!roundFormat[rid]) continue;
          // Already emitted as named scorecards; no blank/prefilled duplicates.
          if (liveRounds.has(rid)) continue;

          const total = numRounds[eventId] ?? 1;
          const isFinal        = roundNum === total && total > 1;
          const isRound2       = roundNum === 2 && total >= 3;
          // Rounds 3..N-1 of 4+ round events (semi-finals), always blank
          const isSemis        = roundNum >= 3 && roundNum < total && total >= 4;

          if (!isFinal && !isRound2 && !isSemis) continue;

          const ts = timeslots[child.id] ?? 'Z99';
          const gNum = String(parsed.group);
          const stage = activityStage[child.id]?.toLowerCase() ?? 'hall';
          const totalGroups = numGroups[rid] ?? 1;
          const groupInfo: GroupInfo = { gNum, stage, totalGroups, timeslot: ts, roomIdx: activityRoomIdx[child.id] };

          const target = isFinal ? finalsRounds : isRound2 ? round2Rounds : semisRounds;
          if (!target[rid]) target[rid] = { eventId, roundNum, rid, groups: [], minTs: ts };
          if (ts < target[rid].minTs) target[rid].minTs = ts;
          target[rid].groups.push(groupInfo);
        }
      }
    }
  }

  // By stage, then group number: each room numbers its own groups from 1, and the global
  // numbering has to stay deterministic across them.
  function sortGroups(groups: GroupInfo[]) {
    return [...groups].sort((a, b) => {
      const s = stageCollator.compare(a.stage, b.stage);
      return s !== 0 ? s : parseInt(a.gNum, 10) - parseInt(b.gNum, 10);
    });
  }

  // Finals: blank entries (station numbers only when single group in single stage, and it fits)
  for (const { eventId, roundNum, rid, groups } of Object.values(finalsRounds)) {
    const totalGroups = groups[0]?.totalGroups ?? groups.length;
    const numStages = roundStages[rid]?.size ?? 1;
    // One logical group across simultaneous stages: each gets its own labeled stack.
    const isMultiStageSingleGroup = totalGroups === 1 && numStages > 1;
    // Station numbers only for one group in one stage: event+round already names the stack.
    const canBeStationary = settings.finalStationNumbers && totalGroups === 1 && numStages <= 1;
    const stageCount = isMultiStageSingleGroup ? groups.length : totalGroups;
    const field = roundFieldSize[rid];

    for (const { gNum, stage, timeslot, roomIdx } of sortGroups(groups)) {
      const coverLabel = resolveGroupLabel(rid, gNum, stage, totalGroups);
      const blankCount = field != null ? Math.ceil(field / stageCount) : 16;
      // Unknown station count: nothing says the round can't be stationary.
      const stations = settings.stationsPerStage ?? roomStations[roomIdx]?.count;
      const useStationNumbers = canBeStationary && (stations == null || blankCount <= stations);

      for (let i = 0; i < blankCount; i++) {
        const cardGroup = useStationNumbers
          ? strings.stationLabel(String(i + 1).padStart(2, '0'))
          : coverLabel;
        finalsEntries.push({
          kind: 'scorecard', timeslot, eventId,
          eventName: getEventName(eventId, language),
          roundLabel: getRoundLabel(eventId, roundNum), roundNum,
          group: cardGroup, ...(useStationNumbers ? { coverGroup: coverLabel } : {}),
          stage: blankStage(stage), name: '', wcaId: '', liveId: '', gender: 'm',
          cutoff: roundCutoff[rid], limit: roundLimit[rid],
          format: roundFormat[rid], isCumulative: roundCumulative[rid],
          scrambleDoubleCheck: wantsDoubleCheck(['finals'], '', eventId),
        });
      }
      pushCover(finalsEntries, {
        kind: 'cover', timeslot, eventId: eventId as EventId,
        eventName: getEventName(eventId, language),
        roundLabel: getRoundLabel(eventId, roundNum), roundNum,
        group: coverLabel, stage: blankStage(stage), numScorecards: blankCount,
        ...timesOf(rid, gNum, stage),
      });
    }
  }

  // Semi-finals: always blank (same structure as finals)
  for (const { eventId, roundNum, rid, groups } of Object.values(semisRounds)) {
    const totalGroups = groups[0]?.totalGroups ?? groups.length;
    const numStages = roundStages[rid]?.size ?? 1;
    const isMultiStageSingleGroup = totalGroups === 1 && numStages > 1;
    const stageCount = isMultiStageSingleGroup ? groups.length : totalGroups;
    const field = roundFieldSize[rid];

    for (const { gNum, stage, timeslot } of sortGroups(groups)) {
      const groupLabel = resolveGroupLabel(rid, gNum, stage, totalGroups);
      const blankCount = field != null ? Math.ceil(field / stageCount) : 16;

      for (let i = 0; i < blankCount; i++) {
        semisEntries.push({
          kind: 'scorecard', timeslot, eventId,
          eventName: getEventName(eventId, language),
          roundLabel: getRoundLabel(eventId, roundNum), roundNum,
          group: groupLabel, stage: blankStage(stage), name: '', wcaId: '', liveId: '', gender: 'm',
          cutoff: roundCutoff[rid], limit: roundLimit[rid],
          format: roundFormat[rid], isCumulative: roundCumulative[rid],
          scrambleDoubleCheck: wantsDoubleCheck(['semis'], '', eventId),
        });
      }
      pushCover(semisEntries, {
        kind: 'cover', timeslot, eventId: eventId as EventId,
        eventName: getEventName(eventId, language),
        roundLabel: getRoundLabel(eventId, roundNum), roundNum,
        group: groupLabel, stage: blankStage(stage), numScorecards: blankCount,
        ...timesOf(rid, gNum, stage),
      });
    }
  }

  // Intermediate round 2
  for (const { eventId, roundNum, rid, groups, minTs } of Object.values(round2Rounds)) {
    const totalGroups = groups[0]?.totalGroups ?? groups.length;
    const numStages = roundStages[rid]?.size ?? 1;
    const isMultiStageSingleGroup = totalGroups === 1 && numStages > 1;
    const stageCount = isMultiStageSingleGroup ? groups.length : totalGroups;
    const field = roundFieldSize[rid];

    if (secondRoundMode === 'prefilled') {
      // Base per group, remainder absorbed one-by-one by the first groups, so the total is exact.
      const totalQualified = field ?? (round1Participants[eventId]?.length ?? 0);
      const baseCount = Math.floor(totalQualified / stageCount);
      const extraGroups = totalQualified % stageCount;

      for (const [i, { gNum, stage }] of sortGroups(groups).entries()) {
        const numScorecards = baseCount + (i < extraGroups ? 1 : 0);
        const coverLabel = resolveGroupLabel(rid, gNum, stage, totalGroups);
        pushCover(intermediateEntries, {
          kind: 'cover', timeslot: minTs, eventId: eventId as EventId,
          eventName: getEventName(eventId, language),
          roundLabel: getRoundLabel(eventId, roundNum), roundNum,
          group: coverLabel, stage: blankStage(stage),
          numScorecards,
          ...timesOf(rid, gNum, stage),
        });
      }

      const blankGroup = buildBlankGroupLabel(stageCount);
      for (const p of (round1Participants[eventId] ?? [])) {
        intermediateEntries.push({
          kind: 'scorecard', timeslot: minTs, eventId,
          eventName: getEventName(eventId, language),
          roundLabel: getRoundLabel(eventId, roundNum), roundNum,
          group: blankGroup,
          name: p.name, wcaId: p.wcaId, liveId: p.liveId, gender: p.gender,
          cutoff: roundCutoff[rid], limit: roundLimit[rid],
          format: roundFormat[rid], isCumulative: roundCumulative[rid],
          scrambleDoubleCheck: wantsDoubleCheck(['intermediate'], p.wcaId, eventId),
        });
      }
    } else {
      const blankCount = field != null ? Math.ceil(field / stageCount) : 16;

      for (const { gNum, stage, timeslot } of sortGroups(groups)) {
        const groupLabel = resolveGroupLabel(rid, gNum, stage, totalGroups);
        for (let i = 0; i < blankCount; i++) {
          intermediateEntries.push({
            kind: 'scorecard', timeslot, eventId,
            eventName: getEventName(eventId, language),
            roundLabel: getRoundLabel(eventId, roundNum), roundNum,
            group: groupLabel, stage: blankStage(stage), name: '', wcaId: '', liveId: '', gender: 'm',
            cutoff: roundCutoff[rid], limit: roundLimit[rid],
            format: roundFormat[rid], isCumulative: roundCumulative[rid],
            scrambleDoubleCheck: wantsDoubleCheck(['intermediate'], '', eventId),
          });
        }
        pushCover(intermediateEntries, {
          kind: 'cover', timeslot, eventId: eventId as EventId,
          eventName: getEventName(eventId, language),
          roundLabel: getRoundLabel(eventId, roundNum), roundNum,
          group: groupLabel, stage: blankStage(stage), numScorecards: blankCount,
          ...timesOf(rid, gNum, stage),
        });
      }
    }
  }

  // Nametag entries
  function resolveTitle(titles: NametTagTitleStrings, role: NametTagRole, isFemale: boolean): string {
    if (role === 'delegate') return titles.delegate(isFemale);
    if (role === 'organizer') return titles.organizer(isFemale);
    if (role === 'new-competitor') return titles.newCompetitor(isFemale);
    if (role === 'staff') return titles.staff(isFemale);
    return titles.competitor(isFemale);
  }

  const nametags: NametTagEntry[] = [];
  const firstTimers: FirstTimerEntry[] = [];
  for (const person of wcif.persons) {
    const isDelegate = person.roles.some(r => r === 'delegate' || r === 'trainee-delegate');
    const isOrganizer = person.roles.includes('organizer');
    const accepted = person.registration?.status === 'accepted';
    // ponytail: no account-type flag in the WCIF. An unregistered official with no WCA ID is
    // taken for an org account, so a never-competed human organizer gets no tag.
    const looksHuman = !!person.registration || !!person.wcaId;
    const staff = person.registration?.isCompeting === false
      || ((isDelegate || isOrganizer) && !accepted && looksHuman);
    if (staff ? !settings.staffNametags : !accepted) continue;

    const name = printedName(person.name);
    const isFemale = person.gender === 'f';

    // Newcomers (no WCA ID) get a first-timer confirmation slip.
    if (!person.wcaId && !staff && person.registration) {
      const registeredSet = new Set(person.registration.eventIds as string[]);
      firstTimers.push({
        name,
        gender: person.gender,
        birthdate: person.birthdate ?? null,
        countryIso2: person.countryIso2,
        eventIds: WCA_EVENT_ORDER.filter(e => registeredSet.has(e)),
      });
    }

    let role: NametTagRole;
    if (isDelegate) {
      role = 'delegate';
    } else if (isOrganizer) {
      role = 'organizer';
    } else if (staff) {
      role = 'staff';
    } else if (!person.wcaId) {
      role = 'new-competitor';
    } else {
      role = 'competitor';
    }

    const registeredSet = new Set(staff ? [] : person.registration?.eventIds as string[]);
    const events = WCA_EVENT_ORDER.filter(e => registeredSet.has(e));
    const dutyArgs = [shortNametTagNames, nametTagDutyStrings.dutyGroup] as const;

    nametags.push({
      name,
      wcaId: person.wcaId ?? '',
      registrantId: person.registrantId,
      wcaUserId: person.wcaUserId,
      registrationId: person.registration?.wcaRegistrationId ?? 0,
      gender: person.gender,
      role,
      titleFront: resolveTitle(nametTagTitles.front, role, isFemale),
      titleBack:  resolveTitle(nametTagTitles.back,  role, isFemale),
      events,
      compete:  buildDuties(person.assignments, 'competitor',      activityCode, ...dutyArgs),
      scramble: buildDuties(person.assignments, 'staff-scrambler', activityCode, ...dutyArgs),
      judge:    buildDuties(person.assignments, 'staff-judge',     activityCode, ...dutyArgs),
      run:      buildDuties(person.assignments, 'staff-runner',    activityCode, ...dutyArgs),
      ...(staff ? { staff } : {}),
    });
  }

  // Delegates → Organizers → Staff → Returning competitors → New competitors, each group alphabetically by name.
  const ROLE_ORDER: NametTagRole[] = ['delegate', 'organizer', 'staff', 'competitor', 'new-competitor'];
  const rolePriority = (r: NametTagRole) => ROLE_ORDER.indexOf(r);
  nametags.sort((a, b) => {
    const p = rolePriority(a.role) - rolePriority(b.role);
    return p !== 0 ? p : byName(a.name, b.name);
  });

  // First-timer slips: alphabetical by name.
  firstTimers.sort((a, b) => byName(a.name, b.name));

  if (settings.otsBlanks) {
    const compEvents = WCA_EVENT_ORDER.filter(e => wcif.events.some(ev => ev.id === e));
    const blankTag: NametTagEntry = {
      name: '', wcaId: '', registrantId: 0, wcaUserId: 0, registrationId: 0, gender: 'o',
      role: 'competitor',
      titleFront: resolveTitle(nametTagTitles.front, 'competitor', false),
      titleBack:  resolveTitle(nametTagTitles.back,  'competitor', false),
      events: [], compete: [], scramble: [], judge: [], run: [], blank: true,
    };
    nametags.push(blankTag, blankTag, blankTag, blankTag);

    const blankSlip: FirstTimerEntry = {
      name: '', gender: 'o', birthdate: null, countryIso2: '', eventIds: compEvents, blank: true,
    };
    // As many as one page holds; a long event list makes each slip taller.
    const slipStrings = getFirstTimerSlipStrings(language);
    firstTimers.push(...packSlipPages(
      Array(8).fill(blankSlip), slipStrings, language, settings.paperFormat)[0]);
  }

  // Extra scorecards
  // Build minimum timeslot for each round (eventId-rN) from its child activities.
  const roundMinTs: Record<string, string> = {};
  for (const [aidStr, code] of Object.entries(activityCode)) {
    const parsed = parseActivityCode(code);
    if (parsed?.group === undefined) continue;
    const rk = roundIdOf(parsed);
    const ts = timeslots[Number(aidStr)] ?? 'Z99';
    if (!roundMinTs[rk] || ts < roundMinTs[rk]) roundMinTs[rk] = ts;
  }

  const extrasEntries: ScorecardData[] = [];
  const extrasRounds: Array<{ ts: string; eventId: string; rid: string; roundNum: number }> = [];
  for (const event of wcif.events) {
    const eid = event.id;
    if (eid === '333fm') continue;
    for (let i = 1; i <= event.rounds.length; i++) {
      const rid = `${eid}-r${i}`;
      const ts = roundMinTs[rid];
      if (!ts || !roundFormat[rid]) continue;
      extrasRounds.push({ ts, eventId: eid, rid, roundNum: i });
    }
  }
  extrasRounds.sort((a, b) => cmp(a.ts, b.ts) || cmp(a.eventId, b.eventId));

  for (const { ts, eventId, rid, roundNum } of extrasRounds) {
    const totalGroups = numGroups[rid] ?? 1;
    const group = totalGroups === 1
      ? simpleGroupLabel('1', 1)
      : buildBlankGroupLabel(totalGroups);
    extrasEntries.push({
      kind: 'scorecard',
      timeslot: ts,
      eventId,
      eventName: getEventName(eventId, language),
      roundLabel: getRoundLabel(eventId, roundNum),
      roundNum,
      group,
      name: '', wcaId: '', liveId: '', gender: 'm',
      cutoff: roundCutoff[rid], limit: roundLimit[rid],
      format: roundFormat[rid], isCumulative: roundCumulative[rid],
    });
  }
  // Sample card for the competitor/judging tutorial; an FMC-only comp has no use for it.
  if (extrasEntries.length > 0) extrasEntries.push({
    kind: 'scorecard', timeslot: 'ZZZ', eventId: '333', eventName: getEventName('333', language),
    roundLabel: strings.tutorial, roundNum: 0, group: simpleGroupLabel('1', 1),
    name: '', wcaId: strings.newCompetitor, liveId: '0', gender: '',
    cutoff: '', limit: '10:00', format: 'avg5', isCumulative: false,
  });
  // A6 prints 1-up: no sheet to fill, and one blank is a page to print copies of.
  const a6 = settings.scorecardsA6 === true;
  const extrasRem = extrasEntries.length % 4;
  if (!a6 && extrasRem !== 0) for (let i = 0; i < 4 - extrasRem; i++) extrasEntries.push(EMPTY_COVER);
  if (extrasEntries.length > 0) {
    // Only the competition header is printed; reprint this page for more blanks.
    const pureBlank: ScorecardEntry = {
      kind: 'scorecard', timeslot: 'ZZZ', eventId: '', eventName: '', roundLabel: '', roundNum: 0,
      group: '', name: '', wcaId: '', liveId: '', gender: '',
      cutoff: '', limit: '', format: 'avg5', isCumulative: false,
    };
    extrasEntries.push(...Array<ScorecardEntry>(a6 ? 1 : 4).fill(pureBlank));
  }

  const { scheduleDays, checkingDays } = buildScheduleDays(
    wcif, labels, (activity) => groupUnitsOf(activity).map(u => u.activityCode),
  );

  // Group Overview
  // Everyone assigned to each scheduled group, the inverse of the nametag duty lines.
  // A group nobody is assigned to produces no block: a final is scheduled with real group
  // activities long before anyone qualifies for it, and a bare later round has its groups
  // synthesized for the scorecards. Both would otherwise print four empty columns.
  interface OverviewBucket {
    competitors: { name: string; station: number | null }[];
    scramblers: string[];
    runners: string[];
    judges: string[];
  }
  const overviewBuckets = new Map<number, OverviewBucket>();
  const overviewUnits: { unit: GroupUnit; code: ActivityCode & { group: number } }[] = [];

  for (const room of allRooms) {
    for (const activity of room.activities) {
      for (const unit of groupUnitsOf(activity)) {
        const parsed = parseActivityCode(unit.activityCode);
        if (parsed?.group === undefined) continue;
        overviewBuckets.set(unit.id, { competitors: [], scramblers: [], runners: [], judges: [] });
        overviewUnits.push({ unit, code: { ...parsed, group: parsed.group } });
      }
    }
  }

  for (const person of wcif.persons) {
    if (!person.registration || person.registration.status !== 'accepted') continue;
    const name = printedName(person.name);
    for (const a of person.assignments) {
      const bucket = overviewBuckets.get(a.activityId);
      if (!bucket) continue;
      if (a.assignmentCode === 'competitor') bucket.competitors.push({ name, station: a.stationNumber ?? null });
      else if (a.assignmentCode === 'staff-scrambler') bucket.scramblers.push(name);
      else if (a.assignmentCode === 'staff-runner') bucket.runners.push(name);
      else if (a.assignmentCode === 'staff-judge') bucket.judges.push(name);
    }
  }

  overviewUnits.sort((a, b) =>
    Date.parse(a.unit.startTime) - Date.parse(b.unit.startTime)
    || (activityRoomIdx[a.unit.id] ?? 0) - (activityRoomIdx[b.unit.id] ?? 0)
    || a.code.group - b.code.group);

  const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

  const isEmptyGroup = (b: OverviewBucket) =>
    b.competitors.length === 0 && b.scramblers.length === 0
    && b.runners.length === 0 && b.judges.length === 0;

  const groupOverview: GroupOverviewEntry[] = overviewUnits.filter(
    ({ unit }) => !isEmptyGroup(overviewBuckets.get(unit.id)!),
  ).map(({ unit, code }) => {
    const { eventId, round: roundNum, group: groupNum } = code;
    const bucket = overviewBuckets.get(unit.id)!;
    const rid = roundIdOf(code);
    const roundLabel = labels.roundLabel(eventId, roundNum);
    // Two stages number their groups from 1 each, so the stage has to qualify the label.
    const stage = (roundStages[rid]?.size ?? 1) > 1 ? activityStage[unit.id] : '';
    // Same "Group N" wording as the nametag duty lines, so the two documents agree.
    const base = nametTagDutyStrings.dutyGroup(String(groupNum));
    const groupLabel = stage ? `${base} (${capitalize(stage)})` : base;

    // Station order when stations are assigned, so the printed ordinal IS the station
    // number; alphabetical otherwise.
    const competitors = [...bucket.competitors]
      .sort((a, b) => (a.station != null && b.station != null
        ? a.station - b.station
        : byName(a.name, b.name)))
      .map(c => c.name);

    return {
      dayLabel: labels.dayLabel(labels.localDate(unit.startTime)),
      heading: `${getEventName(eventId, settings.language)} ${roundLabel} - ${groupLabel}`,
      startTime: labels.localTime(unit.startTime),
      endTime: labels.localTime(unit.endTime),
      room: activityRoom[unit.id] ?? '',
      eventId,
      roundNum,
      competitors,
      scramblers: [...bucket.scramblers].sort(byName),
      runners: [...bucket.runners].sort(byName),
      judges: [...bucket.judges].sort(byName),
    };
  });

  // Named round-2 cards carry real groups and covers, so they need the group-sorted finalize.
  // The prefilled layout's own finalize applies only when no real assignments exist.
  const laterRoundsWithAssignments = [...liveRounds]
    .map((rid) => {
      const { eventId, round } = parseActivityCode(rid)!;
      return { eventId, roundNum: round };
    })
    .sort((a, b) =>
      (WCA_EVENT_ORDER.indexOf(a.eventId as EventId) - WCA_EVENT_ORDER.indexOf(b.eventId as EventId))
      || (a.roundNum - b.roundNum),
    );

  return {
    firstRound: finalizeEntries(firstRoundEntries),
    intermediate: secondRoundMode === 'prefilled' && !intermediateHasNamed
      ? finalizeEntriesIntermediate(intermediateEntries)
      : finalizeEntries(intermediateEntries),
    semis:  finalizeEntries(semisEntries),
    finals: finalizeEntries(finalsEntries),
    nametags,
    firstTimers,
    extras: extrasEntries,
    scheduleDays,
    groupOverview,
    checkingDays,
    venueSchedule: buildVenueSchedule(wcif, labels),
    laterRoundsWithAssignments,
    // Real groups only, so a fresh WCIF with synthesized ones still reports "no groups yet".
    hasGroups: roundsWithRealGroups.size > 0,
    stageCount: Object.values(roundStages).reduce((m, set) => Math.max(m, set.size), 1),
    stations: roomStations.find(Boolean) ?? null,
  };
}
