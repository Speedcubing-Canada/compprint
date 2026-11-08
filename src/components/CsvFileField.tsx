import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { readTextFile } from '../lib/decodeText';
import ui from '../styles/ui.module.css';
import s from '../pages/SettingsPage.module.css';

// The loaded file's name and count, else a picker.
export default function CsvFileField({ name, fileName, countLabel, onText, onClear }: {
  name: string; fileName: string | null; countLabel: string | null;
  onText: (text: string, fileName: string) => void; onClear: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      {countLabel ? (
        <div className={s.logoPreview}>
          <div className={s.logoMeta}>
            <span className={s.logoName}>{fileName}</span>
            <span className={ui.optionDesc}>{countLabel}</span>
            <button className={s.removeBtn} onClick={() => { onClear(); if (ref.current) ref.current.value = ''; }}>{t('common.remove')}</button>
          </div>
        </div>
      ) : (
        <button className={ui.dropzone} onClick={() => ref.current?.click()}>{t('common.choose_file')}</button>
      )}
      <input
        ref={ref}
        name={name}
        type="file"
        accept=".csv,text/csv,text/plain"
        hidden
        onChange={e => { const file = e.target.files?.[0]; if (file) readTextFile(file, text => onText(text, file.name)); }}
      />
    </>
  );
}
