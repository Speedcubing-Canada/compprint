import { describe, it, expect } from 'vitest';
import { parseStaffCsv } from './parseStaffCsv';

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
