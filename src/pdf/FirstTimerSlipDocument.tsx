import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { CompetitionSettings, LocaleCode } from '../types/settings';
import type { FirstTimerEntry } from '../lib/wcif-parser';
import { getFirstTimerSlipStrings, type FirstTimerSlipStrings } from '../lib/i18n';
import { buildSlipLines, packSlipPages, type SlipLine } from './firstTimerSlipLines';
import {
  SLIP_LINE_H, SLIP_FONT_SIZE, SLIP_PAGE_PAD_TOP, SLIP_PAGE_PAD_BOTTOM,
  SLIP_MARGIN_BOTTOM, SLIP_INTRO_MARGIN_BOTTOM,
  PDF_FONT as FONT, PDF_FONT_BOLD as FONT_BOLD,
} from './layoutConstants';
import './fontSetup';



// Layout follows the original "Gros Jouets à Montréal – First-Timer Slips" PDF
// (left margin 36pt, top 38pt, 11pt Helvetica, flowing checklist, no borders/cut
// lines) but with tightened vertical spacing so three large slips (4–5 events)
// reliably fit one LETTER/A4 page - the original wasted paper, dropping to two
// big slips per page. Fixed-height rows give a predictable pitch (@react-pdf
// inflates lineHeight by a constant factor, so lineHeight tuning is unreliable).
// Slips flow and pack: short single-event slips fit four per page.
const LINE_H = SLIP_LINE_H;

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    paddingLeft: 36,
    paddingRight: 36,
    paddingTop: SLIP_PAGE_PAD_TOP,
    paddingBottom: SLIP_PAGE_PAD_BOTTOM,
    fontFamily: FONT,
    fontSize: SLIP_FONT_SIZE,
    color: '#000000',
  },
  // One newcomer's checklist; wrap={false} keeps it whole across page breaks.
  slip: {
    marginBottom: SLIP_MARGIN_BOTTOM,
  },
  intro: {
    marginBottom: SLIP_INTRO_MARGIN_BOTTOM,
  },
  // alignSelf flex-start shrinks the row to its content so the checkbox hugs the
  // end of the text (as in the original) instead of stretching to the right margin.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    height: LINE_H,
  },
  bold: {
    fontFamily: FONT_BOLD,
  },
  checkbox: {
    width: 9,
    height: 9,
    border: '0.7pt solid #000000',
    marginLeft: 6,
  },
});

// A plain text row (no checkbox) - used for the intro and the multi-event header.
function TextRow({ children }: { children: string }) {
  return (
    <View style={styles.row}>
      <Text>{children}</Text>
    </View>
  );
}

// A checklist line: text (with optional bold trailing value) followed by a checkbox.
function Item({ prefix, value }: { prefix: string; value?: string }) {
  return (
    <View style={styles.row}>
      <Text>
        {prefix}
        {value ? <Text style={styles.bold}>{` ${value}`}</Text> : null}
      </Text>
      <View style={styles.checkbox} />
    </View>
  );
}

function LineView({ line }: { line: SlipLine }) {
  if (!line.checkbox) return <TextRow>{line.text}</TextRow>;
  return <Item prefix={line.text} value={line.bold} />;
}

function Slip({
  entry, s, language,
}: { entry: FirstTimerEntry; s: FirstTimerSlipStrings; language: LocaleCode }) {
  const lines = buildSlipLines(entry, s, language);
  return (
    <View style={styles.slip} wrap={false}>
      {/* First two lines are the intro; group them so the block gets its bottom gap. */}
      <View style={styles.intro}>
        {lines.slice(0, 2).map((line, i) => <LineView key={i} line={line} />)}
      </View>
      {lines.slice(2).map((line, i) => <LineView key={i} line={line} />)}
    </View>
  );
}

interface Props {
  entries: FirstTimerEntry[];
  settings: CompetitionSettings;
}

export function FirstTimerSlipDocument({ entries, settings }: Props) {
  const s = getFirstTimerSlipStrings(settings.language);

  // Pre-packed rather than flowed: see packSlipPages. The pitch is fixed, so the packing
  // reproduces what @react-pdf's own pagination did.
  const pages = packSlipPages(entries, s, settings.language, settings.paperFormat);

  return (
    <Document title={`${settings.competitionName} - First-Timer Slips`} author="WCA Scorecard Generator">
      {pages.map((page, pi) => (
        <Page key={pi} size={settings.paperFormat} style={styles.page}>
          {page.map((entry, i) => (
            <Slip key={i} entry={entry} s={s} language={settings.language} />
          ))}
        </Page>
      ))}
    </Document>
  );
}
