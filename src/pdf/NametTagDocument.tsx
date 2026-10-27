import type { ReactNode } from 'react';
import { Document, Page, View, Text, Image, StyleSheet, Svg, Path } from '@react-pdf/renderer';
import { docMeta } from './docMeta';
import type { CompetitionSettings, LiveResultsMode, NametTagLayout, NametTagLogoMode } from '../types/settings';
import type { NametTagEntry, NametTagRole } from '../lib/wcif-parser';
import { EVENT_ICONS } from '../assets/events';
import { getNametTagStrings, type NametTagStrings } from '../lib/i18n';
import { resolveLogo } from '../lib/logo';
import { qrPathData } from './qrPath';
import {
  NAMETAGS_PER_PAGE, NAMETAG_COMPACT as C, NAMETAG_COMPACT_NAME_H, NAMETAG_CONFIGS, NAMETAG_H, NAMETAG_PANEL_BORDER,
  NAMETAG_PANEL_PAD, eventIconsVisible, liveQrTarget, nametagCompactQrSize, nametagHPositions, nametagNameH,
  nametagTopSectionH,
  PDF_FONT as FONT, PDF_FONT_BOLD as FONT_BOLD,
} from './layoutConstants';
import './fontSetup';
import { nametagInnerW, nametagName, NAME_LINE_HEIGHT, textWidth } from './nameFit';


// Vertical layout: landscape page, 4 slots wide × 2 tall = 8 slots = 4 pairs.
//   Layout per page (persons A, B, C, D):
//     row 0: [Front_A] [Back_A] [Front_B] [Back_B]
//     row 1: [Front_C] [Back_C] [Front_D] [Back_D]
//
// Horizontal layout: portrait page, 2 slots wide × 4 tall = 8 slots = 4 pairs.
//   Layout per page (persons A, B, C, D):
//     row 0: [Front_A] [Back_A]
//     row 1: [Front_B] [Back_B]
//     row 2: [Front_C] [Back_C]
//     row 3: [Front_D] [Back_D]
//   Cards are landscape 90x55mm (NAMETAG_H), centred on the page, no rotation.

function panelPositions(cfg: { panelW: number; panelH: number; margin: number; gapH: number; gapV: number }) {
  const { panelW, panelH, margin, gapH, gapV } = cfg;
  const pos: { left: number; top: number }[] = [];
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 4; col++)
      pos.push({ left: margin + col * (panelW + gapH), top: margin + row * (panelH + gapV) });
  return pos;
}

function QrSvg({ url, size }: { url: string; size: number }) {
  const { d, modules } = qrPathData(url);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${modules} ${modules}`}>
      <Path d={d} fill="black" />
    </Svg>
  );
}

const NBSP = ' ';

function badgeColors(role: NametTagRole) {
  if (role === 'delegate' || role === 'organizer' || role === 'staff')
    return { bg: '#343434', fg: 'white' };
  if (role === 'new-competitor')
    return { bg: '#A9A9A9', fg: 'black' };
  return { bg: '#DCDCDC', fg: 'black' };
}

// Each item is its own Text, so no dash artifacts. Items sit four spaces apart, as in the originals.
function DutyLines({ duties, fontSize }: { duties: string[]; fontSize: number }) {
  const sorted = [...duties].sort();
  return (
    <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', rowGap: 2, columnGap: textWidth('    ', fontSize, false) }}>
      {sorted.map((duty, i) => {
        const sep = duty.indexOf(': ');
        if (sep === -1) return <Text key={i} style={{ fontSize }}>{duty}</Text>;
        const event = duty.slice(0, sep).replace(/ /g, NBSP);
        const group = duty.slice(sep + 2).replace(/ /g, NBSP);
        return (
          <Text key={i} style={{ fontSize }}>
            <Text style={{ fontFamily: FONT }}>{event + NBSP}</Text>
            <Text style={{ fontFamily: FONT_BOLD }}>{group}</Text>
          </Text>
        );
      })}
    </View>
  );
}

// Shared top section
// logoMode:
//   'hidden'    → comp name text only
//   'with-name' → small logo + comp name text side-by-side
//   'logo-only' → large logo centred, no comp name text
function PanelTop({ entry, panelW, compName, titleText, logoMode, logoDataUrl, compact = false, showEvents = true }: {
  entry: NametTagEntry; panelW: number; compName: string; titleText: string;
  logoMode: NametTagLogoMode; logoDataUrl: string | null;
  compact?: boolean; showEvents?: boolean;
}) {
  const { bg, fg } = badgeColors(entry.role);
  const c: Partial<typeof sc> = compact ? sc : {};
  const name = nametagName(entry.name, panelW, compact ? NAMETAG_COMPACT_NAME_H : nametagNameH(logoMode));
  const icons = entry.events.filter(evId => EVENT_ICONS[evId]);
  // Spread like the originals, shrunk only when a full-event competitor would overrun the row.
  const iconSz = Math.min(compact ? C.iconMax : 14, nametagInnerW(panelW) / Math.max(icons.length, 1) - 1);

  // Compact tags top-pack and never shrink, so the role badge lands at the same Y on front and
  // back and the two align across the pair. Event icons follow the badge, so hiding them on the
  // QR side does not move it.
  return (
    <View style={compact ? { flexShrink: 0, flexDirection: 'column' } : { height: nametagTopSectionH(logoMode), flexDirection: 'column' }}>
      {logoMode === 'logo-only' && logoDataUrl ? (
        <Image src={logoDataUrl} style={[s.logoLarge, c.logoLarge]} />
      ) : logoMode === 'with-name' && logoDataUrl ? (
        <View style={s.logoHeaderRow}>
          <Image src={logoDataUrl} style={[s.logoSmall, c.logoSmall]} />
          <Text style={[s.compName, { marginBottom: 0 }]}>{compName}</Text>
        </View>
      ) : (
        <Text style={[s.compName, c.compName]}>{compName}</Text>
      )}
      <Text style={[s.name, c.name, { fontSize: name.fontSize, lineHeight: NAME_LINE_HEIGHT }]}>{name.text}</Text>
      {!compact && <View style={{ flex: 1 }} />}
      <View style={[s.badge, c.badge, { backgroundColor: bg }]}>
        <Text style={[s.badgeText, c.badgeText, { color: fg }]}>{titleText}</Text>
      </View>
      {showEvents && (
        <View style={[s.iconsRow, c.iconsRow]}>
          {icons.map(evId => <Image key={evId} src={EVENT_ICONS[evId]} style={{ width: iconSz, height: iconSz }} />)}
        </View>
      )}
      {!compact && <Text style={s.wcaId}>{entry.wcaId || ' '}</Text>}
    </View>
  );
}

// Threads through both panels untouched; only QrSection reads any of it.
interface QrConfig {
  mode: LiveResultsMode;
  competitionId: string;
  wcaLiveId: string | null;
  wcaLivePersonIds: Record<number, string> | null;
}

// Compact: the WCA ID sits centred between badge and the bottom-pinned QR codes. `wcaId` null
// keeps the gap, so a QR front lines up with its back.
function QrSection({ entry, qr, qrSize, strings, compact = false, wcaId = null }: {
  entry: NametTagEntry; qr: QrConfig; qrSize: number; strings: NametTagStrings;
  compact?: boolean; wcaId?: string | null;
}) {
  const cgComp = `https://www.competitiongroups.com/competitions/${qr.competitionId}`;
  const cgUrl = entry.blank || entry.staff ? cgComp : `${cgComp}/persons/${entry.registrantId}`;

  const codes = (
    <View style={compact ? sc.qrRow : s.qrSection}>
      <View style={[s.qrCol, compact ? sc.qrCol : {}]}>
        <QrSvg url={cgUrl} size={qrSize} />
        <Text style={s.qrLabel}>{strings.qrSchedule}</Text>
      </View>
      <View style={[s.qrCol, compact ? sc.qrCol : {}]}>
        <QrSvg url={liveQrTarget(qr, entry)} size={qrSize} />
        <Text style={s.qrLabel}>{strings.qrResults}</Text>
      </View>
    </View>
  );
  if (!compact) return codes;
  return (
    <>
      <View style={sc.idSlot}><Text style={sc.wcaId}>{wcaId || ' '}</Text></View>
      {codes}
    </>
  );
}

// One card at its grid position; border, padding and content live on this View.
function PanelFrame({ pos, panelW, panelH, children }: {
  pos: { left: number; top: number }; panelW: number; panelH: number; children: ReactNode;
}) {
  return (
    <View style={[s.panel, { position: 'absolute', left: pos.left, top: pos.top, width: panelW, height: panelH }]}>
      {children}
    </View>
  );
}

function FrontPanel({ entry, panelW, panelH, pos, compName, qr, logoMode, logoDataUrl, qrBothSides, qrSize, nametTagStrings, compact = false }: {
  entry: NametTagEntry; panelW: number; panelH: number;
  pos: { left: number; top: number }; compName: string;
  qr: QrConfig;
  logoMode: NametTagLogoMode; logoDataUrl: string | null;
  qrBothSides: boolean; qrSize: number;
  nametTagStrings: NametTagStrings;
  compact?: boolean;
}) {
  const frame = (children: ReactNode) => (
    <PanelFrame pos={pos} panelW={panelW} panelH={panelH}>{children}</PanelFrame>
  );

  if (qrBothSides || entry.staff) {
    return frame(<>
      <PanelTop entry={entry} panelW={panelW} compName={compName} titleText={entry.titleFront} logoMode={logoMode} logoDataUrl={logoDataUrl} compact={compact} showEvents={eventIconsVisible({ isQrSide: true, compact })} />
      <QrSection entry={entry} qr={qr} qrSize={qrSize} strings={nametTagStrings} compact={compact} />
    </>);
  }

  const rows = [
    { label: nametTagStrings.compete,  duties: entry.compete  },
    { label: nametTagStrings.scramble, duties: entry.scramble },
    { label: nametTagStrings.judge,    duties: entry.judge    },
    { label: nametTagStrings.run,      duties: entry.run      },
  ].filter(r => r.duties.length > 0);

  const totalItems = rows.reduce((sum, r) => sum + r.duties.length, 0);
  const dutyFs = Math.max(5, Math.min(7.5, 7.5 - Math.max(0, totalItems - 8) * 0.12));

  // Estimate whether space-evenly is safe. Assumes ~2 items/line, lineH = fontSize * 1.4.
  // Compact always spreads: its rows keep a 2pt gap, and Yoga top-packs space-evenly on overflow.
  const lineH = dutyFs * 1.4;
  const estLines = rows.reduce((sum, r) => sum + Math.ceil(r.duties.length / 2), 0);
  const estH = (estLines + rows.length) * lineH;
  const spaceEvenly = compact || estH < (panelH - nametagTopSectionH(logoMode)) * 0.90;

  return frame(<>
    <PanelTop entry={entry} panelW={panelW} compName={compName} titleText={entry.titleFront} logoMode={logoMode} logoDataUrl={logoDataUrl} compact={compact} />
    <View style={[s.dutiesSection, spaceEvenly ? { justifyContent: 'space-evenly' } : {}, compact ? { rowGap: 2 } : {}]}>
      {rows.map(({ label, duties }) => (
        <View key={label} style={[s.dutyRow, spaceEvenly ? {} : { marginBottom: 3 }]}>
          <Text style={[s.dutyLabel, { fontSize: dutyFs }]}>{label}</Text>
          <DutyLines duties={duties} fontSize={dutyFs} />
        </View>
      ))}
    </View>
  </>);
}

function BackPanel({ entry, panelW, panelH, pos, compName, qr, logoMode, logoDataUrl, qrSize, strings, compact = false }: {
  entry: NametTagEntry; panelW: number; panelH: number;
  pos: { left: number; top: number }; compName: string;
  qr: QrConfig;
  logoMode: NametTagLogoMode; logoDataUrl: string | null; qrSize: number;
  strings: NametTagStrings;
  compact?: boolean;
}) {
  return (
    <PanelFrame pos={pos} panelW={panelW} panelH={panelH}>
      <PanelTop entry={entry} panelW={panelW} compName={compName} titleText={entry.titleBack} logoMode={logoMode} logoDataUrl={logoDataUrl} compact={compact} showEvents={eventIconsVisible({ isQrSide: true, compact })} />
      <QrSection entry={entry} qr={qr} qrSize={qrSize} strings={strings} compact={compact} wcaId={entry.wcaId} />
    </PanelFrame>
  );
}

const s = StyleSheet.create({
  panel: {
    border: `${NAMETAG_PANEL_BORDER}pt solid black`, borderRadius: 6,
    paddingHorizontal: NAMETAG_PANEL_PAD, paddingTop: C.padTop, paddingBottom: C.padBottom,
    fontFamily: FONT, overflow: 'hidden', backgroundColor: '#ffffff',
    flexDirection: 'column',
  },
  logoHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 3, gap: 6 },
  logoSmall:  { width: 20, height: 20, objectFit: 'contain' },
  logoLarge:  { height: 28, objectFit: 'contain', alignSelf: 'center', marginBottom: 4 },
  compName:   { fontSize: 8.5, textAlign: 'center', color: '#333', marginBottom: 4, fontFamily: FONT },
  name:       { textAlign: 'center', fontFamily: FONT, marginBottom: 6 },
  badge:      { borderRadius: 2, height: 22, justifyContent: 'center', marginBottom: 4 },
  badgeText:  { fontSize: 13, textAlign: 'center', fontFamily: FONT_BOLD },
  iconsRow:   { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginTop: 5, marginBottom: 3 },
  wcaId:      { fontSize: 13, textAlign: 'center', marginBottom: 4, color: '#222', fontFamily: FONT },
  dutiesSection: { flexDirection: 'column', flex: 1 },
  dutyRow:    { flexDirection: 'row', alignItems: 'flex-start' },
  dutyLabel:  { fontFamily: FONT_BOLD, width: 46, flexShrink: 0 },
  qrSection:  { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14 },
  qrCol:      { flexDirection: 'column', alignItems: 'center' },
  qrLabel:    { fontSize: C.labelFs, textAlign: 'center', color: '#444', marginTop: C.labelGap },
});

// Horizontal overrides, from the table the QR budget adds up.
const sc = StyleSheet.create({
  compName:   { fontSize: C.compNameFs, marginBottom: C.gap },
  name:       { marginBottom: C.gap },
  logoSmall:  { width: C.logoSmall, height: C.logoSmall },
  logoLarge:  { height: C.logoLarge, marginBottom: C.gap },
  badge:      { height: C.badgeH, marginBottom: 0 },
  badgeText:  { fontSize: C.badgeFs },
  iconsRow:   { marginTop: C.gap, marginBottom: 1 },
  idSlot:     { flex: 1, justifyContent: 'center', paddingVertical: C.idClear },
  wcaId:      { fontSize: C.idFs, textAlign: 'center', color: '#222', fontFamily: FONT },
  qrRow:      { flexShrink: 0, flexDirection: 'row', justifyContent: 'center' },
  qrCol:      { width: C.qrPitch },
});

interface Props {
  nametags: NametTagEntry[];
  settings: CompetitionSettings;
}

export function NametTagDocument({ nametags, settings }: Props) {
  const layout: NametTagLayout = settings.nametagLayout ?? 'vertical';
  const horizontal = layout === 'horizontal';
  const { competitionId, competitionName, nametagLogoMode, nametagQrMode } = settings;
  const qr: QrConfig = {
    mode: settings.liveResultsMode,
    competitionId,
    wcaLiveId: settings.wcaLiveId,
    wcaLivePersonIds: settings.wcaLivePersonIds,
  };

  // A custom logo wins; otherwise the bundled SCC one, when enabled.
  const logoDataUrl = resolveLogo(settings);
  const logoMode: NametTagLogoMode = logoDataUrl ? nametagLogoMode : 'hidden';
  const qrBothSides = nametagQrMode === 'both-sides';
  const nametTagStrings = getNametTagStrings(settings.language);
  // The back is printed in the secondary language, like its title.
  const backStrings = getNametTagStrings(settings.secondaryLanguage ?? settings.language);

  const personsPerPage = NAMETAGS_PER_PAGE;

  if (horizontal) {
    // Portrait page, 2 cols x 4 rows. Each landscape slot fits directly, no rotation.
    const pos = nametagHPositions(settings.paperFormat);
    const { panelW, panelH } = NAMETAG_H;
    const qrSize = nametagCompactQrSize(logoMode);
    const pages: NametTagEntry[][] = [];
    for (let i = 0; i < nametags.length; i += personsPerPage) pages.push(nametags.slice(i, i + personsPerPage));
    return (
      <Document {...docMeta(competitionName, 'Name Tags')}>
        {pages.map((page, pi) => (
          <Page key={pi} size={settings.paperFormat} orientation="portrait" style={{ backgroundColor: '#ffffff' }}>
            {page.flatMap((entry, ei) => {
              const frontPos = pos[ei * 2];
              const backPos  = pos[ei * 2 + 1];
              if (!frontPos || !backPos) return [];
              return [
                <FrontPanel
                  key={`f${ei}`} entry={entry}
                  panelW={panelW} panelH={panelH} pos={frontPos}
                  compName={competitionName}
                  qr={qr}
                  logoMode={logoMode} logoDataUrl={logoDataUrl}
                  qrBothSides={qrBothSides} qrSize={qrSize}
                  nametTagStrings={nametTagStrings}
                  compact={true}
                />,
                <BackPanel
                  key={`b${ei}`} entry={entry}
                  panelW={panelW} panelH={panelH} pos={backPos}
                  compName={competitionName}
                  qr={qr}
                  logoMode={logoMode} logoDataUrl={logoDataUrl}
                  qrSize={qrSize} strings={backStrings}
                  compact={true}
                />,
              ];
            })}
          </Page>
        ))}
      </Document>
    );
  }

  // Vertical layout: landscape page, 4 cols × 2 rows.
  const cfg = NAMETAG_CONFIGS[settings.paperFormat];
  const pos = panelPositions(cfg);
  const { panelW, panelH } = cfg;
  const qrSize = logoMode === 'logo-only' ? 65 : 75;
  const pages: NametTagEntry[][] = [];
  for (let i = 0; i < nametags.length; i += personsPerPage) pages.push(nametags.slice(i, i + personsPerPage));

  return (
    <Document {...docMeta(competitionName, 'Name Tags')}>
      {pages.map((page, pi) => (
        <Page key={pi} size={settings.paperFormat} orientation="landscape" style={{ backgroundColor: '#ffffff' }}>
          {page.flatMap((entry, ei) => {
            const frontPos = pos[ei * 2];
            const backPos  = pos[ei * 2 + 1];
            if (!frontPos || !backPos) return [];
            return [
              <FrontPanel
                key={`f${ei}`} entry={entry}
                panelW={panelW} panelH={panelH} pos={frontPos}
                compName={competitionName}
                qr={qr}
                logoMode={logoMode} logoDataUrl={logoDataUrl}
                qrBothSides={qrBothSides} qrSize={qrSize}
                nametTagStrings={nametTagStrings}
                compact={false}
              />,
              <BackPanel
                key={`b${ei}`} entry={entry}
                panelW={panelW} panelH={panelH} pos={backPos}
                compName={competitionName}
                qr={qr}
                logoMode={logoMode} logoDataUrl={logoDataUrl}
                qrSize={qrSize} strings={backStrings}
                compact={false}
              />,
            ];
          })}
        </Page>
      ))}
    </Document>
  );
}
