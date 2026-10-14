import { Mail } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from './Tooltip';
import ui from '../styles/ui.module.css';

/** Where bug reports and feedback go. Imported, never re-typed - see contact-links.test.ts. */
export const REPO_URL = 'https://github.com/Speedcubing-Canada/scorecards-v2';
export const SUPPORT_EMAIL = 'software@speedcubingcanada.org';
/** In public/, synced by docs-speedcubing-canada CI from public/src/scorecards-privacy-policy.md. */
export const PRIVACY_POLICY_URL = '/scorecards-privacy-policy.pdf';

/**
 * The only way an organizer can reach us, so it sits in the header on every signed-in page;
 * AboutDialog carries the same two links as text for the signed-out one.
 *
 * An <img>, not a lucide icon: lucide 1.x dropped brand icons and design-system.test.ts forbids
 * inline SVG. ponytail: one grey mark for both themes; if it reads washed out, split it into
 * light/dark files and switch on useTheme() the way Logo.tsx does.
 */
export default function ContactLinks() {
  const { t } = useTranslation();

  return (
    <>
      <Tooltip label={t('contact.github')} placement="bottom">
        <a
          className={ui.iconBtn}
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('contact.github')}
        >
          <img src="/github-mark.svg" alt="" width={18} height={18} />
        </a>
      </Tooltip>

      <Tooltip label={t('contact.email')} placement="bottom">
        <a className={ui.iconBtn} href={`mailto:${SUPPORT_EMAIL}`} aria-label={t('contact.email')}>
          <Mail size={18} strokeWidth={2} />
        </a>
      </Tooltip>
    </>
  );
}
