import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { decodeText } from '../lib/csv';
import ui from '../styles/ui.module.css';

export default function CsvFileField({ name, loaded, onText, onClear }: {
  name: string; loaded: { fileName: string; count: string } | null;
  onText: (text: string, fileName: string) => void; onClear: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      {loaded ? (
        <div className={ui.filePreview}>
          <div className={ui.fileMeta}>
            <span className={ui.fileName}>{loaded.fileName}</span>
            <span className={ui.optionDesc}>{loaded.count}</span>
            <button className={ui.removeBtn} onClick={onClear}>{t('common.remove')}</button>
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
        onChange={e => {
          const file = e.target.files?.[0];
          // Cleared so picking the same file again, once fixed, still fires a change.
          e.target.value = '';
          if (file) void file.arrayBuffer().then(decodeText).then(text => onText(text, file.name));
        }}
      />
    </>
  );
}
