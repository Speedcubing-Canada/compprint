import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowRight, CalendarClock, CalendarDays, ClipboardCheck, IdCard, Scissors, UserPlus, Users } from 'lucide-react';
import { guideSections, type GuideSection, type PdfJob } from '../lib/pdfJobs';
import { useIsMobile } from '../lib/useIsMobile';
import s from './PrintGuide.module.css';

type NoteSection = Exclude<GuideSection, 'scorecards'>;
const isNote = (x: GuideSection): x is NoteSection => x !== 'scorecards';

// The one-line sections: an icon and the string that explains what to do with that PDF.
// `satisfies` keeps the literal key types (so `t()` type-checks them) while still failing
// the build if a new GuideSection is added without a note here.
const NOTES = {
  schedule:       { icon: <CalendarDays size={16} strokeWidth={2} aria-hidden className={s.noteIcon} />,   key: 'generate.guide.schedule' },
  checking:       { icon: <ClipboardCheck size={16} strokeWidth={2} aria-hidden className={s.noteIcon} />, key: 'generate.guide.checking' },
  nametags:       { icon: <IdCard size={16} strokeWidth={2} aria-hidden className={s.noteIcon} />,         key: 'generate.guide.nametags' },
  'group-overview': { icon: <Users size={16} strokeWidth={2} aria-hidden className={s.noteIcon} />,       key: 'generate.guide.group_overview' },
  'venue-schedule': { icon: <CalendarClock size={16} strokeWidth={2} aria-hidden className={s.noteIcon} />, key: 'generate.guide.venue_schedule' },
  'first-timers': { icon: <UserPlus size={16} strokeWidth={2} aria-hidden className={s.noteIcon} />,       key: 'generate.guide.first_timers' },
} as const satisfies Record<NoteSection, { icon: React.ReactNode; key: string }>;

/**
 * The deck leaves `reorderQuadrants` already ordered, and cutting preserves that order only
 * if the four quadrant piles stay separate and are stacked 1-2-3-4. Organisers have re-sorted
 * a whole competition by hand for want of this card.
 */
export default function PrintGuide({ jobs, a6 = false }: { jobs: PdfJob[]; a6?: boolean }) {
  const { t } = useTranslation();
  const sections = guideSections(jobs);
  if (sections.length === 0) return null;

  const hasScorecards = sections.includes('scorecards');

  return (
    <section className={s.card}>
      <h3 className={s.title}>
        <Scissors size={18} strokeWidth={2} aria-hidden />
        {t('generate.guide.title')}
      </h3>

      {hasScorecards && a6 && <p className={s.callout}>{t('generate.guide.scorecards.a6_callout')}</p>}

      {hasScorecards && !a6 && (
        <>
          <p className={s.callout}>{t('generate.guide.scorecards.callout')}</p>
          <CutDiagram />
          <ol className={s.steps}>
            <li className={s.step}>{t('generate.guide.scorecards.steps.print')}</li>
            <li className={s.step}>{t('generate.guide.scorecards.steps.cut')}</li>
            <li className={s.step}>{t('generate.guide.scorecards.steps.stack')}</li>
            <li className={s.step}>{t('generate.guide.scorecards.steps.covers')}</li>
          </ol>
        </>
      )}

      <div className={hasScorecards ? `${s.notes} ${s.notesDivided}` : s.notes}>
        {sections.filter(isNote).map(section => (
          <p key={section} className={s.note}>
            {NOTES[section].icon}
            <span>{t(NOTES[section].key)}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

/** Sheet -> four piles -> one deck, in plain divs: the design-system guard forbids inline SVG. */
function CutDiagram() {
  const { t } = useTranslation();
  // A component swap, not a style: the flow turns vertical on a phone.
  const Arrow = useIsMobile() ? ArrowDown : ArrowRight;
  const arrow = <Arrow size={20} strokeWidth={2} aria-hidden className={s.arrow} />;

  return (
    <div className={s.diagram}>
      <figure className={s.stage}>
        <div className={s.sheet}>
          {[1, 2, 3, 4].map(n => <div key={n} className={s.quad}>{n}</div>)}
        </div>
        <figcaption className={s.caption}>{t('generate.guide.scorecards.diagram.sheet')}</figcaption>
      </figure>

      {arrow}

      <figure className={s.stage}>
        <div className={s.piles}>
          {[1, 2, 3, 4].map(n => <div key={n} className={s.pile}>{n}</div>)}
        </div>
        <figcaption className={s.caption}>{t('generate.guide.scorecards.diagram.piles')}</figcaption>
      </figure>

      {arrow}

      <figure className={s.stage}>
        <div className={s.deck}>
          {[1, 2, 3, 4].map(n => <div key={n} className={s.deckLayer}>{n}</div>)}
        </div>
        <figcaption className={s.caption}>{t('generate.guide.scorecards.diagram.deck')}</figcaption>
      </figure>
    </div>
  );
}
