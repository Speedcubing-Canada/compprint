import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { fetchErrorKey, fetchManagedCompetitions, isExpired } from '../auth/wca';
import type { WCACompetition } from '../types/wcif';
import Header from '../components/Header';
import AboutDialog from '../components/AboutDialog';
import Skeleton from '../components/Skeleton';
import { formatCompetitionDate, visibleCompetitions } from '../lib/competitionList';
import { clearCustom, clearDownstream, readCompetition, readIsCustom, writeCompetition } from '../lib/flowState';
import { clearPresetSettings } from '../presets';
import ui from '../styles/ui.module.css';
import s from './CompetitionPickerPage.module.css';

export default function CompetitionPickerPage() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [competitions, setCompetitions] = useState<WCACompetition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  function retry() {
    setError(null);
    setIsLoading(true);
    setAttempt((n) => n + 1);
  }

  useEffect(() => {
    // An expired token is already being renewed: hold the skeleton rather than spend the
    // request on a guaranteed 401. The fresh token re-runs this effect.
    if (!token || isExpired(token)) return;
    let cancelled = false;

    fetchManagedCompetitions(token.access_token)
      .then((data) => {
        if (cancelled) return;
        // Past competitions are kept in dev: off-season they are the only real WCIF to test with.
        setCompetitions(
          visibleCompetitions(data, new Date().toLocaleDateString('en-CA'), import.meta.env.DEV)
        );
        // A renewal re-runs this with a fresh token: drop the error the dead one produced.
        setError(null);
      })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [token, attempt]);

  function startCustom() {
    clearPresetSettings();
    // Coming from a WCA competition is a switch too; a custom one is kept for back-navigation.
    if (!readIsCustom()) clearDownstream();
    navigate('/custom');
  }

  function selectCompetition(comp: WCACompetition) {
    // Drop any stale custom-competition state so it never leaks into a WCA flow.
    clearCustom();
    // A different competition starts over: the later steps restore what was picked before, and
    // must not hand the previous competition's scope, rounds and settings to this one.
    if (readCompetition().id !== comp.id) {
      clearDownstream();
      clearPresetSettings();
    }
    writeCompetition(comp.id, comp.name);
    navigate('/scope');
  }

  return (
    <div className={ui.page}>
      <Header showUser showSignOut />

      <main id="main" className={`${ui.main} ${s.main}`}>
        <div className={s.headingRow}>
          <h1 className={ui.pageTitle}>{t('picker.heading')}</h1>
          <AboutDialog />
        </div>
        <p className={s.hint}>{t('picker.hint')}</p>

        {isLoading && (
          <div role="status" aria-label={t('picker.loading')} className={s.grid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={s.compCard}>
                <Skeleton width="75%" height={16} />
                <Skeleton width="50%" height={13} />
              </div>
            ))}
          </div>
        )}
        {error != null && (
          <div className={s.errorBox}>
            <p className={`${ui.status} ${s.errorText}`}>
              {t(fetchErrorKey(error) === 'errors.session_expired'
                ? 'errors.session_expired'
                : 'errors.competitions_failed')}
            </p>
            <button className={s.retryButton} onClick={retry}>
              {t('errors.retry')}
            </button>
          </div>
        )}

        {!isLoading && error == null && competitions.length === 0 && (
          <p className={ui.status}>{t('picker.empty')}</p>
        )}

        <div className={s.grid}>
          {competitions.map((comp) => (
            <button
              key={comp.id}
              className={s.compCard}
              onClick={() => selectCompetition(comp)}
            >
              <span className={s.compName}>{comp.name}</span>
              <span className={s.compMeta}>
                {comp.city} · {formatCompetitionDate(comp.start_date, comp.end_date)}
              </span>
            </button>
          ))}
        </div>

        {/* Niche flow: keep it discoverable but secondary, below the WCA list. It skips
            /scope, where a preset is otherwise re-written, so clear the seed on the way in. */}
        {!isLoading && (
          <button className={s.customCard} onClick={startCustom}>
            <span className={s.customCardTitle}>
              <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
              {t('picker.create_custom_title')}
            </span>
            <span className={s.compMeta}>{t('picker.create_custom_desc')}</span>
          </button>
        )}
      </main>
    </div>
  );
}
