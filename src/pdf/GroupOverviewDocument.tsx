import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { CompetitionSettings } from '../types/settings';
import type { GroupOverviewEntry } from '../lib/wcif-parser';
import { getGroupOverviewStrings } from '../lib/i18n';
import { visibleColumns } from './groupOverviewColumns';
import {
  GROUP_OVERVIEW as G, groupBlockFitsPage,
  PDF_FONT as FONT, PDF_FONT_BOLD as FONT_BOLD,
  TABLE_BORDER as BORDER, TABLE_BORDER_INNER as BORDER_INNER,
  TABLE_HEADER_BG as HEADER_BG,
} from './layoutConstants';
import './fontSetup';

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    paddingHorizontal: G.pagePadH,
    paddingVertical: G.pagePadV,
    fontFamily: FONT,
  },
  title: {
    fontSize: 18,
    textAlign: 'center',
    fontFamily: FONT_BOLD,
    marginBottom: 22,
  },
  dayLabel: {
    fontSize: 13,
    fontFamily: FONT_BOLD,
    marginBottom: 5,
  },
  // Heading + time/room line + table. wrap={false}: a group is never split across pages.
  groupBlock: {
    marginBottom: G.blockGap,
  },
  heading: {
    fontSize: 12,
    fontFamily: FONT_BOLD,
    marginBottom: 2,
  },
  subHead: {
    fontSize: 9,
    marginBottom: 4,
  },
  table: {
    border: BORDER,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: HEADER_BG,
    borderBottom: BORDER,
  },
  bodyRow: {
    flexDirection: 'row',
  },
  headerText: {
    fontSize: 8,
    fontFamily: FONT_BOLD,
    textAlign: 'center',
  },
  name: {
    fontSize: G.fontSize,
    lineHeight: G.lineH / G.fontSize,
  },
});

// Built from the flex map, so a column cannot get one width here and another in the header.
function cellStyle(flex: number, last: boolean, header: boolean) {
  return {
    flex,
    paddingVertical: header ? 5 : G.cellPadV,
    paddingHorizontal: 5,
    ...(header ? { justifyContent: 'center' as const, alignItems: 'center' as const } : {}),
    ...(last ? {} : { borderRight: header ? BORDER : BORDER_INNER }),
  };
}

interface Props {
  entries: GroupOverviewEntry[];
  settings: CompetitionSettings;
}

export function GroupOverviewDocument({ entries, settings }: Props) {
  const strings = getGroupOverviewStrings(settings.language);

  const columns = visibleColumns(entries);

  // The day only needs naming when there is more than one of them.
  const multiDay = new Set(entries.map((e) => e.dayLabel)).size > 1;

  return (
    <Document title={`${settings.competitionName} - Group Overview`} author="WCA Scorecard Generator">
      <Page size={settings.paperFormat} style={styles.page}>
        <Text style={styles.title}>{settings.competitionName} {strings.title}</Text>

        {entries.map((entry, ei) => {
          const withDayLabel = multiDay && entry.dayLabel !== entries[ei - 1]?.dayLabel;
          const rows = Math.max(...columns.map((c) => entry[c.key].length));
          return (
          // Pinned so a group is never split, except when it could not fit a page anyway:
          // react-pdf squashes an oversized non-breaking block rather than paginating it.
          <View
            key={ei}
            style={styles.groupBlock}
            wrap={!groupBlockFitsPage(rows, withDayLabel, settings.paperFormat)}
          >
            {withDayLabel && (
              <Text style={styles.dayLabel}>{entry.dayLabel}</Text>
            )}
            <Text style={styles.heading}>{entry.heading}</Text>
            <Text style={styles.subHead}>
              {entry.startTime} - {entry.endTime}
              {entry.room ? `    ${strings.room}: ${entry.room}` : ''}
            </Text>

            <View style={styles.table}>
              <View style={styles.headerRow}>
                {columns.map((col, ci) => (
                  <View key={col.key} style={cellStyle(col.flex, ci === columns.length - 1, true)}>
                    <Text style={styles.headerText}>
                      {col.label(strings)} ({entry[col.key].length})
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.bodyRow}>
                {columns.map((col, ci) => (
                  <View key={col.key} style={cellStyle(col.flex, ci === columns.length - 1, false)}>
                    {entry[col.key].map((name, ni) => (
                      <Text key={ni} style={styles.name}>
                        {/* The ordinal IS the station number when the WCIF assigns stations. */}
                        {col.key === 'competitors' ? `${ni + 1}. ${name}` : name}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </View>
          </View>
          );
        })}
      </Page>
    </Document>
  );
}
