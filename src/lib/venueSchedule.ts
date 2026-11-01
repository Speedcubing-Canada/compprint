import type { RoundFormat, WCIF } from '../types/wcif';
import type { LocaleCode } from '../types/settings';
import { getEventName, getVenueScheduleStrings, type VenueScheduleStrings } from './i18n';
import { parseActivityCode, roundIdOf } from './activityCode';
import { cmp } from './sort';
import type { ScheduleLabels } from './scheduleRows';

// The WCA's competition PDF, posted around the venue: an events table, then one schedule per day.

export interface VenueRound {
  label: string;
  format: string;
  cutoff: string;
  timeLimit: string;
  // The other rounds a cumulative limit is split with.
  shared: string;
  proceed: string;
}

export interface VenueEvent {
  eventId: string;
  name: string;
  rounds: VenueRound[];
}

export interface VenueRow {
  start: string;
  end: string;
  // Null for lunch, check-in, awards: those rows leave the round columns blank.
  eventId: string | null;
  name: string;
  // Every room running it: one round on three stages is one row.
  rooms: string[];
  round: VenueRound | null;
}

export interface VenueDay {
  dateLabel: string;
  rows: VenueRow[];
}

export interface VenueSchedule {
  events: VenueEvent[];
  days: VenueDay[];
}

/** WCA notation: `45.00`, `1:30.00`, `1:00:00.00`. */
export function resultTime(cs: number): string {
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const frac = `${String(s).padStart(h || m ? 2 : 1, '0')}.${String(cs % 100).padStart(2, '0')}`;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${frac}`;
  return m ? `${m}:${frac}` : frac;
}

/** "09:30" to "9:30 AM" for English; the other locales keep 24h. */
function clock(hhmm: string, language: LocaleCode): string {
  if (language !== 'en') return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A record lookup by untrusted key: no prototype hits, undefined when missing. */
function lookup<K extends string>(rec: Record<K, string>, key: string): string | undefined {
  return Object.hasOwn(rec, key) ? rec[key as K] : undefined;
}

/** Null for multi-blind: its results encode points, not a bar to beat. */
function resultText(strings: VenueScheduleStrings, eventId: string, value: number, average: boolean): string | null {
  if (eventId === '333mbf') return null;
  // FMC singles count moves; its averages are moves times 100.
  if (eventId === '333fm') return strings.moves(average ? value / 100 : value);
  return resultTime(value);
}

/** Null when there is nothing to print: no events and no schedule. */
export function buildVenueSchedule(wcif: WCIF, labels: ScheduleLabels): VenueSchedule | null {
  const { language, localDate, localTime, roundLabel, roundName, fullDateLabel } = labels;
  const strings = getVenueScheduleStrings(language);

  // Who advances out of a round is written on the round it feeds. Linked rounds advance on
  // their combined result, printed on the last one.
  const proceedOf: Record<string, string> = {};
  const eventOf: Record<string, string> = {};
  for (const event of wcif.events) for (const round of event.rounds) eventOf[round.id] = event.id;
  for (const event of wcif.events)
    for (const round of event.rounds) {
      const src = round.participationRuleset?.participationSource;
      if (!src || src.type === 'registrations') continue;
      const { type, scope, value } = src.resultCondition;
      if (value == null) continue;
      const from = src.type === 'round' ? src.roundId : src.roundIds.at(-1)!;
      const bar = type === 'ranking' || type === 'percent' ? null
        : resultText(strings, eventOf[from] ?? event.id, value, scope === 'average');
      const text = type === 'ranking' ? strings.top(value)
        : type === 'percent' ? strings.topPercent(value)
        : bar === null ? '' : `< ${bar}`;
      if (text) proceedOf[from] = text;
    }

  // Non-breaking inside each format, so "Moyenne de 5" never splits: a narrow cell breaks at the slash.
  // An unknown format prints raw rather than failing the whole parse.
  const formatOf = (f: string) => (lookup<RoundFormat>(strings.formats, f) ?? f).replace(/ /g, '\u00a0');
  const nameOf = (roundId: string) => {
    const code = parseActivityCode(roundId);
    return code ? roundName(code) : roundId;
  };
  const roundInfo: Record<string, VenueRound> = {};
  const events: VenueEvent[] = wcif.events.map(event => ({
    eventId: event.id,
    name: getEventName(event.id, language),
    rounds: event.rounds.map((round, i) => {
      // Multi-blind cutoffs encode points and its limit is per cube (H1b).
      const cutoffValue = !round.cutoff || event.id === '333mbf' ? ''
        : resultText(strings, event.id, round.cutoff.resultValue, false) ?? '';
      const limit = round.timeLimit && event.id !== '333mbf' ? resultTime(round.timeLimit.centiseconds) : '';
      const cumulative = round.timeLimit?.cumulativeRoundIds ?? [];
      const others = cumulative.filter(id => id !== round.id);
      const info: VenueRound = {
        label: roundLabel(event.id, i + 1),
        format: round.cutoff
          ? `${formatOf(String(round.cutoff.numberOfAttempts))} / ${formatOf(round.format)}`
          : formatOf(round.format),
        cutoff: cutoffValue && strings.cutoff(cutoffValue),
        timeLimit: limit && cumulative.length > 0 ? strings.cumulative(limit) : limit,
        shared: limit && others.length > 0 ? strings.sharedWith(others.map(nameOf).join(', ')) : '',
        proceed: proceedOf[round.id] ?? '',
      };
      roundInfo[round.id] = info;
      return info;
    }),
  }));
  const byDate = new Map<string, { at: number; row: VenueRow }[]>();
  const seen = new Map<string, VenueRow>();
  for (const venue of wcif.schedule.venues)
    for (const room of venue.rooms)
      for (const activity of room.activities) {
        const code = parseActivityCode(activity.activityCode);
        const round = code ? roundInfo[roundIdOf(code)] : undefined;
        // A round of an event no longer in the WCIF has nothing to print.
        if (code && !round) continue;
        const name = code ? roundName(code)
          : lookup(strings.activities, activity.activityCode.replace(/^other-/, '')) ?? activity.name;
        // By printed name: two rooms' "Lunch" and "Dîner" under one code are one row.
        const key = `${activity.activityCode}|${name}|${activity.startTime}|${activity.endTime}`;
        const twin = seen.get(key);
        if (twin) { if (!twin.rooms.includes(room.name)) twin.rooms.push(room.name); continue; }
        const date = localDate(activity.startTime);
        if (!byDate.has(date)) byDate.set(date, []);
        const row: VenueRow = {
          start: clock(localTime(activity.startTime), language),
          end: clock(localTime(activity.endTime), language),
          eventId: code?.eventId ?? null,
          name,
          rooms: [room.name],
          round: round ?? null,
        };
        seen.set(key, row);
        byDate.get(date)!.push({ at: Date.parse(activity.startTime), row });
      }

  if (events.length === 0 && byDate.size === 0) return null;
  const days = [...byDate].sort(([a], [b]) => cmp(a, b)).map(([date, rows]) => ({
    dateLabel: fullDateLabel(date),
    // Stable: rooms starting at the same minute keep WCIF room order.
    rows: rows.sort((a, b) => a.at - b.at).map(r => r.row),
  }));

  return { events, days };
}
