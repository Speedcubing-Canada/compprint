import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StaffCsvLine } from '../types/settings';
import { matchStaff, parseStaffCsv } from '../lib/parseStaffCsv';
import { getCachedWcif } from '../lib/wcifCache';
import CsvFileField from '../components/CsvFileField';
import WarningBanner from '../components/WarningBanner';
import ui from '../styles/ui.module.css';
import s from './SettingsPage.module.css';

// fileName: null = no file loaded.
export default function StaffCsvSection({ competitionId, lines, staffNametags, fileName, onChange }: {
  competitionId: string; lines: StaffCsvLine[]; staffNametags: boolean; fileName: string | null;
  onChange: (lines: StaffCsvLine[], fileName: string | null) => void;
}) {
  const { t } = useTranslation();
  const [emptyFile, setEmptyFile] = useState<string | null>(null);
  // The WCIF is cached by the scope step; after a hard reload only the count shows.
  const wcif = lines.length > 0 ? getCachedWcif(competitionId) : undefined;
  const match = wcif ? matchStaff(wcif.persons, lines, staffNametags) : null;
  const warnings = ([
    ['settings.nametag.staff_csv_empty', emptyFile ? [emptyFile] : []],
    ['settings.nametag.staff_csv_officials', match?.officials ?? []],
    ['settings.nametag.staff_csv_unmatched', match?.unmatched ?? []],
    ['settings.nametag.staff_csv_ambiguous', match?.ambiguous ?? []],
  ] as const).filter(([, names]) => names.length > 0);

  return (
    <>
      <div className={s.subheading}>{t('settings.nametag.staff_csv_title')}</div>
      <p className={ui.hint}>{t('settings.nametag.staff_csv_hint')}</p>
      <CsvFileField
        name="staffCsv"
        fileName={fileName}
        countLabel={lines.length > 0 ? t('settings.nametag.staff_csv_count', { count: lines.length }) : null}
        onText={(text, file) => {
          const parsed = parseStaffCsv(text);
          setEmptyFile(parsed.length ? null : file);
          onChange(parsed, parsed.length ? file : null);
        }}
        onClear={() => { setEmptyFile(null); onChange([], null); }}
      />
      {warnings.length > 0 && (
        <div className={s.warningWrap}>
          {warnings.map(([key, names]) => (
            <WarningBanner key={key}>{t(key, { names: names.join(', ') })}</WarningBanner>
          ))}
        </div>
      )}
    </>
  );
}
