import { describe, it, expect } from 'vitest';
import type { Person } from '../types/wcif';
import { matchStaff, parseStaffCsv } from './staffCsv';

const rows = (text: string) => parseStaffCsv(text).map(({ who, extra }) => [who, ...extra]);

describe('parseStaffCsv', () => {
  it('reads WCA IDs, names and optional titles', () => {
    expect(parseStaffCsv('2015doej01\r\n# team\n\n  Zoé  Núñez , stream \n"Ana Lima","Scoretaking"\n')).toEqual([
      { who: '2015doej01', extra: [] },
      { who: 'Zoé  Núñez', extra: ['STREAM'] },
      { who: 'Ana Lima', extra: ['SCORETAKING'] },
    ]);
  });

  it('splits on semicolons or tabs, and bare CR line ends', () => {
    expect(rows('Jane Doe;Stream\r2015FOOB01;Scoretaking')).toEqual([['Jane Doe', 'STREAM'], ['2015FOOB01', 'SCORETAKING']]);
    expect(rows('Jane Doe\tStream')).toEqual([['Jane Doe', 'STREAM']]);
  });

  it('keeps separators inside double quotes', () => {
    expect(rows('"Doe, Jane","Stream, Lead"\n"Say ""Hi""",x')).toEqual([['Doe, Jane', 'STREAM, LEAD'], ['Say "Hi"', 'X']]);
  });

  it('skips a header row and a BOM', () => {
    expect(rows('\uFEFFWCA ID,Title\nAna Lima')).toEqual([['Ana Lima']]);
    expect(rows('Nom;Intitulé\nAna Lima')).toEqual([['Ana Lima']]);
  });

  it('matches a line with a name and a WCA ID on the ID, in either order', () => {
    expect(rows('Ana Silva,2016SILV01\n2016SILV02,Ana Silva')).toEqual([['2016SILV01'], ['2016SILV02', 'ANA SILVA']]);
    expect(rows('Ana Silva,2016SILV01,Stream')).toEqual([['2016SILV01', 'STREAM']]);
  });

  it('reads a third column as the title when the header names the second one', () => {
    expect(rows('WCA ID,Name,Team\n2016SILV01,Ana Sliva,Stream')).toEqual([['2016SILV01', 'STREAM']]);
  });

  it('keeps the last line for a repeated person', () => {
    expect(rows('Ana Lima,Stream\nana lima')).toEqual([['ana lima']]);
  });

  it('skips lines without a person', () => {
    expect(parseStaffCsv(',Stream\n#x\n')).toEqual([]);
  });
});

describe('parseStaffCsv headers', () => {
  it.each(['Full name', 'Nombre completo', 'Nome completo', 'Nom complet', 'Nom et prénom', 'wca_id', 'wca-id', 'WCAID'])('skips a "%s" header', header => {
    expect(rows(`${header},Title\nAna Lima`)).toEqual([['Ana Lima']]);
  });
});

const person = (registrantId: number | null, name: string, over: Partial<Person> = {}): Person => ({
  registrantId: registrantId as number, name, wcaUserId: registrantId ?? 0, wcaId: null, countryIso2: 'FR', gender: 'm',
  registration: { wcaRegistrationId: registrantId ?? 0, eventIds: [], status: 'accepted', isCompeting: true },
  avatar: null, roles: [], assignments: [], personalBests: [], ...over,
});
// Real WCIFs give Delegates and organizers who didn't register a null registrantId.
const unregistered = (name: string, wcaId: string, roles: string[]) =>
  person(null, name, { wcaId, roles, registration: null });

const people = [
  person(1, 'Zoé Streamer'),
  person(2, 'Søren Ågård'),
  person(3, 'Del Egate', { roles: ['delegate'] }),
  person(4, 'Org Anizer', { roles: ['organizer'] }),
  person(5, 'Vol Unteer', { registration: { wcaRegistrationId: 5, eventIds: [], status: 'accepted', isCompeting: false } }),
];
const labels = (m: ReturnType<typeof matchStaff>) => [...m.labels].map(([p, label]) => [p.name, label]);

describe('matchStaff', () => {
  it('reports every listed official, unmatched lines and shared names', () => {
    const twins = [...people, person(9, 'Zoe Streamer')];
    const m = matchStaff(twins, parseStaffCsv('Del Egate\norg anizer,Stream\nNobody Here\nZoé Streamer'), true);
    expect(m.officials).toEqual(['Del Egate', 'Org Anizer']);
    expect(m.unmatched).toEqual(['Nobody Here']);
    expect(m.ambiguous).toEqual(['Zoé Streamer']);
    expect(labels(m)).toEqual([['Org Anizer', 'STREAM']]);
  });

  it('lists an official once, however many lines name them', () => {
    const del = person(3, 'Del Egate', { roles: ['delegate'], wcaId: '2010DELE01' });
    expect(matchStaff([del], parseStaffCsv('Del Egate\n2010dele01\n'), true).officials).toEqual(['Del Egate']);
  });

  it('only matches people who get a name tag', () => {
    expect(matchStaff(people, parseStaffCsv('Vol Unteer'), false).unmatched).toEqual(['Vol Unteer']);
  });

  it('matches letters accent folding misses', () => {
    expect(labels(matchStaff(people, parseStaffCsv('Soren Agard,Stream'), true))).toEqual([['Søren Ågård', 'STREAM']]);
  });

  it('keeps unregistered officials apart, though they share a null registrantId', () => {
    const a = unregistered('Liam Orovec', '2014OROV01', ['delegate']);
    const b = unregistered('Other Delegate', '2015OTHE01', ['delegate']);
    const m = matchStaff([a, b], parseStaffCsv('2014OROV01,Stream'), true);
    expect(m.labels.get(a)).toBe('STREAM');
    expect(m.labels.has(b)).toBe(false);
    expect(matchStaff([a, b], parseStaffCsv('2014OROV01\n2015OTHE01'), true).officials).toEqual(['Liam Orovec', 'Other Delegate']);
  });

  it('reads a name-and-WCA-ID sheet as people, not badges', () => {
    const jane = person(7, 'Jane Doe', { wcaId: '2015DOEJ01' });
    expect(labels(matchStaff([jane], parseStaffCsv('Name,WCA ID\nJane Doe,2015DOEJ01'), true))).toEqual([['Jane Doe', null]]);
    expect(labels(matchStaff([jane], parseStaffCsv('2015DOEJ01;Jane Doe'), true))).toEqual([['Jane Doe', null]]);
  });

  it('treats the second column as names for the whole file once one matches', () => {
    const jane = person(7, 'Jane Doe', { wcaId: '2015DOEJ01' });
    const jon = person(8, 'Jonathan Roe', { wcaId: '2015ROEJ01' });
    const m = matchStaff([jane, jon], parseStaffCsv('2015DOEJ01,Jane Doe,Stream\n2015ROEJ01,Jon Roe'), true);
    expect(labels(m)).toEqual([['Jane Doe', 'STREAM'], ['Jonathan Roe', null]]);
  });

  it('matches a shared name by the WCA ID on its line', () => {
    const twins = [person(7, 'Ana Silva', { wcaId: '2016SILV01' }), person(8, 'Ana Silva', { wcaId: '2016SILV02' })];
    const m = matchStaff(twins, parseStaffCsv('Ana Silva,2016SILV02'), true);
    expect(m.ambiguous).toEqual([]);
    expect([...m.labels.keys()].map(p => p.wcaId)).toEqual(['2016SILV02']);
  });

  it('reports an unquoted "Surname, Given" as unmatched, not as a badge', () => {
    const m = matchStaff([person(7, 'Jane Doe')], parseStaffCsv('Doe, Jane'), true);
    expect(m.unmatched).toEqual(['Doe']);
    expect(m.labels.size).toBe(0);
  });
});
