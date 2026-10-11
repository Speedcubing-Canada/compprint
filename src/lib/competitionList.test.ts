import { describe, it, expect } from 'vitest';
import { formatCompetitionDate, visibleCompetitions } from './competitionList';
import type { WCACompetition } from '../types/wcif';

// The reporter's zone. formatCompetitionDate is only ever wrong away from UTC, so a
// UTC-default runner would pass on a broken build. Set at module scope rather than in a
// hook because Node re-reads TZ per Date, and nothing here builds one at import time.
process.env.TZ = 'America/Edmonton';

const TODAY = '2026-09-09';

function comp(id: string, start: string, end = start): WCACompetition {
  return { id, start_date: start, end_date: end } as WCACompetition;
}

const past = comp('Past2024', '2024-05-01');
const older = comp('Past2023', '2023-05-01');
const yesterday = comp('Yesterday', '2026-09-07', '2026-09-08');
const ongoing = comp('Ongoing', '2026-09-08', TODAY);
const soon = comp('Soon', '2026-10-01');
const later = comp('Later', '2027-01-01');
const all = [past, later, ongoing, soon, older, yesterday];

const ids = (c: WCACompetition[]) => c.map(x => x.id);

describe('visibleCompetitions', () => {
  it('keeps a competition ending today', () => {
    expect(ids(visibleCompetitions([ongoing], TODAY, false))).toEqual(['Ongoing']);
  });

  it('drops finished competitions in prod', () => {
    expect(ids(visibleCompetitions(all, TODAY, false))).toEqual(['Ongoing', 'Soon', 'Later']);
  });

  it('appends finished competitions in dev, most recent first', () => {
    expect(ids(visibleCompetitions(all, TODAY, true)))
      .toEqual(['Ongoing', 'Soon', 'Later', 'Yesterday', 'Past2024', 'Past2023']);
  });
});

describe('formatCompetitionDate', () => {
  it('shows the WCA date, not the day before, west of GMT', () => {
    // Bare `new Date('2026-09-13')` is UTC midnight, which renders as the 12th here.
    expect(formatCompetitionDate('2026-09-13', '2026-09-13')).toContain('13');
  });

  it('shows first-last for a multi-day competition', () => {
    const s = formatCompetitionDate('2026-09-13', '2026-09-14');
    expect(s).toContain('13');
    expect(s).toContain('14');
  });

  it('shows a single date for a one-day competition', () => {
    expect(formatCompetitionDate('2026-09-13', '2026-09-13')).not.toMatch(/[–-]/);
  });
});
