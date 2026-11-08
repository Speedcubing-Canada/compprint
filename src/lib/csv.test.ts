import { describe, it, expect } from 'vitest';
import { csvRows, decodeText } from './csv';

const utf16 = (s: string, bom: number[], le: boolean) => {
  const out = [...bom];
  for (const c of s) { const n = c.charCodeAt(0); out.push(...(le ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff])); }
  return new Uint8Array(out).buffer;
};

describe('decodeText', () => {
  it('reads UTF-8, and falls back to Windows-1252', () => {
    expect(decodeText(new TextEncoder().encode('Zoé Núñez').buffer)).toBe('Zoé Núñez');
    expect(decodeText(new Uint8Array([0x5a, 0x6f, 0xe9]).buffer)).toBe('Zoé');
  });

  it('keeps UTF-8 accents when a few bytes are invalid', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('José'), 0xff]);
    expect(decodeText(bytes.buffer)).toBe('José\uFFFD');
  });

  it('reads UTF-16 with either byte order mark', () => {
    expect(csvRows(decodeText(utf16('Zoé,Stream', [0xff, 0xfe], true)))).toEqual([['Zoé', 'Stream']]);
    expect(csvRows(decodeText(utf16('Zoé,Stream', [0xfe, 0xff], false)))).toEqual([['Zoé', 'Stream']]);
  });

  it('reads an empty file', () => {
    expect(decodeText(new ArrayBuffer(0))).toBe('');
  });
});

describe('csvRows', () => {
  it('splits on the separator the first line uses most, across any line ending', () => {
    expect(csvRows('a, b\r\nc,d\re,f\n')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']]);
    expect(csvRows('Name;Team;Note\nDoe, Jane;Stream;x')).toEqual([['Name', 'Team', 'Note'], ['Doe, Jane', 'Stream', 'x']]);
    expect(csvRows('a\tb, c\td')).toEqual([['a', 'b, c', 'd']]);
  });

  it('keeps quotes inside a field as typed', () => {
    expect(csvRows('John "JJ" Doe,2019DOEJ01')).toEqual([['John "JJ" Doe', '2019DOEJ01']]);
  });

  it('keeps separators inside double quotes', () => {
    expect(csvRows('"Doe, Jane","Stream; Lead"\n"Say ""Hi""",x')).toEqual([['Doe, Jane', 'Stream; Lead'], ['Say "Hi"', 'x']]);
  });

  it('drops a BOM, blank lines and comments', () => {
    expect(csvRows('\uFEFFa\n\n  \n# note\nb')).toEqual([['a'], ['b']]);
  });
});
