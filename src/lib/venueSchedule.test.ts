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

  // A reader with no English reads the whole page: lunch and the tutorial come from their
  // activity code, and "finale" is the noun ("final" is the masculine adjective).
  describe('French: no English left on the page', () => {
    const fr = () => build(corpusWcif('GrosJouetsaMontreal2025'), 'fr');

    it('activities and round names', () => {
      const names = fr().days[0].rows.map(r => r.name);
      expect(names).toEqual(expect.arrayContaining([
        'Accueil des compétiteurs', 'Tutoriel pour les nouveaux compétiteurs', 'Repas du midi', 'Cube 6x6x6 Finale',
      ]));
      expect(names.join(' ')).not.toMatch(/\b(Lunch|Tutorial|Check-in|Final)\b/);
      // Free text the organizer typed has no code to translate.
      expect(names.at(-1)).toBe('Surprise Event');
    });

    it('formats and who proceeds', () => {
      const [r1, r2] = fr().events[0].rounds;
      expect(r1).toMatchObject({ format: 'Meilleur\u00a0de\u00a02 / Moyenne\u00a0de\u00a05', proceed: 'Les 50\u00a0% meilleurs' });
      expect(r2.proceed).toBe('10 premiers');
    });

    it('cumulative agrees with "minutes", which is feminine', () => {
      expect(fr().events.find(e => e.eventId === '666')!.rounds[0].timeLimit).toBe('12:00.00 cumulative');
    });
  });

  // Pickering: 4BLD and 5BLD split one 1:15:00 between them, not 1:15:00 each.
  it('a limit shared across events names the other rounds', () => {
    const pk = corpusWcif('PickeringBlindfolded2026');
    expect(round(pk, '444bf', 0)).toMatchObject({ timeLimit: '1:15:00.00 cumulative', shared: 'Shared with 5x5x5 Blindfolded Final' });
    expect(round(pk, '555bf', 0, 'fr').shared).toBe("Partagée avec 4x4x4 à L'aveugle Finale");
    expect(round(pk, '333bf', 0)).toMatchObject({ timeLimit: '20:00.00 cumulative', shared: '' });
  });

  it('FMC cutoffs count moves', () => {
    const fmc = corpusWcif('FMCaMontreal2026');
    fmc.events[0].rounds[0].cutoff = { numberOfAttempts: 1, resultValue: 40 };
    expect(round(fmc, '333fm', 0).cutoff).toBe('Cutoff: 40 moves');
  });

  // Dual rounds: r1 feeds r2 on its own, then r1 and r2 together feed r3.
  it('linked rounds print their combined bar on the last one only', () => {
    const wcif = corpusWcif('GrosJouetsaMontreal2025');
    const rounds = wcif.events.find(e => e.id === '666')!.rounds;
    rounds.push({ ...rounds[1], id: '666-r3', participationRuleset: { reservedPlaces: null, participationSource:
      { type: 'linkedRounds', roundIds: ['666-r1', '666-r2'], resultCondition: { type: 'ranking', scope: 'average', value: 4 } } } });
    expect(round(wcif, '666', 0).proceed).toBe('Top 50%');
    expect(round(wcif, '666', 1).proceed).toBe('Top 4');
  });

  it('an unknown round format prints raw instead of failing the parse', () => {
    const wcif = corpusWcif('GrosJouetsaMontreal2025');
    wcif.events[0].rounds[0].format = 'x' as never;
    expect(round(wcif, wcif.events[0].id, 0).format).toMatch(/^x$|\/ x$/);
  });

  it('is null with no events and no schedule', () => {
    const wcif = corpusWcif('GrosJouetsaMontreal2025');
    wcif.events = [];
    wcif.schedule.venues = [];
    expect(parseWCIF(wcif, testSettings()).venueSchedule).toBeNull();
  });
});
