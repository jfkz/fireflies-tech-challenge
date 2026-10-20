import { describe, expect, it } from 'vitest';
import { appLabel, compact, limitLabel, minutes, niceMax, percent, usd, valueOf } from './admin';

describe('admin numbers', () => {
  it('rounds the axis up to a clean number', () => {
    expect([0, 0.4, 1, 3, 7, 12, 23, 260, 999].map(niceMax)).toEqual([1, 1, 1, 5, 10, 20, 25, 500, 1000]);
    expect(niceMax(Number.NaN)).toBe(1);
  });

  it('writes counts, money and rates compactly', () => {
    expect([compact(7), compact(1284), compact(12_900)]).toEqual(['7', '1,284', '12.9K']);
    expect([usd(0), usd(0.384), usd(120.4), usd(4200)]).toEqual(['$0.00', '$0.38', '$120', '$4,200']);
    expect([percent(null), percent(0), percent(0.0333), percent(0.06), percent(0.5)]).toEqual(['—', '0%', '3.3%', '6%', '50%']);
  });

  it('names apps, lengths and limits', () => {
    expect(appLabel('windows', '0.6.0')).toBe('Windows 0.6.0');
    expect(appLabel('macos', null)).toBe('Mac (version not seen yet)');
    expect(appLabel(null, null)).toBe('Unknown app (version not seen yet)');
    expect([minutes(45), minutes(60), minutes(130)]).toEqual(['45 min', '1 h', '2 h 10 min']);
    expect([limitLabel(null), limitLabel(0), limitLabel(90)]).toEqual(['Default', 'No limit', '1 h 30 min']);
    expect([limitLabel(null, 120), limitLabel(null, null)]).toEqual(['Default (2 h)', 'Default (no limit)']);
    expect(valueOf({ date: '2026-10-01', meetings: 2, hours: 1.5, signups: 1 }, 'hours')).toBe(1.5);
  });
});
