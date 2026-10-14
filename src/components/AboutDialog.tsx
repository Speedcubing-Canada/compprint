import { useState } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import Tooltip from './Tooltip';
import { PRIVACY_POLICY_URL, REPO_URL, SUPPORT_EMAIL } from './ContactLinks';
import { isOptedOut, setOptedOut } from '../lib/analytics';
import ui from '../styles/ui.module.css';
import s from './AboutDialog.module.css';

/**
 * "About this tool" explainer: a circular "i" button (or a text link when `as="text"`)
 * opening a modal on what the tool is, what a WCIF is, and where both sit in the
 * competition workflow. Self-contained open state, so it drops onto any page.
 */
export default function AboutDialog({ as = 'icon' }: { as?: 'icon' | 'text' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [optedOut, setOptOut] = useState(isOptedOut);

  return (
    <>
      {as === 'text' ? (
        <button className={s.textTrigger} onClick={() => setOpen(true)}>
          {t('about.trigger')}
        </button>
      ) : (
        <Tooltip label={t('about.trigger')} placement="bottom">
          <button className={ui.iconBtn} aria-label={t('about.trigger')} onClick={() => setOpen(true)}>
            <Info size={18} strokeWidth={2} />
          </button>
        </Tooltip>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={t('about.title')}>
        <p className={ui.dialogBody}>{t('about.intro')}</p>

        <h3 className={s.section}>{t('about.wcif_title')}</h3>
        <p className={ui.dialogBody}>{t('about.wcif_body')}</p>

        <h3 className={s.section}>{t('about.workflow_title')}</h3>
        <p className={ui.dialogBody}>{t('about.workflow_body')}</p>

        <h3 className={s.section}>{t('about.privacy_title')}</h3>
        <p className={ui.dialogBody}>{t('about.privacy_body')}</p>
        <p className={s.links}>
          <a className={s.link} href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">
            {t('about.privacy_link')}
          </a>
        </p>

        <label className={`${ui.toggleCard} ${optedOut ? ui.toggleCardActive : ''} ${s.optOut}`}>
          <input
            type="checkbox"
            checked={optedOut}
            onChange={e => { setOptOut(e.target.checked); setOptedOut(e.target.checked); }}
            className={ui.radio}
          />
          <div className={s.optOutLabel}>{t('about.privacy_optout')}</div>
        </label>

        {/* The login page has no Header, so this is the only place a signed-out
            organizer can find where to send a bug report. */}
        <h3 className={s.section}>{t('about.feedback_title')}</h3>
        <p className={ui.dialogBody}>{t('about.feedback_body')}</p>
        <p className={s.links}>
          <a className={s.link} href={REPO_URL} target="_blank" rel="noopener noreferrer">
            {REPO_URL.replace('https://', '')}
          </a>
          <a className={s.link} href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>

        <button className={ui.dialogClose} onClick={() => setOpen(false)}>{t('about.close')}</button>
      </Modal>
    </>
  );
}
