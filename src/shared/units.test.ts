import { describe, expect, it } from 'vitest';
import { formatBytes, parseSize } from './units.js';

describe('parseSize', () => {
  it.each([
    [1, 'B', 1],
    [1, 'KB', 1000],
    [1, 'MB', 1_000_000],
    [1, 'GB', 1_000_000_000],
    [1, 'TB', 1_000_000_000_000],
    [1, 'KiB', 1024],
    [1, 'MiB', 1_048_576],
    [1, 'GiB', 1_073_741_824],
    [1, 'TiB', 1_099_511_627_776],
    [1.5, 'KiB', 1536],
    [0, 'MB', 0],
  ])('%d %s -> %d bytes', (value, unit, expected) => {
    expect(parseSize(value, unit)).toBe(expected);
  });

  it('rejects invalid input', () => {
    expect(() => parseSize(-1, 'B')).toThrow();
    expect(() => parseSize(NaN, 'B')).toThrow();
    expect(() => parseSize(1, 'XB')).toThrow();
    expect(() => parseSize(1e9, 'TiB')).toThrow();
  });
});

describe('formatBytes', () => {
  it('formats both systems', () => {
    expect(formatBytes(1_048_576)).toEqual({ decimal: '1.05 MB', binary: '1.00 MiB' });
    expect(formatBytes(999)).toEqual({ decimal: '999 B', binary: '999 B' });
  });
});
