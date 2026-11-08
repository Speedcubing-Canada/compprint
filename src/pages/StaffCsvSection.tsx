import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StaffCsvLine } from '../types/settings';
import type { WCIF } from '../types/wcif';
import { matchStaff, parseStaffCsv } from '../lib/staffCsv';
import { getCachedWcif, setCachedWcif } from '../lib/wcifCache';
import { fetchWcif } from '../auth/wca';
import { useAuth } from '../auth/useAuth';
import CsvFileField from '../components/CsvFileField';
import WarningBanner from '../components/WarningBanner';
import ui from '../styles/ui.module.css';
import s from './SettingsPage.module.css';

export default function StaffCsvSection({ competitionId, lines, staffNametags, fileName, onChange }: {
  competitionId: string; lines: StaffCsvLine[]; staffNametags: boolean; fileName: string | null;
  onChange: (lines: StaffCsvLine[], fileName: string | null) => void;
}) {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [emptyFile, setEmptyFile] = useState<string | null>(null);
  const [wcif, setWcif] = useState<WCIF | undefined>(() => getCachedWcif(competitionId));
  const needsWcif = lines.length > 0 && !wcif;
  useEffect(() => {
    if (!needsWcif || !token) return;
    let cancelled = false;
    // ponytail: a failed fetch only hides the warnings; generating fetches again and reports it.
    fetchWcif(competitionId, token.access_token).then(w => {
      setCachedWcif(competitionId, w);
      if (!cancelled) setWcif(w);
    }, () => {});
    return () => { cancelled = true; };
  }, [needsWcif, competitionId, token]);

  const match = wcif && lines.length > 0 ? matchStaff(wcif.persons, lines, staffNametags) : null;
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
        loaded={lines.length > 0 ? { fileName: fileName ?? '', count: t('settings.nametag.staff_csv_count', { count: lines.length }) } : null}
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
