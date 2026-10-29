import { describe, it, expect } from 'vitest';
import { parseWCIF } from './wcif-parser';
import { resultTime } from './venueSchedule';
import { corpusWcif } from '../test/corpus';
import { testSettings } from '../test/fixtures';
import type { LocaleCode } from '../types/settings';
import type { WCIF } from '../types/wcif';

const build = (wcif: WCIF, language: LocaleCode = 'en') =>
  parseWCIF(wcif, testSettings({ language })).venueSchedule!;
const round = (wcif: WCIF, eventId: string, i: number, language: LocaleCode = 'en') =>
  build(wcif, language).events.find(e => e.eventId === eventId)!.rounds[i];

describe('resultTime', () => {
  it.each([[4500, '45.00'], [900, '9.00'], [9000, '1:30.00'], [60000, '10:00.00'], [360000, '1:00:00.00']])(
    '%i → %s', (cs, text) => expect(resultTime(cs)).toBe(text));
});

// Every expected value is read off the WCA's own GrosJouetsaMontreal2025.pdf.
describe('matches the WCA competition PDF', () => {
  const gj = () => corpusWcif('GrosJouetsaMontreal2025');

  it('events: format with cutoff, cumulative limits, who proceeds', () => {
    expect(round(gj(), '444', 0)).toMatchObject({ format: 'Bo2 / Ao5', cutoff: 'Cutoff: 1:30.00', timeLimit: '10:00.00', proceed: 'Top 50%' });
    expect(round(gj(), '666', 1)).toMatchObject({ format: 'Mo3', timeLimit: '12:00.00 cumulative', proceed: 'Top 8' });
    expect(round(gj(), '555bf', 0)).toMatchObject({ format: 'Bo3', timeLimit: '1:00:00.00 cumulative', proceed: '' });
  });

  it('schedule: one day per local date, rows in start order, non-round activities kept', () => {
    const { days } = build(gj());
    expect(days).toHaveLength(2);
    expect(days[0].dateLabel).toBe('Saturday, April 19, 2025');
    expect(days[0].rows.slice(0, 4).map(r => [r.start, r.end, r.name])).toEqual([
      ['9:30 AM', '10:00 AM', 'Check-in'],
      ['10:00 AM', '10:20 AM', 'Tutorial for new competitors'],
      ['10:30 AM', '11:40 AM', '6x6x6 Cube Round 1'],
      ['11:10 AM', '12:20 PM', '4x4x4 Blindfolded Final'],
    ]);
    // 6:30 PM in Montréal is past midnight UTC: still Saturday.
    expect(days[0].rows.at(-1)).toMatchObject({ start: '6:30 PM', name: 'Surprise Event', eventId: null, round: null });
  });
});

describe('buildVenueSchedule', () => {
  it('one round on several stages is one row listing every room', () => {
    const row = build(corpusWcif('BCChampionship2026')).days[0].rows.find(r => r.name === '5x5x5 Cube Round 1')!;
    expect(row.rooms).toEqual(['Red', 'Blue', 'Orange']);
  });

  it('FMC prints one row per attempt and no time limit', () => {
    const fmc = corpusWcif('FMCaMontreal2026');
    expect(build(fmc).days.flatMap(d => d.rows.map(r => r.name))).toEqual(
      ['FMC Final (Attempt 1)', 'FMC Final (Attempt 2)', 'FMC Final (Attempt 3)']);
    expect(round(fmc, '333fm', 0).timeLimit).toBe('');
  });

  it('a result-achieved advancement prints the bar to beat', () => {
    const wcif = corpusWcif('GrosJouetsaMontreal2025');
    wcif.events.find(e => e.id === '666')!.rounds[1].participationRuleset!.participationSource =
      { type: 'round', roundId: '666-r1', resultCondition: { type: 'resultAchieved', scope: 'average', value: 12000 } };
    expect(round(wcif, '666', 0).proceed).toBe('< 2:00.00');
  });

  it('French: 24h clock, localized names and cutoff', () => {
    const fr = build(corpusWcif('GrosJouetsaMontreal2025'), 'fr');
    expect(fr.days[0].dateLabel).toBe('Samedi 19 avril 2025');
    expect(fr.days[0].rows[2]).toMatchObject({ start: '10:30', end: '11:40', name: 'Cube 6x6x6 Tour 1' });
    expect(fr.events[0].rounds[0].cutoff).toBe('Seuil : 1:30.00');
  });
});
