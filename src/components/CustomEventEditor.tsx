import { useRef, useState, type ChangeEvent } from 'react';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CustomEvent, CustomEventFormat } from '../types/settings';
import { EVENT_ICONS } from '../assets/events';
import { readTextFile } from '../lib/csv';
import { parseCompetitorCsv } from '../lib/parseCompetitorCsv';
import Tooltip from './Tooltip';
import ui from '../styles/ui.module.css';
import s from './CustomEventEditor.module.css';

const WCA_EVENT_LABELS: Record<string, string> = {
  '222': '2×2', '333': '3×3', '444': '4×4', '555': '5×5',
  '666': '6×6', '777': '7×7', '333bf': '3BLD', '333fm': 'FMC',
  '333oh': 'OH', 'clock': 'Clock', 'minx': 'Mega', 'pyram': 'Pyra',
  'skewb': 'Skewb', 'sq1': 'SQ1', 'fto': 'FTO', '444bf': '4BLD', '555bf': '5BLD',
  '333mbf': 'MBLD',
};

const FORMAT_OPTIONS: CustomEventFormat[] = ['avg5', 'mo3', 'bo3', 'bo2', 'bo1'];
// bo2/bo1 have no post-cutoff phase, so the cutoff input is hidden (and cleared).
const NO_CUTOFF_FORMATS: CustomEventFormat[] = ['bo2', 'bo1'];

/**
 * Editable list of custom events: name, icon, format, cutoff, time limit,
 * optional round label and optional competitor CSV. Used by the Settings page
 * (Advanced section) and by the custom-competition builder page.
 */
export default function CustomEventEditor({
  events,
  onChange,
}: {
  events: CustomEvent[];
  onChange: (events: CustomEvent[]) => void;
}) {
  const { t } = useTranslation();
  const iconRefs = useRef<(HTMLInputElement | null)[]>([]);
  const csvRefs = useRef<(HTMLInputElement | null)[]>([]);
  // CSV file names are display-only; they don't belong in CompetitionSettings.
  const [csvNames, setCsvNames] = useState<Record<number, string>>({});

  function update(i: number, patch: Partial<CustomEvent>) {
    onChange(events.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }

  function addEvent() {
    onChange([...events, { name: '', iconDataUrl: null, format: 'avg5', cutoff: '', limit: '' }]);
  }

  function removeEvent(i: number) {
    onChange(events.filter((_, idx) => idx !== i));
    iconRefs.current.splice(i, 1);
    csvRefs.current.splice(i, 1);
    setCsvNames(prev => {
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        const idx = Number(k);
        if (idx < i) next[idx] = v;
        else if (idx > i) next[idx - 1] = v;
      }
      return next;
    });
  }

  function setFormat(i: number, format: CustomEventFormat) {
    update(i, NO_CUTOFF_FORMATS.includes(format) ? { format, cutoff: '' } : { format });
  }

  function handleIconUpload(i: number, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update(i, { iconDataUrl: reader.result as string });
    reader.readAsDataURL(file);
  }

  function handleCsvUpload(i: number, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    readTextFile(file, text => {
      update(i, { competitors: parseCompetitorCsv(text) });
      setCsvNames(prev => ({ ...prev, [i]: file.name }));
    });
  }

  function removeCsv(i: number) {
    update(i, { competitors: undefined });
    setCsvNames(prev => {
      const next = { ...prev };
      delete next[i];
      return next;
    });
    const input = csvRefs.current[i];
    if (input) input.value = '';
  }

  return (
    <div>
      {events.map((custom, i) => (
        <div key={i} className={s.card}>
          <div className={s.header}>
            <input
              type="text"
              placeholder={t('settings.advanced.event_name_placeholder')}
              value={custom.name}
              onChange={e => update(i, { name: e.target.value })}
              className={ui.textInput}
              autoComplete="off"
              aria-label={t('settings.advanced.event_name_placeholder')}
            />
            <button className={s.removeBtn} onClick={() => removeEvent(i)}>{t('common.remove')}</button>
          </div>

          <div className={s.formatRow}>
            <span className={s.formatLabel}>{t('settings.advanced.format_label')}</span>
            {FORMAT_OPTIONS.map(fmt => (
              <label key={fmt} className={s.formatOption}>
                <input
                  type="radio"
                  checked={custom.format === fmt}
                  onChange={() => setFormat(i, fmt)}
                />
                {t(`settings.advanced.${fmt}`)}
              </label>
            ))}
          </div>

          <div className={s.fieldRow}>
            {!NO_CUTOFF_FORMATS.includes(custom.format) && (
              <div className={s.field}>
                <div className={s.fieldLabel}>
                  {t('settings.advanced.cutoff_label')}{' '}
                  <span className={s.optionalNote}>({t('settings.advanced.cutoff_optional')})</span>
                </div>
                <input
                  type="text"
                  placeholder="M:SS"
                  value={custom.cutoff}
                  onChange={e => update(i, { cutoff: e.target.value })}
                  className={`${ui.textInput} ${s.smallInput}`}
                  autoComplete="off"
                  aria-label={t('settings.advanced.cutoff_label')}
                />
              </div>
            )}
            <div className={s.field}>
              <div className={s.fieldLabel}>
                {t('settings.advanced.time_limit_label')}{' '}
                <span className={s.optionalNote}>({t('settings.advanced.time_limit_optional')})</span>
              </div>
              <input
                type="text"
                placeholder="M:SS"
                value={custom.limit}
                onChange={e => update(i, { limit: e.target.value })}
                className={`${ui.textInput} ${s.smallInput}`}
                  autoComplete="off"
                aria-label={t('settings.advanced.time_limit_label')}
              />
            </div>
            <div className={s.field}>
              <div className={s.fieldLabel}>
                {t('settings.advanced.round_label')}{' '}
                <span className={s.optionalNote}>({t('settings.advanced.round_label_optional')})</span>
              </div>
              <input
                type="text"
                placeholder={t('settings.advanced.round_label_placeholder')}
                value={custom.roundLabel ?? ''}
                onChange={e => update(i, { roundLabel: e.target.value })}
                className={`${ui.textInput} ${s.smallInput}`}
                  autoComplete="off"
                aria-label={t('settings.advanced.round_label')}
              />
            </div>
          </div>

          <div className={s.block}>
            <div className={s.blockLabel}>
              {t('settings.advanced.icon_hint')}
              {custom.iconDataUrl && (
                <button className={s.removeBtn} onClick={() => update(i, { iconDataUrl: null })}>
                  {t('common.clear')}
                </button>
              )}
            </div>
            <div className={s.iconGrid}>
              {Object.entries(EVENT_ICONS).map(([id, dataUrl]) => (
                <button
                  key={id}
                  type="button"
                  title={WCA_EVENT_LABELS[id] ?? id}
                  aria-pressed={custom.iconDataUrl === dataUrl}
                  onClick={() => update(i, { iconDataUrl: custom.iconDataUrl === dataUrl ? null : dataUrl })}
                  className={`${s.iconBtn} ${custom.iconDataUrl === dataUrl ? s.iconBtnActive : ''}`}
                >
                  <img src={dataUrl} alt="" width={20} height={20} />
                  <span className={s.iconLabel}>{WCA_EVENT_LABELS[id] ?? id}</span>
                </button>
              ))}
              <Tooltip label={t('settings.advanced.icon_hint')}>
                <button
                  type="button"
                  aria-label={t('common.upload')}
                  className={`${s.iconBtn} ${custom.iconDataUrl && !Object.values(EVENT_ICONS).includes(custom.iconDataUrl) ? s.iconBtnActive : ''}`}
                  onClick={() => iconRefs.current[i]?.click()}
                >
                  <Upload size={18} strokeWidth={2} aria-hidden />
                  <span className={s.iconLabel}>{t('common.upload')}</span>
                </button>
              </Tooltip>
            </div>
            <input
              ref={el => { iconRefs.current[i] = el; }}
              type="file"
              accept="image/*"
              hidden
              onChange={e => handleIconUpload(i, e)}
            />
          </div>

          {custom.iconDataUrl && (
            <div className={s.selectedIcon}>
              <img src={custom.iconDataUrl} alt="" width={28} height={28} className={s.selectedIconImg} />
              <span className={s.selectedIconText}>{t('settings.advanced.icon_selected')}</span>
            </div>
          )}

          <div className={s.block}>
            <div className={s.blockLabel}>
              {t('settings.advanced.csv_label')}{' '}
              <span className={s.optionalNote}>({t('settings.advanced.csv_optional')})</span>
            </div>
            {custom.competitors && custom.competitors.length > 0 ? (
              <div className={s.csvPreview}>
                <span className={s.csvName}>{csvNames[i] ?? t('settings.advanced.csv_label')}</span>
                <span className={s.csvCount}>{t('settings.advanced.csv_count', { count: custom.competitors.length })}</span>
                <button className={s.removeBtn} onClick={() => removeCsv(i)}>{t('common.remove')}</button>
              </div>
            ) : (
              <>
                <p className={s.csvHint}>{t('settings.advanced.csv_hint')}</p>
                <button className={s.csvUploadBtn} onClick={() => csvRefs.current[i]?.click()}>
                  {t('common.choose_file')}
                </button>
              </>
            )}
            <input
              ref={el => { csvRefs.current[i] = el; }}
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              onChange={e => handleCsvUpload(i, e)}
            />
          </div>
        </div>
      ))}

      <button className={s.addCustomBtn} onClick={addEvent}>
        {t('settings.advanced.add_custom_event')}
      </button>
    </div>
  );
}
