import type { Activity, WCIF } from '../types/wcif';
import type { LocaleCode } from '../types/settings';
import { getEventName, getScheduleStrings } from './i18n';
import { parseActivityCode, roundIdOf, type ActivityCode } from './activityCode';
import { cmp } from './sort';

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

/** Falls back to UTC for a timezone this runtime does not know. */
function zonedFormat(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try { return new Intl.DateTimeFormat('en-CA', { ...options, timeZone }); }
  catch { return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }); }
}

// Delegates often file lunch under a generic code with a localised name, so the name is
// checked too. Narrow on purpose: only lunch draws a rule.
const LUNCH_NAME_RE = /\b(lunch|d[îi]ner|d[ée]jeuner|almuerzo|almo[çc]o|comida)\b/i;

function isLunchActivity(activity: { activityCode: string; name: string }): boolean {
  if (parseActivityCode(activity.activityCode)) return false;
  return activity.activityCode === 'other-lunch' || LUNCH_NAME_RE.test(activity.name ?? '');
}

// One room's round or attempt on the schedule tracker, or the round collapsed across every
// room on the Round Checklist.
interface RoundSlot {
  code: ActivityCode;
  startTime: string;
  endTime: string;
  // Codes, not a count: two stages running one logical group share its code, and a later
  // round synthesizes the same g1..gN per room, so collapsing rooms unions rather than sums.
  groupCodes: Set<string>;
}

// One row per round, attempts included: earliest start, latest end, every room's groups.
// Round Checklist only, which counts scorecard piles, and a pile is per round.
function mergeSlots(slots: RoundSlot[]): RoundSlot[] {
  const byRound = new Map<string, RoundSlot>();
  for (const slot of slots) {
    const key = roundIdOf(slot.code);
    const merged = byRound.get(key);
    if (!merged) {
      byRound.set(key, { ...slot, code: { eventId: slot.code.eventId, round: slot.code.round }, groupCodes: new Set(slot.groupCodes) });
      continue;
    }
    // Parsed, not compared as strings: WCIF times carry UTC offsets.
    if (Date.parse(slot.startTime) < Date.parse(merged.startTime)) merged.startTime = slot.startTime;
    if (Date.parse(slot.endTime) > Date.parse(merged.endTime)) merged.endTime = slot.endTime;
    for (const code of slot.groupCodes) merged.groupCodes.add(code);
  }
  return [...byRound.values()].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}

export type ScheduleLabels = ReturnType<typeof scheduleLabels>;

/**
 * Day, round and time wording shared by the schedule tracker, the Round Checklist and the
 * Group Overview. Built once per parse: each Intl formatter holds ICU memory outside the JS heap.
 */
export function scheduleLabels(wcif: WCIF, language: LocaleCode) {
  const timezone = wcif.schedule.venues[0]?.timezone ?? 'UTC';
  const dateFormat = zonedFormat(timezone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFormat = zonedFormat(timezone, { hour: '2-digit', minute: '2-digit', hour12: false });
  const localTime = (isoTime: string): string => {
    try { return timeFormat.format(new Date(isoTime)); } catch { return isoTime.slice(11, 16); }
  };
  // "YYYY-MM-DD" in the venue's timezone.
  const localDate = (isoTime: string): string => {
    try {
      const parts = dateFormat.formatToParts(new Date(isoTime));
      const y = parts.find(p => p.type === 'year')?.value ?? '';
      const m = parts.find(p => p.type === 'month')?.value ?? '';
      const d = parts.find(p => p.type === 'day')?.value ?? '';
      return `${y}-${m}-${d}`;
    } catch {
      return isoTime.slice(0, 10);
    }
  };

  // Round count per event including FMC (for schedule label).
  const roundCount: Record<string, number> = {};
  for (const event of wcif.events) roundCount[event.id] = event.rounds.length;

  // Map each unique local date to its day number (1-based) across the whole competition.
  const uniqueDates = new Set<string>();
  for (const venue of wcif.schedule.venues)
    for (const room of venue.rooms)
      for (const activity of room.activities)
        uniqueDates.add(localDate(activity.startTime));
  const dateToDay: Record<string, number> = {};
  [...uniqueDates].sort(cmp).forEach((d, i) => { dateToDay[d] = i + 1; });

  const strings = getScheduleStrings(language);
  const weekdayFormat = new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : language, { weekday: 'long' });
  const dayLabel = (date: string): string => {
    const dayNum = dateToDay[date] ?? 1;
    try {
      const weekday = weekdayFormat.format(new Date(`${date}T12:00:00Z`));
      const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      return `${strings.dayPrefix} ${dayNum} - ${capitalized}`;
    } catch {
      return `${strings.dayPrefix} ${dayNum}`;
    }
  };
  const roundLabel = (eventId: string, round: number): string =>
    round === (roundCount[eventId] ?? 1) ? strings.finalLabel : strings.roundLabel(round);

  return { language, strings, roundCount, localDate, localTime, dayLabel, roundLabel };
}

/** The schedule tracker and the Round Checklist, one table per day. */
export function buildScheduleDays(
  wcif: WCIF,
  labels: ScheduleLabels,
  // The group codes that print for a round activity, synthesized ones included.
  groupCodesOf: (activity: Activity) => string[],
): { scheduleDays: ScheduleDay[]; checkingDays: CheckingDay[] } {
  const { language, strings, roundCount, localDate, localTime, dayLabel, roundLabel } = labels;

  // Build a (date → roomIndex → activities[]) map, preserving WCIF room order via roomIndex.
  const dayRoomMap = new Map<string, Map<number, Activity[]>>();
  const roomIndexToName = new Map<number, string>();
  // Collected across EVERY room: lunch is often scheduled once, in one room, but the rule
  // belongs on every stage's table that day.
  const lunchStartsByDate = new Map<string, number[]>();
  let roomIdx = 0;
  for (const venue of wcif.schedule.venues) {
    for (const room of venue.rooms) {
      roomIndexToName.set(roomIdx, room.name);
      for (const activity of room.activities) {
        const date = localDate(activity.startTime);
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

  // Lunch, awards and events absent from the WCIF are dropped here, so the row builder sees
  // only rounds and attempts.
  const slotsOf = (activities: Activity[]): RoundSlot[] => {
    const slots: RoundSlot[] = [];
    const sorted = [...activities].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
    for (const activity of sorted) {
      const code = parseActivityCode(activity.activityCode);
      if (!code || code.group !== undefined || roundCount[code.eventId] === undefined) continue;
      slots.push({
        code,
        startTime: activity.startTime,
        endTime: activity.endTime,
        // Per round, not per attempt: one attempt's g1 is the same pile as the next one's.
        groupCodes: new Set(groupCodesOf(activity).map(c => c.replace(/-a\d+$/, ''))),
      });
    }
    return slots;
  };

  // Same labelling and lunch rules for both documents; the checklist adds its group count.
  const buildRows = (slots: RoundSlot[], lunchStarts: number[]): CheckingRow[] => {
    const rows: CheckingRow[] = [];
    // Where the previous row's round started, so a lunch can fall between two rows.
    // Timestamps, not ISO strings: WCIF times carry UTC offsets.
    let prevStart: number | null = null;
    for (const { code, startTime, endTime, groupCodes } of slots) {
      const eventRound = `${getEventName(code.eventId, language)} ${roundLabel(code.eventId, code.round)}`;
      // The first row has only the header border above it.
      const thisStart = Date.parse(startTime);
      const breakBefore = prevStart !== null
        && lunchStarts.some((l) => l >= prevStart! && l < thisStart);
      prevStart = thisStart;
      rows.push({
        startTime: localTime(startTime),
        endTime: localTime(endTime),
        eventRound: code.attempt === undefined ? eventRound : `${eventRound} (${strings.attemptLabel(code.attempt)})`,
        breakBefore,
        groupCount: groupCodes.size,
        preChecked: code.round === 1,
      });
    }
    return rows;
  };

  // Iterate days chronologically; within each day keep WCIF room order.
  const scheduleDays: ScheduleDay[] = [];
  const checkingDays: CheckingDay[] = [];
  for (const [date, roomMap] of [...dayRoomMap].sort(([a], [b]) => cmp(a, b))) {
    const stages: ScheduleStage[] = [];
    // Concatenated in room order, so mergeSlots' stable sort leaves rounds starting at the
    // same minute in WCIF order.
    const daySlots: RoundSlot[] = [];
    const lunchStarts = lunchStartsByDate.get(date) ?? [];
    for (const [ri, activities] of [...roomMap].sort(([a], [b]) => a - b)) {
      const slots = slotsOf(activities);
      // One table per room: the tracker records when each stage runs, which the merge drops.
      const rows = buildRows(slots, lunchStarts)
        .map(({ startTime, endTime, eventRound, breakBefore }) => ({ startTime, endTime, eventRound, breakBefore }));
      if (rows.length > 0) stages.push({ stageName: roomIndexToName.get(ri) ?? `Room ${ri + 1}`, rows });
      daySlots.push(...slots);
    }
    const checking = buildRows(mergeSlots(daySlots), lunchStarts);
    if (stages.length > 0) scheduleDays.push({ dayLabel: dayLabel(date), stages });
    if (checking.length > 0) checkingDays.push({ dayLabel: dayLabel(date), rows: checking });
  }
  return { scheduleDays, checkingDays };
}
