import { describe, expect, it } from 'vitest';
import { periodKeys, radarObjectKey, repairPeriodIndex, validateRadar, verifyPeriodIndex } from '../src/core';
import type { Radar } from '../src/model';

const radar = (radarId: string, timeKst: string): Radar => ({
  schema: '1.0', radarId, timeKst,
  themes: [{ id: 'synthetic-test', name: 'SYNTHETIC TEST — 게시 금지', stocks: [{ code: '005930' }] }],
});

describe('DK Trends Radar contract', () => {
  it('derives original and KST period paths including ISO week-year', () => {
    const value = radar('20260908-1530', '2026-09-08T15:30:00+09:00');
    expect(radarObjectKey(value)).toBe('radar/2026/09/08/1530.json');
    expect(periodKeys(value)).toEqual({
      daily: 'indexes/daily/2026-09-08.json',
      weekly: 'indexes/weekly/2026/week-37.json',
      monthly: 'indexes/monthly/2026/month-09.json',
    });
    const boundary = radar('20210101-0000', '2021-01-01T00:00:00+09:00');
    expect(periodKeys(boundary).weekly).toBe('indexes/weekly/2020/week-53.json');
  });

  it('repairs duplicates and removes out-of-period rows', () => {
    const incoming = radar('20260908-1530', '2026-09-08T15:30:00+09:00');
    const older = radar('20260908-1200', '2026-09-08T12:00:00+09:00');
    const wrongDay = radar('20260907-1530', '2026-09-07T15:30:00+09:00');
    const key = periodKeys(incoming).daily;
    const result = repairPeriodIndex({ items: [incoming, incoming, wrongDay, older] }, incoming, 'daily', key, '2026-09-08T15:31:00+09:00');
    expect(result.items.map((item) => item.radarId)).toEqual(['20260908-1530', '20260908-1200']);
    expect(verifyPeriodIndex(result, incoming, 'daily', key)).toBe(true);
  });

  it('rejects mismatched radarId and invalid stock codes', () => {
    expect(() => validateRadar(radar('20260908-1529', '2026-09-08T15:30:00+09:00'))).toThrow('RADAR_TIME_MISMATCH');
    const bad = radar('20260908-1530', '2026-09-08T15:30:00+09:00');
    bad.themes[0].stocks = [{ code: '5930' }];
    expect(() => validateRadar(bad)).toThrow('INVALID_STOCK_CODE');
  });
});
