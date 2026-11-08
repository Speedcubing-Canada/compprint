import { describe, it, expect } from 'vitest';
import { parseDoubleCheckOverrides } from './parseDoubleCheckOverrides';

describe('parseDoubleCheckOverrides', () => {
  it('reads semicolon separated lines', () => {
    expect(parseDoubleCheckOverrides('2015foob01;333;444\r\n')).toEqual({ '2015FOOB01': ['333', '444'] });
  });

  it('parses one competitor per line with their events', () => {
    const out = parseDoubleCheckOverrides('2015FOOB01,333,444\n2018BARS02,333bf,555bf');
    expect(out).toEqual({
      '2015FOOB01': ['333', '444'],
      '2018BARS02': ['333bf', '555bf'],
    });
  });

  it('upper-cases WCA IDs and lower-cases event IDs', () => {
    const out = parseDoubleCheckOverrides('2015foob01,333BF,CLOCK');
    expect(out).toEqual({ '2015FOOB01': ['333bf', 'clock'] });
  });

  it('trims whitespace around tokens', () => {
    const out = parseDoubleCheckOverrides('  2015FOOB01 , 333 , 444  ');
    expect(out).toEqual({ '2015FOOB01': ['333', '444'] });
  });

  it('de-duplicates repeated events, including across lines for the same competitor', () => {
    const out = parseDoubleCheckOverrides('2015FOOB01,333,333\n2015FOOB01,333,444');
    expect(out).toEqual({ '2015FOOB01': ['333', '444'] });
  });

  it('skips blank lines and comment lines', () => {
    const out = parseDoubleCheckOverrides('\n# a comment\n2015FOOB01,333\n   \n');
    expect(out).toEqual({ '2015FOOB01': ['333'] });
  });

  it('skips lines with a WCA ID but no events', () => {
    const out = parseDoubleCheckOverrides('2015FOOB01\n2018BARS02,222');
    expect(out).toEqual({ '2018BARS02': ['222'] });
  });

  it('handles CRLF line endings', () => {
    const out = parseDoubleCheckOverrides('2015FOOB01,333\r\n2018BARS02,444');
    expect(out).toEqual({ '2015FOOB01': ['333'], '2018BARS02': ['444'] });
  });

  it('returns an empty object for empty input', () => {
    expect(parseDoubleCheckOverrides('')).toEqual({});
  });
});
