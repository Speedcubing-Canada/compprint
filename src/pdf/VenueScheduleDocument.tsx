import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { docMeta } from './docMeta';
import type { CompetitionSettings } from '../types/settings';
import type { VenueRound, VenueSchedule } from '../lib/venueSchedule';
import { getVenueScheduleStrings, type VenueScheduleStrings } from '../lib/i18n';
import { EVENT_ICONS } from '../assets/events';
import {
  PDF_FONT as FONT, PDF_FONT_BOLD as FONT_BOLD, VENUE_SCHEDULE as V,
  VENUE_ROUND_COLS as ROUND_COLS, VENUE_EVENT_COLS as EVENT_COLS, VENUE_DAY_COLS as DAY_COLS, VENUE_ICON as ICON,
  TABLE_BORDER as BORDER, TABLE_BORDER_INNER as BORDER_INNER, TABLE_HEADER_BG as HEADER_BG,
} from './layoutConstants';
import './fontSetup';

type Label = { [K in keyof VenueScheduleStrings]: VenueScheduleStrings[K] extends string ? K : never }[keyof VenueScheduleStrings];
type Columns = Partial<Record<Label, number>>;

// Percent widths, not flex: flex adds each cell's padding on top, so the header drifts off the body.
const percent = <C extends Columns>(cols: C) => {
  const total = Object.values(cols).reduce((a: number, b) => a + (b ?? 0), 0);
  return Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, `${(v / total) * 100}%`])) as Record<keyof C, string>;
};
const EVENT_W = percent(EVENT_COLS);
// Relative to the rounds column, which fills what the event cell leaves.
const ROUND_W = percent(ROUND_COLS);
const DAY_W = percent(DAY_COLS);

const s = StyleSheet.create({
  page: { paddingHorizontal: V.pagePadH, paddingVertical: V.pagePadV, fontFamily: FONT, backgroundColor: '#ffffff' },
  kicker: { fontSize: 10, lineHeight: V.lineHeight, color: '#555', marginBottom: 2 },
  title: { fontSize: 18, lineHeight: V.lineHeight, fontFamily: FONT_BOLD, marginBottom: 10 },
  headerRow: { flexDirection: 'row', minHeight: V.headerH, backgroundColor: HEADER_BG, border: BORDER },
  headerCell: { paddingHorizontal: 4, justifyContent: 'center', borderRight: BORDER_INNER },
  headerText: { fontSize: 8, lineHeight: V.lineHeight, fontFamily: FONT_BOLD, textAlign: 'center' },
  row: { flexDirection: 'row', borderLeft: BORDER, borderRight: BORDER, borderBottom: BORDER_INNER },
  dayRow: { minHeight: V.rowH },
  roundRow: { flexDirection: 'row', minHeight: V.rowH },
  cell: { paddingVertical: 3, paddingHorizontal: 4, justifyContent: 'center', alignItems: 'center', borderRight: BORDER_INNER },
  last: { borderRight: 0 },
  text: { fontSize: 9, lineHeight: V.lineHeight, textAlign: 'center' },
  bold: { fontSize: 10, lineHeight: V.lineHeight, fontFamily: FONT_BOLD, textAlign: 'center' },
  sub: { fontSize: 7.5, lineHeight: V.lineHeight, color: '#555', textAlign: 'center', marginTop: 1 },
  eventCell: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 6, borderRight: BORDER_INNER },
  eventName: { textAlign: 'left' },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3, paddingHorizontal: 6, borderRight: BORDER_INNER },
  grow: { flex: 1 },
  icon: { width: ICON, height: ICON },
});

// Repeated on every page a long table spills onto, with the title above it.
function Heading({ kicker, title, widths, label }: {
  kicker: string; title: string; widths: Partial<Record<Label, string>>; label: (k: Label) => string;
}) {
  const keys = Object.keys(widths) as Label[];
  return (
    <View fixed>
      <Text style={s.kicker}>{kicker}</Text>
      <Text style={s.title}>{title}</Text>
      <View style={s.headerRow}>
        {keys.map((k, i) => (
          <View key={k} style={[s.headerCell, { width: widths[k] }, i === keys.length - 1 ? s.last : {}]}>
            <Text style={s.headerText}>{label(k)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function RoundCells({ round, w }: { round: VenueRound | null; w: Record<'format' | 'timeLimit' | 'proceed', string> }) {
  return (
    <>
      <View style={[s.cell, { width: w.format }]}>
        <Text style={s.text}>{round?.format}</Text>
        {round?.cutoff ? <Text style={s.sub}>{round.cutoff}</Text> : null}
      </View>
      <View style={[s.cell, { width: w.timeLimit }]}>
        <Text style={s.text}>{round?.timeLimit}</Text>
        {round?.shared ? <Text style={s.sub}>{round.shared}</Text> : null}
      </View>
      <View style={[s.cell, s.last, { width: w.proceed }]}><Text style={s.text}>{round?.proceed}</Text></View>
    </>
  );
}

function Icon({ eventId }: { eventId: string | null }) {
  const src = eventId ? EVENT_ICONS[eventId] : undefined;
  return src ? <Image src={src} style={s.icon} /> : <View style={{ width: ICON }} />;
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
  const both = (k: Label, sep: string) => (sec && sec[k] !== p[k] ? `${p[k]}${sep}${sec[k]}` : p[k]);
  const header = (k: Label) => both(k, '\n');
  const pageProps = { size: settings.paperFormat, orientation: 'landscape' as const, style: s.page };
  const compName = settings.competitionName;
  // One room needs no room line under every activity.
  const multiRoom = new Set(schedule.days.flatMap(d => d.rows.flatMap(r => r.rooms))).size > 1;

  return (
    <Document {...docMeta(compName, 'Venue Schedule')}>
      {schedule.events.length > 0 && (
        <Page {...pageProps}>
          <Heading kicker={compName} title={both('events', ' / ')} widths={EVENT_W} label={header} />
          {schedule.events.map(ev => (
            <View key={ev.eventId} style={s.row} wrap={false}>
              <View style={[s.eventCell, { width: EVENT_W.event }]}>
                <Icon eventId={ev.eventId} />
                <Text style={[s.bold, s.eventName]}>{ev.name}</Text>
              </View>
              <View style={s.grow}>
                {ev.rounds.map((r, i) => (
                  <View key={i} style={[s.roundRow, i > 0 ? { borderTop: BORDER_INNER } : {}]}>
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
          <Heading kicker={`${compName} · ${both('schedule', ' / ')}`} title={day.dateLabel} widths={DAY_W} label={header} />
          {day.rows.map((row, ri) => (
            <View key={ri} style={[s.row, s.dayRow]} wrap={false}>
              <View style={[s.cell, { width: DAY_W.start }]}><Text style={s.text}>{row.start}</Text></View>
              <View style={[s.cell, { width: DAY_W.end }]}><Text style={s.text}>{row.end}</Text></View>
              <View style={[s.activity, { width: DAY_W.activity }]}>
                <Icon eventId={row.eventId} />
                <View style={s.grow}>
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
