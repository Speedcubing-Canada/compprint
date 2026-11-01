import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { CustomEvent } from '../types/settings';
import Header from '../components/Header';
import CustomEventEditor from '../components/CustomEventEditor';
import {
  readCompetition, readCustomEvents, readIsCustom,
  writeCompetition, writeCustom, writeHasGroups, writeScope,
} from '../lib/flowState';
import ui from '../styles/ui.module.css';
import s from './CustomCompetitionPage.module.css';

// Turn the competition name into a filename-safe id ("custom_" prefix marks the
// flow downstream). Non-ASCII-only names fall back to a fixed id.
function customCompetitionId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return slug ? `custom_${slug}` : 'custom_competition';
}

/**
 * Builder page for custom (non-WCA) competitions: name the competition and
 * define events manually. Skips /scope (there is no WCIF) and hands off to
 * /settings with the same sessionStorage contract the WCA flow uses, plus the
 * custom_competition flag that hides WCA-only settings.
 */
export default function CustomCompetitionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Survive back-navigation from /settings: reload whatever was entered before.
  const [name, setName] = useState(() => (readIsCustom() ? readCompetition().name : ''));
  const [events, setEvents] = useState<CustomEvent[]>(readCustomEvents);

  const canContinue = name.trim() !== '' && events.some(e => e.name.trim() !== '');

  function handleContinue() {
    const trimmed = name.trim();
    writeCompetition(customCompetitionId(trimmed), trimmed);
    // No WCIF ⇒ no group detection; `true` suppresses the no-groups warning.
    writeHasGroups(true);
    // Custom competitions have only their own events: no schedule, name tags or slips,
    // and no Round 2 to choose a mode for.
    writeScope(
      {
        mode: 'everything',
        documents: { scorecards: true, scheduleTracker: false, nametags: false, roundChecklist: false, firstTimerSlips: false, groupOverview: false, venueSchedule: false },
      },
      { showSecondRoundMode: false, multiStage: false, detectedStations: null },
    );
    writeCustom(events.filter(e => e.name.trim() !== ''));
    navigate('/settings');
  }

  return (
    <div className={ui.page}>
      <Header showBack onBack={() => navigate('/competitions')} showSignOut />

      <main id="main" className={`${ui.main} ${s.main}`}>
        <h1 className={s.heading}>{t('custom.heading')}</h1>
        <p className={s.hint}>{t('custom.hint')}</p>

        <section className={s.section}>
          <h3 className={ui.sectionHeading}>{t('custom.name_label')}</h3>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('custom.name_placeholder')}
            className={ui.textInput}
            autoComplete="off"
            aria-label={t('custom.name_label')}
          />
        </section>

        <section className={s.section}>
          <h3 className={ui.sectionHeading}>{t('custom.events_title')}</h3>
          <CustomEventEditor events={events} onChange={setEvents} />
        </section>

        <div className={ui.stickyFooter}>
          <button
            className={ui.btnCta}
            disabled={!canContinue}
            onClick={handleContinue}
          >
            {t('custom.continue')}
          </button>
        </div>
      </main>
    </div>
  );
}
