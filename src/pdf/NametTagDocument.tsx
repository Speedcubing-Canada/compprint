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
  NAMETAGS_PER_PAGE, NAMETAG_CONFIGS, eventIconsVisible, liveQrTarget, nametagNameH,
  nametagTopSectionH as topSectionH,
  PDF_FONT as FONT, PDF_FONT_BOLD as FONT_BOLD,
} from './layoutConstants';
import './fontSetup';
import { nametagName, NAME_LINE_HEIGHT, NAMETAG_PANEL_BORDER, NAMETAG_PANEL_PAD } from './nameFit';


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
//   Cards are landscape (244x147pt LETTER = 86x52mm) and slot straight in, no rotation.
//   Sized for 90x55mm badge holders with ~2mm clearance per edge.

const CONFIGS = NAMETAG_CONFIGS;

// Both paper formats use the same card size: the badge holder dictates it, not the paper.
const H_CONFIGS = {
  LETTER: { panelW: 244, panelH: 147, margin: 15, gapH: 10, gapV: 10 },
  A4:     { panelW: 244, panelH: 147, margin: 15, gapH: 10, gapV: 10 },
} as const;

type PF = keyof typeof CONFIGS;

function panelPositions(cfg: { panelW: number; panelH: number; margin: number; gapH: number; gapV: number }, cols = 4, rows = 2) {
  const { panelW, panelH, margin, gapH, gapV } = cfg;
  const pos: { left: number; top: number }[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++)
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

// Each item is its own Text, so no dash artifacts.
function DutyLines({ duties, fontSize }: { duties: string[]; fontSize: number }) {
  const sorted = [...duties].sort();
  return (
    <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
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
function PanelTop({ entry, panelW, compName, titleText, logoMode, logoDataUrl, compact = false, showWcaId = true, showEvents = true }: {
  entry: NametTagEntry; panelW: number; compName: string; titleText: string;
  logoMode: NametTagLogoMode; logoDataUrl: string | null;
  compact?: boolean; showWcaId?: boolean; showEvents?: boolean;
}) {
  const { bg, fg } = badgeColors(entry.role);
  const name = nametagName(entry.name, panelW, nametagNameH(logoMode), compact);
  const iconSz = compact ? 9 : 12;
  // Compact tags top-pack with equal gaps on both sides, so the role badge lands at the same
  // Y on front and back and the two align across the pair. Event icons follow the badge, so
  // hiding them on the QR side does not move it.
  const compNameStyle = compact ? [s.compName, { fontSize: 7, marginBottom: 4 }] : s.compName;
  const nameStyle = compact ? [s.name, { fontSize: name.fontSize, marginBottom: 4 }] : [s.name, { fontSize: name.fontSize }];
  const badgeStyle = compact
    ? [s.badge, { backgroundColor: bg, marginBottom: 2 }]
    : [s.badge, { backgroundColor: bg }];

  return (
    <View style={{ height: topSectionH(logoMode, compact), flexDirection: 'column' }}>
      {logoMode === 'logo-only' && logoDataUrl ? (
        <Image src={logoDataUrl} style={s.logoLarge} />
      ) : logoMode === 'with-name' && logoDataUrl ? (
        <View style={s.logoHeaderRow}>
          <Image src={logoDataUrl} style={s.logoSmall} />
          <Text style={compNameStyle}>{compName}</Text>
        </View>
      ) : (
        <Text style={compNameStyle}>{compName}</Text>
      )}
      <Text style={[...nameStyle, { lineHeight: NAME_LINE_HEIGHT }]}>{name.text}</Text>
      {!compact && <View style={{ flex: 1 }} />}
      <View style={badgeStyle}>
        <Text style={[s.badgeText, { color: fg }]}>{titleText}</Text>
      </View>
      {showEvents && (
        <View style={[s.iconsRow, compact ? { marginTop: 2, marginBottom: 1 } : {}]}>
          {entry.events.map(evId =>
            EVENT_ICONS[evId]
              ? <Image key={evId} src={EVENT_ICONS[evId]} style={{ width: iconSz, height: iconSz, marginHorizontal: 1 }} />
              : null
          )}
        </View>
      )}
      {showWcaId && !compact && <Text style={s.wcaId}>{entry.wcaId || ' '}</Text>}
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

function QrSection({ entry, qr, qrSize, compact = false }: {
  entry: NametTagEntry; qr: QrConfig; qrSize: number; compact?: boolean;
}) {
  const cgComp = `https://www.competitiongroups.com/competitions/${qr.competitionId}`;
  const cgUrl = entry.blank || entry.staff ? cgComp : `${cgComp}/persons/${entry.registrantId}`;
  const live = liveQrTarget(qr, entry);

  return (
    <View style={[s.qrSection, compact ? { gap: 6 } : {}]}>
      <View style={s.qrCol}>
        <QrSvg url={cgUrl} size={qrSize} />
        <Text style={s.qrLabel}>competitiongroups.com</Text>
      </View>
      <View style={s.qrCol}>
        <QrSvg url={live.url} size={qrSize} />
        <Text style={s.qrLabel}>{live.label}</Text>
      </View>
    </View>
  );
}

// Positions one card in its grid slot; border, padding and content live on the inner View.
//   vertical   → content fills the slot upright (slotW===panelW, slotH===panelH).
//   horizontal → content is a landscape frame (panelW > panelH) rotated 90° about
//                its centre so its bounding box equals the portrait slot.
function PanelFrame({ pos, slotW, slotH, panelW, panelH, rotate, children }: {
  pos: { left: number; top: number }; slotW: number; slotH: number;
  panelW: number; panelH: number; rotate: boolean; children: ReactNode;
}) {
  if (!rotate) {
    return (
      <View style={[s.panel, { position: 'absolute', left: pos.left, top: pos.top, width: panelW, height: panelH }]}>
        {children}
      </View>
    );
  }
  return (
    <View style={{ position: 'absolute', left: pos.left, top: pos.top, width: slotW, height: slotH }}>
      <View style={[s.panel, {
        position: 'absolute',
        left: (slotW - panelW) / 2,
        top: (slotH - panelH) / 2,
        width: panelW, height: panelH,
        // react-pdf clips against the UN-rotated layout box, which would erase the rotated
        // card. Content is font-scaled to fit, so it renders unclipped. ('visible' is the
        // runtime default, just missing from react-pdf's types.)
        overflow: 'visible' as 'hidden',
        transform: 'rotate(90deg)',
      }]}>
        {children}
      </View>
    </View>
  );
}

function FrontPanel({ entry, panelW, panelH, slotW, slotH, rotate, pos, compName, qr, logoMode, logoDataUrl, qrBothSides, qrSize, nametTagStrings, compact = false }: {
  entry: NametTagEntry; panelW: number; panelH: number; slotW: number; slotH: number; rotate: boolean;
  pos: { left: number; top: number }; compName: string;
  qr: QrConfig;
  logoMode: NametTagLogoMode; logoDataUrl: string | null;
  qrBothSides: boolean; qrSize: number;
  nametTagStrings: NametTagStrings;
  compact?: boolean;
}) {
  const frame = (children: ReactNode) => (
    <PanelFrame pos={pos} slotW={slotW} slotH={slotH} panelW={panelW} panelH={panelH} rotate={rotate}>{children}</PanelFrame>
  );

  if (qrBothSides || entry.staff) {
    return frame(<>
      <PanelTop entry={entry} panelW={panelW} compName={compName} titleText={entry.titleFront} logoMode={logoMode} logoDataUrl={logoDataUrl} compact={compact} showWcaId={!compact} showEvents={eventIconsVisible({ isQrSide: true, compact })} />
      <QrSection entry={entry} qr={qr} qrSize={qrSize} compact={compact} />
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
  const lineH = dutyFs * 1.4;
  const estLines = rows.reduce((sum, r) => sum + Math.ceil(r.duties.length / 2), 0);
  const estH = (estLines + rows.length) * lineH;
  const spaceEvenly = estH < (panelH - topSectionH(logoMode, compact)) * 0.90;

  return frame(<>
    <PanelTop entry={entry} panelW={panelW} compName={compName} titleText={entry.titleFront} logoMode={logoMode} logoDataUrl={logoDataUrl} compact={compact} showWcaId={!compact} />
    <View style={[s.dutiesSection, spaceEvenly ? { justifyContent: 'space-evenly' } : {}]}>
      {rows.map(({ label, duties }) => (
        <View key={label} style={[s.dutyRow, spaceEvenly ? {} : { marginBottom: 3 }]}>
          <Text style={[s.dutyLabel, { fontSize: dutyFs }]}>{label}</Text>
          <DutyLines duties={duties} fontSize={dutyFs} />
        </View>
      ))}
    </View>
  </>);
}

function BackPanel({ entry, panelW, panelH, slotW, slotH, rotate, pos, compName, qr, logoMode, logoDataUrl, qrSize, compact = false }: {
  entry: NametTagEntry; panelW: number; panelH: number; slotW: number; slotH: number; rotate: boolean;
  pos: { left: number; top: number }; compName: string;
  qr: QrConfig;
  logoMode: NametTagLogoMode; logoDataUrl: string | null; qrSize: number;
  compact?: boolean;
}) {
  return (
    <PanelFrame pos={pos} slotW={slotW} slotH={slotH} panelW={panelW} panelH={panelH} rotate={rotate}>
      <PanelTop entry={entry} panelW={panelW} compName={compName} titleText={entry.titleBack} logoMode={logoMode} logoDataUrl={logoDataUrl} compact={compact} showEvents={eventIconsVisible({ isQrSide: true, compact })} />
      {compact && <Text style={[s.wcaId, { marginTop: 2, marginBottom: 2 }]}>{entry.wcaId || ' '}</Text>}
      <QrSection entry={entry} qr={qr} qrSize={qrSize} compact={compact} />
    </PanelFrame>
  );
}

const s = StyleSheet.create({
  panel: {
    border: `${NAMETAG_PANEL_BORDER}pt solid black`, borderRadius: 6,
    paddingHorizontal: NAMETAG_PANEL_PAD, paddingTop: 7, paddingBottom: 6,
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
  iconsRow:   { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 6, marginBottom: 4 },
  wcaId:      { fontSize: 13, textAlign: 'center', marginBottom: 4, color: '#222', fontFamily: FONT },
  dutiesSection: { flexDirection: 'column', flex: 1 },
  dutyRow:    { flexDirection: 'row', alignItems: 'flex-start' },
  dutyLabel:  { fontFamily: FONT_BOLD, width: 46, flexShrink: 0 },
  qrSection:  { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 14 },
  qrCol:      { flexDirection: 'column', alignItems: 'center' },
  qrLabel:    { fontSize: 6, textAlign: 'center', color: '#444', marginTop: 4, maxWidth: 80 },
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

  const personsPerPage = NAMETAGS_PER_PAGE;

  if (horizontal) {
    // Portrait page, 2 cols x 4 rows. Each landscape slot fits directly, no rotation.
    const hcfg = H_CONFIGS[settings.paperFormat as PF] ?? H_CONFIGS.LETTER;
    const pos = panelPositions(hcfg, 2, 4);
    const { panelW, panelH } = hcfg;
    const qrSize = logoMode === 'logo-only' ? 35 : 40;
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
                  panelW={panelW} panelH={panelH} slotW={panelW} slotH={panelH} rotate={false} pos={frontPos}
                  compName={competitionName}
                  qr={qr}
                  logoMode={logoMode} logoDataUrl={logoDataUrl}
                  qrBothSides={qrBothSides} qrSize={qrSize}
                  nametTagStrings={nametTagStrings}
                  compact={true}
                />,
                <BackPanel
                  key={`b${ei}`} entry={entry}
                  panelW={panelW} panelH={panelH} slotW={panelW} slotH={panelH} rotate={false} pos={backPos}
                  compName={competitionName}
                  qr={qr}
                  logoMode={logoMode} logoDataUrl={logoDataUrl}
                  qrSize={qrSize}
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
  const cfg = CONFIGS[settings.paperFormat as PF] ?? CONFIGS.LETTER;
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
                panelW={panelW} panelH={panelH} slotW={panelW} slotH={panelH} rotate={false} pos={frontPos}
                compName={competitionName}
                qr={qr}
                logoMode={logoMode} logoDataUrl={logoDataUrl}
                qrBothSides={qrBothSides} qrSize={qrSize}
                nametTagStrings={nametTagStrings}
                compact={false}
              />,
              <BackPanel
                key={`b${ei}`} entry={entry}
                panelW={panelW} panelH={panelH} slotW={panelW} slotH={panelH} rotate={false} pos={backPos}
                compName={competitionName}
                qr={qr}
                logoMode={logoMode} logoDataUrl={logoDataUrl}
                qrSize={qrSize}
                compact={false}
              />,
            ];
          })}
        </Page>
      ))}
    </Document>
  );
}
