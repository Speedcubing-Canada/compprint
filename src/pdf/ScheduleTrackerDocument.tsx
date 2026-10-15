import { APP_NAME } from '../brand';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { CompetitionSettings } from '../types/settings';
import type { ScheduleDay } from '../lib/wcif-parser';
import { getScheduleStrings, type ScheduleStrings } from '../lib/i18n';
import {
  CHECKING_BREAK_RULE,
  PDF_FONT as FONT, PDF_FONT_BOLD as FONT_BOLD,
  TABLE_BORDER as BORDER, TABLE_BORDER_INNER as BORDER_INNER,
  TABLE_ROW_ALT as ROW_ALT, TABLE_HEADER_BG as HEADER_BG,
} from './layoutConstants';
import './fontSetup';



const FLEX = { time: 1, event: 2.5, competitors: 1.2 };

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 30,
    paddingVertical: 36,
    fontFamily: FONT,
  },
  title: {
    fontSize: 18,
    textAlign: 'center',
    fontFamily: FONT_BOLD,
    marginBottom: 22,
  },
  // Wraps [optional day label] + [optional stage name] + table.
  // wrap={false} prevents this block from splitting across pages.
  stageBlock: {
    marginBottom: 14,
  },
  dayLabel: {
    fontSize: 13,
    fontFamily: FONT_BOLD,
    marginBottom: 6,
  },
  stageName: {
    fontSize: 11,
    fontFamily: FONT_BOLD,
    marginBottom: 4,
    marginLeft: 2,
  },
  table: {
    border: BORDER,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: HEADER_BG,
    borderBottom: BORDER,
  },
  dataRowEven: {
    flexDirection: 'row',
    borderBottom: BORDER_INNER,
    backgroundColor: '#ffffff',
  },
  dataRowOdd: {
    flexDirection: 'row',
    borderBottom: BORDER_INNER,
    backgroundColor: ROW_ALT,
  },
  cell: {
    flex: FLEX.time,
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRight: BORDER_INNER,
  },
  cellEvent: {
    flex: FLEX.event,
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRight: BORDER_INNER,
  },
  cellLast: {
    flex: FLEX.competitors,
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCell: {
    flex: FLEX.time,
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRight: BORDER,
  },
  headerCellEvent: {
    flex: FLEX.event,
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderRight: BORDER,
  },
  headerCellLast: {
    flex: FLEX.competitors,
    paddingVertical: 6,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    fontSize: 8,
    fontFamily: FONT_BOLD,
    textAlign: 'center',
  },
  cellText: {
    fontSize: 10,
    textAlign: 'center',
  },
});

function TableHeader({ strings }: { strings: ScheduleStrings }) {
  return (
    <View style={styles.headerRow}>
      <View style={styles.headerCell}>
        <Text style={styles.headerText}>{strings.estimatedStart}</Text>
      </View>
      <View style={styles.headerCell}>
        <Text style={styles.headerText}>{strings.estimatedEnd}</Text>
      </View>
      <View style={styles.headerCellEvent}>
        <Text style={styles.headerText}>{strings.event}</Text>
      </View>
      <View style={styles.headerCell}>
        <Text style={styles.headerText}>{strings.actualStart}</Text>
      </View>
      <View style={styles.headerCell}>
        <Text style={styles.headerText}>{strings.actualEnd}</Text>
      </View>
      <View style={styles.headerCellLast}>
        <Text style={styles.headerText}>{strings.numberOfCompetitors}</Text>
      </View>
    </View>
  );
}

interface Props {
  days: ScheduleDay[];
  settings: CompetitionSettings;
}

export function ScheduleTrackerDocument({ days, settings }: Props) {
  // Show room names only when there are multiple rooms in any day.
  const multiStage = days.some(d => d.stages.length > 1);
  const strings = getScheduleStrings(settings.language);

  return (
    <Document title={`${settings.competitionName} - Schedule Tracker`} author={APP_NAME}>
      <Page size={settings.paperFormat} style={styles.page}>
        <Text style={styles.title}>{settings.competitionName} {strings.title}</Text>

        {days.map((day, di) =>
          day.stages.map((stage, si) => (
            // Each (day × room) block is non-breaking.
            // The day label is included only in the first room's block so it stays
            // anchored to its content. Subsequent rooms of the same day have no day label.
            <View key={`${di}-${si}`} style={styles.stageBlock} wrap={false}>
              {si === 0 && (
                <Text style={styles.dayLabel}>{day.dayLabel}</Text>
              )}
              {multiStage && (
                <Text style={styles.stageName}>{stage.stageName}</Text>
              )}
              <View style={styles.table}>
                <TableHeader strings={strings} />
                {stage.rows.map((row, ri) => {
                  const base = ri % 2 === 0 ? styles.dataRowEven : styles.dataRowOdd;
                  return (
                    // A lunch break scheduled between this row and the one above draws a
                    // thick rule, the same marker the checking sheet uses.
                    <View key={ri} style={row.breakBefore ? [base, { borderTop: CHECKING_BREAK_RULE }] : base}>
                      <View style={styles.cell}>
                        <Text style={styles.cellText}>{row.startTime}</Text>
                      </View>
                      <View style={styles.cell}>
                        <Text style={styles.cellText}>{row.endTime}</Text>
                      </View>
                      <View style={styles.cellEvent}>
                        <Text style={styles.cellText}>{row.eventRound}</Text>
                      </View>
                      <View style={styles.cell} />
                      <View style={styles.cell} />
                      <View style={styles.cellLast} />
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </Page>
    </Document>
  );
}
