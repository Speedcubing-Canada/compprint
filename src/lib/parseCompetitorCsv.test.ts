import { describe, it, expect } from 'vitest';
import { parseCompetitorCsv } from './parseCompetitorCsv';

describe('parseCompetitorCsv', () => {
  it('reads an Excel fr/es/pt export: semicolons, quoted names', () => {
    expect(parseCompetitorCsv('Name;WCA ID\r\nJosé Núñez;2019NUNE01\r\n"Doe, John";2019DOEJ01\r\nAna Lima\r\n')).toEqual([
      { name: 'José Núñez', wcaId: '2019NUNE01' },
      { name: 'Doe, John', wcaId: '2019DOEJ01' },
      { name: 'Ana Lima', wcaId: '' },
    ]);
  });

  it('parses one competitor per line, name only', () => {
    const out = parseCompetitorCsv('Alice Martin\nBob Tremblay');
    expect(out).toEqual([
      { name: 'Alice Martin', wcaId: '' },
      { name: 'Bob Tremblay', wcaId: '' },
    ]);
  });

  it('parses name plus WCA ID', () => {
    const out = parseCompetitorCsv('Alice Martin,2019MART01\nBob Tremblay,2021TREM02');
    expect(out).toEqual([
      { name: 'Alice Martin', wcaId: '2019MART01' },
      { name: 'Bob Tremblay', wcaId: '2021TREM02' },
    ]);
  });

  it('upper-cases WCA IDs', () => {
    const out = parseCompetitorCsv('Alice Martin,2019mart01');
    expect(out).toEqual([{ name: 'Alice Martin', wcaId: '2019MART01' }]);
  });

  it('trims whitespace around name and ID', () => {
    const out = parseCompetitorCsv('  Alice Martin , 2019MART01  ');
    expect(out).toEqual([{ name: 'Alice Martin', wcaId: '2019MART01' }]);
  });

  it('keeps a comma-containing name when the last field is a WCA ID', () => {
    const out = parseCompetitorCsv('Doe, John,2019DOEJ01');
    expect(out).toEqual([{ name: 'Doe, John', wcaId: '2019DOEJ01' }]);
  });

  it('treats the whole line as a name when the last field is not a WCA ID', () => {
    const out = parseCompetitorCsv('Doe, John');
    expect(out).toEqual([{ name: 'Doe, John', wcaId: '' }]);
  });

  it('skips an optional header row', () => {
    const out = parseCompetitorCsv('Name,WCA ID\nAlice Martin,2019MART01');
    expect(out).toEqual([{ name: 'Alice Martin', wcaId: '2019MART01' }]);
  });

  it('does not skip a first line whose first field is a real name', () => {
    const out = parseCompetitorCsv('Alice Martin\nBob Tremblay');
    expect(out).toHaveLength(2);
  });

  it('skips blank lines and comment lines', () => {
    const out = parseCompetitorCsv('\n# staff\nAlice Martin\n   \nBob Tremblay\n');
    expect(out).toEqual([
      { name: 'Alice Martin', wcaId: '' },
      { name: 'Bob Tremblay', wcaId: '' },
    ]);
  });

  it('strips a leading UTF-8 BOM', () => {
    const out = parseCompetitorCsv('﻿Alice Martin,2019MART01');
    expect(out).toEqual([{ name: 'Alice Martin', wcaId: '2019MART01' }]);
  });

  it('handles CRLF line endings', () => {
    const out = parseCompetitorCsv('Alice Martin\r\nBob Tremblay');
    expect(out).toHaveLength(2);
  });

  it('skips rows whose name is empty (e.g. a lone WCA ID or bare comma)', () => {
    const out = parseCompetitorCsv(',\n,2019MART01\nAlice Martin');
    expect(out).toEqual([{ name: 'Alice Martin', wcaId: '' }]);
  });

  it('keeps duplicate rows (two rows = two cards)', () => {
    const out = parseCompetitorCsv('Alice Martin\nAlice Martin');
    expect(out).toHaveLength(2);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCompetitorCsv('')).toEqual([]);
  });
});
