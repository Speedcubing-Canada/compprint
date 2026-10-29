import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { docMeta } from './docMeta';
import type { CompetitionSettings } from '../types/settings';
import type { VenueRound, VenueSchedule } from '../lib/venueSchedule';
import { getVenueScheduleStrings, type VenueScheduleStrings } from '../lib/i18n';
import { EVENT_ICONS } from '../assets/events';
import {
  PDF_FONT as FONT, PDF_FONT_BOLD as FONT_BOLD,
  TABLE_BORDER as BORDER, TABLE_BORDER_INNER as BORDER_INNER, TABLE_HEADER_BG as HEADER_BG,
} from './layoutConstants';
import './fontSetup';

const ROUND_FLEX = { round: 1.4, format: 1.4, limit: 1.6, proceed: 1 };
const EVENT_FLEX = { event: 2.4, ...ROUND_FLEX };
const DAY_FLEX = { start: 0.8, end: 0.8, activity: 3.6, format: 1.4, limit: 1.6, proceed: 1 };
const ICON = 14;

// Percent widths, not flex: flex adds each cell's padding on top, so the header drifts off the body.
type Widths = Record<string, string>;
const percent = (flex: Record<string, number>): Widths => {
  const total = Object.values(flex).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(flex).map(([k, v]) => [k, `${(v / total) * 100}%`]));
};
const EVENT_W = percent(EVENT_FLEX);
// Relative to the rounds column, which fills what the event cell leaves.
const ROUND_W = percent(ROUND_FLEX);
const DAY_W = percent(DAY_FLEX);

const s = StyleSheet.create({
  page: { paddingHorizontal: 30, paddingVertical: 28, fontFamily: FONT, backgroundColor: '#ffffff' },
  kicker: { fontSize: 10, color: '#555', marginBottom: 2 },
  title: { fontSize: 18, fontFamily: FONT_BOLD, marginBottom: 10 },
  headerRow: { flexDirection: 'row', backgroundColor: HEADER_BG, border: BORDER },
  headerCell: { paddingVertical: 4, paddingHorizontal: 4, justifyContent: 'center', borderRight: BORDER_INNER },
  headerText: { fontSize: 8, fontFamily: FONT_BOLD, textAlign: 'center' },
  row: { flexDirection: 'row', borderLeft: BORDER, borderRight: BORDER, borderBottom: BORDER_INNER },
  cell: { paddingVertical: 4, paddingHorizontal: 4, justifyContent: 'center', alignItems: 'center', borderRight: BORDER_INNER },
  text: { fontSize: 9, textAlign: 'center' },
  bold: { fontSize: 10, fontFamily: FONT_BOLD, textAlign: 'center' },
  sub: { fontSize: 7.5, color: '#555', textAlign: 'center', marginTop: 1 },
  eventCell: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6, borderRight: BORDER_INNER },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 6, borderRight: BORDER_INNER },
});

// Repeated on every page a long table spills onto, with the title above it.
function Heading({ kicker, title, columns, widths }: { kicker: string; title: string; columns: string[]; widths: Widths }) {
  const w = Object.values(widths);
  return (
    <View fixed>
      <Text style={s.kicker}>{kicker}</Text>
      <Text style={s.title}>{title}</Text>
      <View style={s.headerRow}>
        {columns.map((c, i) => (
          <View key={i} style={[s.headerCell, { width: w[i] }, i === columns.length - 1 ? { borderRight: 0 } : {}]}>
            <Text style={s.headerText}>{c}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function RoundCells({ round, w }: { round: VenueRound | null; w: Widths }) {
  return (
    <>
      <View style={[s.cell, { width: w.format }]}>
        <Text style={s.text}>{round?.format}</Text>
        {round?.cutoff ? <Text style={s.sub}>{round.cutoff}</Text> : null}
      </View>
      <View style={[s.cell, { width: w.limit }]}><Text style={s.text}>{round?.timeLimit}</Text></View>
      <View style={[s.cell, { width: w.proceed, borderRight: 0 }]}><Text style={s.text}>{round?.proceed}</Text></View>
    </>
  );
}

function Icon({ eventId }: { eventId: string | null }) {
  const src = eventId ? EVENT_ICONS[eventId] : undefined;
  return src ? <Image src={src} style={{ width: ICON, height: ICON }} /> : <View style={{ width: ICON }} />;
}

interface Props {
  schedule: VenueSchedule;
  settings: CompetitionSettings;
}

export function VenueScheduleDocument({ schedule, settings }: Props) {
  const p = getVenueScheduleStrings(settings.language);
  const sec = settings.secondaryLanguage && settings.secondaryLanguage !== settings.language
    ? getVenueScheduleStrings(settings.secondaryLanguage) : null;
  // "Format" reads the same in French and English: printed once.
  const both = (k: keyof VenueScheduleStrings, sep: string) =>
    (sec && sec[k] !== p[k] ? `${p[k]}${sep}${sec[k]}` : p[k]) as string;
  const header = (k: keyof VenueScheduleStrings) => both(k, '\n');
  const title = (k: keyof VenueScheduleStrings) => both(k, ' / ');
  const pageProps = { size: settings.paperFormat, orientation: 'landscape' as const, style: s.page };
  const compName = settings.competitionName;
  // One room needs no room line under every activity.
  const multiRoom = new Set(schedule.days.flatMap(d => d.rows.flatMap(r => r.rooms))).size > 1;

  return (
    <Document {...docMeta(compName, 'Venue Schedule')}>
      {schedule.events.length > 0 && (
        <Page {...pageProps}>
          <Heading kicker={compName} title={title('events')} widths={EVENT_W}
            columns={[header('event'), header('round'), header('format'), header('timeLimit'), header('proceed')]} />
          {schedule.events.map(ev => (
            <View key={ev.eventId} style={s.row} wrap={false}>
              <View style={[s.eventCell, { width: EVENT_W.event }]}>
                <Icon eventId={ev.eventId} />
                <Text style={[s.bold, { textAlign: 'left' }]}>{ev.name}</Text>
              </View>
              <View style={{ flex: 1 }}>
                {ev.rounds.map((r, i) => (
                  <View key={i} style={[{ flexDirection: 'row' }, i > 0 ? { borderTop: BORDER_INNER } : {}]}>
                    <View style={[s.cell, { width: ROUND_W.round }]}><Text style={s.text}>{r.label}</Text></View>
                    <RoundCells round={r} w={ROUND_W} />
                  </View>
                ))}
              </View>
            </View>
          ))}
        </Page>
      )}
      {schedule.days.map((day, di) => (
        <Page key={di} {...pageProps}>
          <Heading kicker={`${compName} · ${title('schedule')}`} title={day.dateLabel} widths={DAY_W}
            columns={[header('start'), header('end'), header('activity'), header('format'), header('timeLimit'), header('proceed')]} />
          {day.rows.map((row, ri) => (
            <View key={ri} style={s.row} wrap={false}>
              <View style={[s.cell, { width: DAY_W.start }]}><Text style={s.text}>{row.start}</Text></View>
              <View style={[s.cell, { width: DAY_W.end }]}><Text style={s.text}>{row.end}</Text></View>
              <View style={[s.activity, { width: DAY_W.activity }]}>
                <Icon eventId={row.eventId} />
                <View style={{ flex: 1 }}>
                  <Text style={s.bold}>{row.name}</Text>
                  {multiRoom ? <Text style={s.sub}>{row.rooms.join(', ')}</Text> : null}
                </View>
                <View style={{ width: ICON }} />
              </View>
              <RoundCells round={row.round} w={DAY_W} />
            </View>
          ))}
        </Page>
      ))}
    </Document>
  );
}
