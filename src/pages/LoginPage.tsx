import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { CLIENT_ID } from '../auth/wca';
import LanguageSelect from '../components/LanguageSelect';
import ThemeToggle from '../components/ThemeToggle';
import Logo from '../components/Logo';
import AboutDialog from '../components/AboutDialog';
import { APP_NAME } from '../brand';
import ui from '../styles/ui.module.css';
import s from './LoginPage.module.css';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login, authError } = useAuth();
  const [params] = useSearchParams();
  const missingClientId = !CLIENT_ID;
  // Raw OAuth codes mean nothing to an organizer, so only the distinction they can act on
  // survives: renewal gave up, versus the sign-in itself did not finish.
  const failure = authError ?? (params.get('error') ? 'sign_in_failed' : null);

  return (
    <div className={s.container}>
      <div className={s.card}>
        <div className={s.langRow}>
          <LanguageSelect />
          <ThemeToggle />
        </div>

        <img src="/compprint-icon.svg" alt="" width={64} height={64} className={s.icon} />
        <h1 className={s.title}>{APP_NAME}</h1>
        <p className={s.subtitle}>{t('login.subtitle')}</p>

        {failure && (
          <div role="alert" className={s.error}>
            {t(failure === 'session_expired' ? 'errors.session_expired' : 'errors.sign_in_failed')}
          </div>
        )}

        {missingClientId ? (
          <div className={s.warning}>
            <strong>{t('login.setup_required')}</strong>{' '}
            {t('login.setup_env_instruction', { key: 'VITE_WCA_CLIENT_ID' })}
            <br />
            <br />
            {t('login.setup_oauth_instruction')}{' '}
            <a href="https://www.worldcubeassociation.org/oauth/applications" target="_blank" rel="noreferrer">
              {t('login.setup_oauth_link')}
            </a>{' '}
            {t('login.setup_redirect_uri')} <code>{window.location.origin}/auth/callback</code>
          </div>
        ) : (
          <button className={ui.btnPrimary} onClick={login}>
            {t('login.sign_in_button')}
          </button>
        )}

        <div className={s.aboutRow}>
          <AboutDialog as="text" />
        </div>

        <div className={s.byline}>
          <span>{t('common.by_scc')}</span>
          <Logo className={s.logo} />
        </div>
      </div>
    </div>
  );
}
