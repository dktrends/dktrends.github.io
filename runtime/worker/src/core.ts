import type { IngestEnvelope, PeriodIndex, Radar } from './model';

export class IngestionError extends Error {
  constructor(
    readonly code: string,
    readonly stage: string,
    readonly retryable: boolean,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function nowKst(date = new Date()): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00');
}

export function validateEnvelope(value: unknown): IngestEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IngestionError('INVALID_ENVELOPE', 'VALIDATE', false);
  const envelope = value as Partial<IngestEnvelope>;
  if (envelope.contractVersion !== 'dk.radar-ingest.v1' || envelope.operation !== 'UPSERT_RADAR') {
    throw new IngestionError('INVALID_CONTRACT', 'VALIDATE', false);
  }
  if (!envelope.metadata || envelope.metadata.producer !== 'chatgpt-plus-drive-handoff' || typeof envelope.metadata.driveFileId !== 'string') {
    throw new IngestionError('INVALID_METADATA', 'VALIDATE', false);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\+09:00$/.test(envelope.requestedAtKst ?? '')) {
    throw new IngestionError('INVALID_REQUESTED_AT_KST', 'VALIDATE', false);
  }
  validateRadar(envelope.radar);
  return envelope as IngestEnvelope;
}

export function validateRadar(value: unknown): asserts value is Radar {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IngestionError('INVALID_RADAR', 'VALIDATE', false);
  const radar = value as Partial<Radar>;
  if (!/^\d{8}-\d{4}$/.test(radar.radarId ?? '')) throw new IngestionError('INVALID_RADAR_ID', 'VALIDATE', false);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\+09:00$/.test(radar.timeKst ?? '')) {
    throw new IngestionError('INVALID_TIME_KST', 'VALIDATE', false);
  }
  if (!Array.isArray(radar.themes)) throw new IngestionError('THEMES_NOT_ARRAY', 'VALIDATE', false);
  const expectedId = radar.timeKst!.slice(0, 10).replaceAll('-', '') + '-' + radar.timeKst!.slice(11, 16).replace(':', '');
  if (expectedId !== radar.radarId) throw new IngestionError('RADAR_TIME_MISMATCH', 'VALIDATE', false);
  for (const theme of radar.themes) {
    if (theme.stocks === undefined) continue;
    if (!Array.isArray(theme.stocks)) throw new IngestionError('STOCKS_NOT_ARRAY', 'VALIDATE', false);
    for (const stock of theme.stocks) {
      if (!stock || typeof stock.code !== 'string' || !/^\d{6}$/.test(stock.code)) {
        throw new IngestionError('INVALID_STOCK_CODE', 'VALIDATE', false);
      }
    }
  }
}

export function radarObjectKey(radar: Radar): string {
  return `radar/${radar.timeKst.slice(0, 4)}/${radar.timeKst.slice(5, 7)}/${radar.timeKst.slice(8, 10)}/${radar.timeKst.slice(11, 13)}${radar.timeKst.slice(14, 16)}.json`;
}

export function periodKeys(radar: Radar): { daily: string; weekly: string; monthly: string } {
  const date = parseKstParts(radar.timeKst);
  const week = isoWeek(date.year, date.month, date.day);
  return {
    daily: `indexes/daily/${pad4(date.year)}-${pad2(date.month)}-${pad2(date.day)}.json`,
    weekly: `indexes/weekly/${week.year}/week-${pad2(week.week)}.json`,
    monthly: `indexes/monthly/${pad4(date.year)}/month-${pad2(date.month)}.json`,
  };
}

export function belongsToPeriod(radar: Radar, kind: 'daily' | 'weekly' | 'monthly', targetKey: string): boolean {
  try {
    return periodKeys(radar)[kind] === targetKey;
  } catch {
    return false;
  }
}

export function repairPeriodIndex(
  existing: unknown,
  incoming: Radar,
  kind: 'daily' | 'weekly' | 'monthly',
  targetKey: string,
  updatedAt: string,
): PeriodIndex {
  const sourceItems = existing && typeof existing === 'object' && Array.isArray((existing as { items?: unknown }).items)
    ? (existing as { items: unknown[] }).items
    : [];
  const valid: Radar[] = [];
  for (const item of sourceItems) {
    try {
      validateRadar(item);
      if (item.radarId !== incoming.radarId && belongsToPeriod(item, kind, targetKey)) valid.push(item);
    } catch {
      // Invalid and out-of-period legacy rows are repaired away.
    }
  }
  valid.push(incoming);
  valid.sort((a, b) => Date.parse(b.timeKst) - Date.parse(a.timeKst));
  return { updatedAt, items: valid };
}

export function verifyPeriodIndex(index: PeriodIndex, radar: Radar, kind: 'daily' | 'weekly' | 'monthly', key: string): boolean {
  return index.items.filter((item) => item.radarId === radar.radarId).length === 1 &&
    index.items.every((item) => belongsToPeriod(item, kind, key));
}

function parseKstParts(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!match) throw new IngestionError('INVALID_TIME_KST', 'VALIDATE', false);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function isoWeek(year: number, month: number, day: number): { year: number; week: number } {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  return { year: weekYear, week: Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7) };
}

function pad2(value: number): string { return String(value).padStart(2, '0'); }
function pad4(value: number): string { return String(value).padStart(4, '0'); }
