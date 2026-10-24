import type { WCIF, Round, EventId, Assignment, ChildActivity, PersonalBest } from '../types/wcif';
import type { CompetitionSettings, DoubleCheckRound } from '../types/settings';
import { getStrings, getEventName, getFirstTimerSlipStrings, getNametTagTitleStrings, getNametTagStrings, getShortNametTagNames, getScheduleStrings, type NametTagTitleStrings } from './i18n';
import { packSlipPages } from '../pdf/firstTimerSlipLines';

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
    const parts = actCode.split('-');
    if (parts.length < 3) continue;
    const eventId = parts[0];
    const groupNum = parseInt(parts[2].slice(1), 10);
    if (!isFinite(groupNum)) continue;
    if (!byEvent[eventId]) byEvent[eventId] = new Set();
    byEvent[eventId].add(groupNum);
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
  // Keeps stages grouped in finalizeEntries when `group` is a station number that omits the
  // stage. Undefined on blank/prefilled entries, which fall through to group sorting.
  stage?: string;
  name: string;
  wcaId: string;
  liveId: string;
  gender: string;
  cutoff: string;
  limit: string;
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

export interface ScheduleRow {
  startTime: string;
  endTime: string;
  eventRound: string;
  // Lunch falls between the previous row and this one; both documents draw a thick rule above.
  breakBefore: boolean;
}

// One row per round, in the schedule tracker's chronological shape, carrying the group count
// the delegate must account for. Every other column is filled in by hand.
export interface CheckingRow {
  startTime: string;
  endTime: string;
  eventRound: string;
  // Groups scheduled for this round in this room. 0 when the WCIF has no groups yet.
  groupCount: number;
  // Round 1 is prepared before the competition, so those two boxes print ticked. Later
  // rounds are done on the day and ship blank.
  preChecked: boolean;
  // See ScheduleRow.breakBefore.
  breakBefore: boolean;
}

// Delegates often file lunch under a generic code with a localised name, so the name is
// checked too. Narrow on purpose: only lunch draws a rule.
const LUNCH_NAME_RE = /\b(lunch|d[îi]ner|d[ée]jeuner|almuerzo|almo[çc]o|comida)\b/i;

// A scheduled lunch break: never a round activity (those are `<eventId>-r<N>`), matched by
// the standard WCA activity code or by a localised name.
function isLunchActivity(activity: { activityCode: string; name: string }): boolean {
  if (/^[a-z0-9]+-r\d+/.test(activity.activityCode)) return false;
  return activity.activityCode === 'other-lunch' || LUNCH_NAME_RE.test(activity.name ?? '');
}

// One room's activity on the schedule tracker, or the round collapsed across every room on
// the Round Checklist.
interface RoundSlot {
  activityCode: string;   // "333-r1"
  startTime: string;
  endTime: string;
  // Codes, not a count: two stages running one logical group share its code, and a later
  // round synthesizes the same g1..gN per room, so collapsing rooms unions rather than sums.
  groupCodes: Set<string>;
}

// One row per round: earliest start, latest end, every room's groups. Round Checklist only.
function mergeSlots(slots: RoundSlot[]): RoundSlot[] {
  const byRound = new Map<string, RoundSlot>();
  for (const slot of slots) {
    const merged = byRound.get(slot.activityCode);
    if (!merged) {
      byRound.set(slot.activityCode, { ...slot, groupCodes: new Set(slot.groupCodes) });
      continue;
    }
    // Parsed, not compared as strings: WCIF times carry UTC offsets.
    if (Date.parse(slot.startTime) < Date.parse(merged.startTime)) merged.startTime = slot.startTime;
    if (Date.parse(slot.endTime) > Date.parse(merged.endTime)) merged.endTime = slot.endTime;
    for (const code of slot.groupCodes) merged.groupCodes.add(code);
  }
  return [...byRound.values()].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}

// One calendar day, one table. No room dimension: a round produces one pile of scorecards
// however many rooms it runs across, and the pile is what this document tracks.
export interface CheckingDay {
  dayLabel: string;
  rows: CheckingRow[];
}

// One room's events within a single day.
export interface ScheduleStage {
  stageName: string;
  rows: ScheduleRow[];
}

// One calendar day; contains one entry per room that has events that day.
export interface ScheduleDay {
  dayLabel: string;   // "Day 1 - Saturday"
  stages: ScheduleStage[];
}

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

// Competitor names are the only sort key that needs collation; timeslots, event ids, stage
// keys and group labels are ASCII and compare faster as plain strings. One shared Collator,
// because `localeCompare` rebuilds one per call and these comparators run n log n times.
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base' });
const byName = (a: string, b: string) => nameCollator.compare(a, b);

// Padding covers (added to round a bucket up to a multiple of 4) carry an empty eventId.
// Strip them before re-filtering or re-splitting, so finalizeEntries can re-pad cleanly.
export function realEntries(entries: ScorecardData[]): ScorecardData[] {
  return entries.filter((e) => e.kind === 'scorecard' || e.eventId !== '');
}

// Sort by timeslot → eventId → stage → group → cover-before-scorecard → name.
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
    if (a.group !== b.group) return a.group < b.group ? -1 : 1;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
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
          const p = activity.activityCode.split('-');
          if (p.length >= 2) roundsWithRealGroups.add(`${p[0]}-${p[1]}`);
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
    const p = activity.activityCode.split('-');
    if (p.length === 2 && p[1].startsWith('r')) {
      const roundNum = parseInt(p[1].slice(1), 10);
      if (roundNum >= 2 && !roundsWithRealGroups.has(activity.activityCode)) {
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

  const timezone = wcif.schedule.venues[0]?.timezone ?? 'UTC';

  const formatLocalTime = (isoTime: string): string => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        hour: '2-digit', minute: '2-digit',
        timeZone: timezone, hour12: false,
      }).format(new Date(isoTime));
    } catch {
      return isoTime.slice(11, 16);
    }
  };

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
      const parts = activity.activityCode.split('-');
      if (parts.length < 2) continue;
      const list = roundRoomIdx.get(`${parts[0]}-${parts[1]}`) ?? [];
      if (!list.includes(i)) list.push(i);
      roundRoomIdx.set(`${parts[0]}-${parts[1]}`, list);
    }
  });
  const stageKey = new Map<string, string>(); // `${roundKey}|${roomIndex}` → stage key
  for (const [rk, idxs] of roundRoomIdx) {
    const keys = distinguishingNames(idxs.map((i) => allRooms[i].name));
    idxs.forEach((i, k) => stageKey.set(`${rk}|${i}`, keys[k]));
  }

  allRooms.forEach((room, roomIdx) => {
    for (const activity of room.activities) {
      const parts = activity.activityCode.split('-');
      const roundKey = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : '';
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
        const cParts = child.activityCode.split('-');
        if (cParts.length >= 3) {
          const rk = `${cParts[0]}-${cParts[1]}`;
          groupTimes[`${rk}|${cParts[2].slice(1)}|${stage}`] = {
            startTime: formatLocalTime(child.startTime), endTime: formatLocalTime(child.endTime),
          };
          if (!roundGroupCodes[rk]) roundGroupCodes[rk] = new Set();
          roundGroupCodes[rk].add(cParts[2]);
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

      const parts = code.split('-');
      if (parts.length < 3) continue;
      const [eventId, roundPart, groupPart] = parts;
      if (eventId === '333fm' || eventId === '333mbf') continue;

      const roundNum = parseInt(roundPart.slice(1), 10);
      const rid = `${eventId}-${roundPart}`;
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

      const gNum = groupPart.slice(1);
      const stage = activityStage[aid]?.toLowerCase() ?? 'hall';
      const totalGroups = numGroups[rid] ?? 1;

      let group: string;
      if (assignment.stationNumber != null) {
        group = strings.stationLabel(String(assignment.stationNumber).padStart(2, '0'));
      } else {
        group = resolveGroupLabel(rid, gNum, stage, totalGroups);
      }

      const entry: ScorecardEntry = {
        kind: 'scorecard',
        timeslot: timeslots[aid] ?? 'Z99',
        eventId,
        eventName: getEventName(eventId, language),
        roundLabel: getRoundLabel(eventId, roundNum),
        roundNum,
        group,
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
    const parts = code.split('-');
    if (parts.length < 3) continue;
    const [eventId, roundPart, groupPart] = parts;
    if (eventId === '333fm') continue;

    const rid = `${eventId}-${roundPart}`;
    const roundNum = parseInt(roundPart.slice(1), 10);
    const total = numRounds[eventId] ?? 1;
    const gNum = groupPart.slice(1);
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
          const parts = child.activityCode.split('-');
          if (parts.length < 3) continue;
          const [eventId, roundPart, groupPart] = parts;
          if (eventId === '333fm') continue;

          const roundNum = parseInt(roundPart.slice(1), 10);
          if (roundNum === 1) continue;

          const rid = `${eventId}-${roundPart}`;
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
          const gNum = groupPart.slice(1);
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
      const s = a.stage.localeCompare(b.stage);
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
          group: cardGroup, stage: blankStage(stage), name: '', wcaId: '', liveId: '', gender: 'm',
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
    const parts = code.split('-');
    if (parts.length < 3) continue;
    const rk = `${parts[0]}-${parts[1]}`;
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
  extrasRounds.sort((a, b) => a.ts.localeCompare(b.ts) || a.eventId.localeCompare(b.eventId));

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

  // Schedule tracker

  // Extract local date "YYYY-MM-DD" using formatToParts for timezone safety.
  const getLocalDate = (isoTime: string): string => {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
      }).formatToParts(new Date(isoTime));
      const y = parts.find(p => p.type === 'year')?.value ?? '';
      const m = parts.find(p => p.type === 'month')?.value ?? '';
      const d = parts.find(p => p.type === 'day')?.value ?? '';
      return `${y}-${m}-${d}`;
    } catch {
      return isoTime.slice(0, 10);
    }
  };

  // Round count per event including FMC (for schedule label).
  const allEventRoundCount: Record<string, number> = {};
  for (const event of wcif.events) allEventRoundCount[event.id] = event.rounds.length;

  // Map each unique local date to its day number (1-based) across the whole competition.
  const uniqueDates = new Set<string>();
  for (const venue of wcif.schedule.venues)
    for (const room of venue.rooms)
      for (const activity of room.activities)
        uniqueDates.add(getLocalDate(activity.startTime));
  const sortedAllDates = [...uniqueDates].sort();
  const dateToDay: Record<string, number> = {};
  sortedAllDates.forEach((d, i) => { dateToDay[d] = i + 1; });

  const formatDayLabel = (localDate: string): string => {
    const dayNum = dateToDay[localDate] ?? 1;
    const locale = settings.language === 'pt' ? 'pt-BR' : settings.language;
    const prefix = getScheduleStrings(settings.language).dayPrefix;
    try {
      const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' })
        .format(new Date(`${localDate}T12:00:00Z`));
      const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      return `${prefix} ${dayNum} - ${capitalized}`;
    } catch {
      return `${prefix} ${dayNum}`;
    }
  };

  // Build a (date → roomIndex → activities[]) map, preserving WCIF room order via roomIndex.
  type RoomActivity = (typeof wcif.schedule.venues)[0]['rooms'][0]['activities'][0];
  const dayRoomMap = new Map<string, Map<number, RoomActivity[]>>();
  const roomIndexToName = new Map<number, string>();
  // Collected across EVERY room: lunch is often scheduled once, in one room, but the rule
  // belongs on every stage's table that day.
  const lunchStartsByDate = new Map<string, number[]>();
  let roomIdx = 0;
  for (const venue of wcif.schedule.venues) {
    for (const room of venue.rooms) {
      roomIndexToName.set(roomIdx, room.name);
      for (const activity of room.activities) {
        const date = getLocalDate(activity.startTime);
        if (!dayRoomMap.has(date)) dayRoomMap.set(date, new Map());
        const roomMap = dayRoomMap.get(date)!;
        if (!roomMap.has(roomIdx)) roomMap.set(roomIdx, []);
        roomMap.get(roomIdx)!.push(activity);
        if (isLunchActivity(activity)) {
          if (!lunchStartsByDate.has(date)) lunchStartsByDate.set(date, []);
          lunchStartsByDate.get(date)!.push(Date.parse(activity.startTime));
        }
      }
      roomIdx++;
    }
  }

  const schedStrings = getScheduleStrings(settings.language);
  // Lunch, awards and events absent from the WCIF are dropped here, so the row builder sees
  // only rounds.
  const slotsOf = (activities: RoomActivity[]): RoundSlot[] => {
    const slots: RoundSlot[] = [];
    const sorted = [...activities].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const activity of sorted) {
      const parts = activity.activityCode.split('-');
      if (parts.length !== 2) continue;
      const [eid, roundPart] = parts;
      if (!roundPart.startsWith('r')) continue;
      if (!isFinite(parseInt(roundPart.slice(1), 10))) continue;
      if (allEventRoundCount[eid] === undefined) continue;
      slots.push({
        activityCode: activity.activityCode,
        startTime: activity.startTime,
        endTime: activity.endTime,
        // groupUnitsOf synthesizes later rounds' missing groups, matching what prints.
        groupCodes: new Set(groupUnitsOf(activity).map(u => u.activityCode)),
      });
    }
    return slots;
  };

  // One pass for both documents: same labelling and lunch rules, differing only in the
  // trailing column (competitor count vs group count).
  const buildRows = (
    slots: RoundSlot[],
    lunchStarts: number[],
  ): { schedule: ScheduleRow[]; checking: CheckingRow[] } => {
    const schedule: ScheduleRow[] = [];
    const checking: CheckingRow[] = [];
    // Where the previous row's round started, so a lunch can fall between two rows.
    // Timestamps, not ISO strings: WCIF times carry UTC offsets.
    let prevStart: number | null = null;
    for (const slot of slots) {
      const [eid, roundPart] = slot.activityCode.split('-');
      const roundNum = parseInt(roundPart.slice(1), 10);
      const totalRounds = allEventRoundCount[eid];
      const eventName = getEventName(eid, settings.language);
      const isLast = roundNum === totalRounds;
      const roundLabel = totalRounds === 1 || isLast
        ? schedStrings.finalLabel
        : schedStrings.roundLabel(roundNum);
      const startTime = formatLocalTime(slot.startTime);
      const endTime = formatLocalTime(slot.endTime);
      const eventRound = `${eventName} ${roundLabel}`;
      // The first row has only the header border above it.
      const thisStart = Date.parse(slot.startTime);
      const breakBefore = prevStart !== null
        && lunchStarts.some((l) => l >= prevStart! && l < thisStart);
      prevStart = thisStart;

      schedule.push({ startTime, endTime, eventRound, breakBefore });
      checking.push({
        startTime, endTime, eventRound, breakBefore,
        groupCount: slot.groupCodes.size,
        preChecked: roundNum === 1,
      });
    }
    return { schedule, checking };
  };

  // Iterate days chronologically; within each day keep WCIF room order.
  const scheduleDays: ScheduleDay[] = [];
  const checkingDays: CheckingDay[] = [];
  for (const [date, roomMap] of [...dayRoomMap].sort(([a], [b]) => a.localeCompare(b))) {
    const stages: ScheduleStage[] = [];
    // Concatenated in room order, so mergeSlots' stable sort leaves rounds starting at the
    // same minute in WCIF order.
    const daySlots: RoundSlot[] = [];
    const lunchStarts = lunchStartsByDate.get(date) ?? [];
    for (const [ri, activities] of [...roomMap].sort(([a], [b]) => a - b)) {
      const stageName = roomIndexToName.get(ri) ?? `Room ${ri + 1}`;
      const slots = slotsOf(activities);
      // One table per room: the tracker records when each stage runs, which the merge drops.
      const { schedule } = buildRows(slots, lunchStarts);
      if (schedule.length > 0) stages.push({ stageName, rows: schedule });
      daySlots.push(...slots);
    }
    const { checking } = buildRows(mergeSlots(daySlots), lunchStarts);
    const dayLabel = formatDayLabel(date);
    if (stages.length > 0) scheduleDays.push({ dayLabel, stages });
    if (checking.length > 0) checkingDays.push({ dayLabel, rows: checking });
  }

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
  const overviewUnits: { unit: GroupUnit; roundNum: number; eventId: string }[] = [];

  for (const room of allRooms) {
    for (const activity of room.activities) {
      for (const unit of groupUnitsOf(activity)) {
        const parts = unit.activityCode.split('-');
        if (parts.length < 3) continue;
        const roundNum = parseInt(parts[1].slice(1), 10);
        if (!isFinite(roundNum)) continue;
        overviewBuckets.set(unit.id, { competitors: [], scramblers: [], runners: [], judges: [] });
        overviewUnits.push({ unit, roundNum, eventId: parts[0] });
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

  const groupNumOf = (code: string) => parseInt(code.split('-')[2].slice(1), 10);
  overviewUnits.sort((a, b) =>
    Date.parse(a.unit.startTime) - Date.parse(b.unit.startTime)
    || (activityRoomIdx[a.unit.id] ?? 0) - (activityRoomIdx[b.unit.id] ?? 0)
    || groupNumOf(a.unit.activityCode) - groupNumOf(b.unit.activityCode));

  const capitalize = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

  const isEmptyGroup = (b: OverviewBucket) =>
    b.competitors.length === 0 && b.scramblers.length === 0
    && b.runners.length === 0 && b.judges.length === 0;

  const groupOverview: GroupOverviewEntry[] = overviewUnits.filter(
    ({ unit }) => !isEmptyGroup(overviewBuckets.get(unit.id)!),
  ).map(({ unit, roundNum, eventId }) => {
    const bucket = overviewBuckets.get(unit.id)!;
    const rid = `${eventId}-r${roundNum}`;
    const totalRounds = allEventRoundCount[eventId] ?? 1;
    const roundLabel = totalRounds === 1 || roundNum === totalRounds
      ? schedStrings.finalLabel
      : schedStrings.roundLabel(roundNum);
    const groupNum = groupNumOf(unit.activityCode);
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
      dayLabel: formatDayLabel(getLocalDate(unit.startTime)),
      heading: `${getEventName(eventId, settings.language)} ${roundLabel} - ${groupLabel}`,
      startTime: formatLocalTime(unit.startTime),
      endTime: formatLocalTime(unit.endTime),
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
      const [eventId, roundPart] = rid.split('-');
      return { eventId, roundNum: parseInt(roundPart.slice(1), 10) };
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
    laterRoundsWithAssignments,
    // Real groups only, so a fresh WCIF with synthesized ones still reports "no groups yet".
    hasGroups: roundsWithRealGroups.size > 0,
    stageCount: Object.values(roundStages).reduce((m, set) => Math.max(m, set.size), 1),
    stations: roomStations.find(Boolean) ?? null,
  };
}
