import { describe, it, expect } from 'vitest';
import type { Person } from '../types/wcif';
import { matchStaff, parseStaffCsv } from './parseStaffCsv';

const keys = (text: string) => parseStaffCsv(text).map(({ key, label }) => [key, label]);

describe('parseStaffCsv', () => {
  it('reads WCA IDs, names and optional labels', () => {
    expect(parseStaffCsv('2015doej01\r\n# team\n\n  Zoé  Núñez , stream \n"Ana Lima","Scoretaking"\n')).toEqual([
      { key: '2015DOEJ01', who: '2015doej01', label: null },
      { key: 'zoe nunez', who: 'Zoé  Núñez', label: 'STREAM' },
      { key: 'ana lima', who: 'Ana Lima', label: 'SCORETAKING' },
    ]);
  });

  it('splits on semicolons and tabs, and bare CR line ends', () => {
    expect(keys('Jane Doe;Stream\r2015FOOB01\tScoretaking')).toEqual([
      ['jane doe', 'STREAM'], ['2015FOOB01', 'SCORETAKING'],
    ]);
  });

  it('keeps separators inside double quotes', () => {
    expect(keys('"Doe, Jane","Stream, Lead"\n"Say ""Hi""",x')).toEqual([
      ['doe, jane', 'STREAM, LEAD'], ['say "hi"', 'X'],
    ]);
  });

  it('skips a header row and a BOM', () => {
    expect(keys('﻿WCA ID,Title\nAna Lima')).toEqual([['ana lima', null]]);
    expect(keys('Nom;Intitulé\nAna Lima')).toEqual([['ana lima', null]]);
  });

  it('keeps the last line for a repeated person', () => {
    expect(keys('Ana Lima,Stream\nana lima')).toEqual([['ana lima', null]]);
  });

  it('skips lines without a person', () => {
    expect(parseStaffCsv(',Stream\n#x\n')).toEqual([]);
  });
});

describe('parseStaffCsv headers', () => {
  it.each(['Full name', 'Nombre completo', 'Nome completo', 'Nom complet', 'wca_id', 'WCAID'])('skips a "%s" header', header => {
    expect(keys(`${header},Title\nAna Lima`)).toEqual([['ana lima', null]]);
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
});
