import { describe, expect, it } from 'vitest';
import { escapeCell, parseCsv, toCsv, unescapeCell } from '../src';

describe('parseCsv', () => {
  it('handles quotes, embedded commas, newlines and CRLF', () => {
    const rows = parseCsv('a,"b, c","say ""hi""",d\r\n1,"line\nbreak",,\r\n');
    expect(rows).toEqual([
      ['a', 'b, c', 'say "hi"', 'd'],
      ['1', 'line\nbreak', '', ''],
    ]);
  });
  it('strips a UTF-8 BOM and skips blank lines', () => {
    expect(parseCsv('﻿sku,name\n\nA,ب\n')).toEqual([['sku', 'name'], ['A', 'ب']]);
  });
  it('rejects unterminated quotes', () => {
    expect(() => parseCsv('a,"open')).toThrow(SyntaxError);
  });
});

describe('toCsv and CSV injection protection', () => {
  it('round-trips arbitrary text', () => {
    const data = [['sku', 'name'], ['A-1', 'Screw, "wood"\nlong'], ['ب', '']];
    expect(parseCsv(toCsv(data))).toEqual(data);
  });
  it('neutralises formula-looking cells and restores them on import', () => {
    expect(escapeCell('=HYPERLINK("x")')).toBe("'=HYPERLINK(\"x\")");
    expect(unescapeCell("'=HYPERLINK")).toBe('=HYPERLINK');
    expect(unescapeCell("'plain")).toBe("'plain");
    const csv = toCsv([['name'], ['-5 mm bolt']]);
    expect(csv).toContain("'-5 mm bolt");
  });
});
