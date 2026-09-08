import { DurableObject } from 'cloudflare:workers';
import {
  IngestionError,
  canonicalJson,
  nowKst,
  periodKeys,
  radarObjectKey,
  repairPeriodIndex,
  sha256Hex,
  validateEnvelope,
  verifyPeriodIndex,
} from './core';
import type { IngestEnvelope, PeriodIndex, PriceSnapshot, PublicResult, Radar } from './model';

const JSON_HTTP_METADATA = { contentType: 'application/json; charset=utf-8' } as const;
const MAX_BODY_BYTES = 1024 * 1024;
type WorkerEnv = Env & { INGEST_TOKEN: string };

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!await authorized(request, env.INGEST_TOKEN)) return json({ error: { code: 'UNAUTHORIZED' } }, 401);

    const writer = env.RADAR_WRITER.getByName('global-radar-writer');

    if (request.method === 'POST' && url.pathname === '/v1/price-snapshots') {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return json({ error: { code: 'PAYLOAD_TOO_LARGE' } }, 413);
      try {
        const snapshot = validatePriceSnapshot(JSON.parse(body));
        const latest = await readJson<Radar>(env.RADAR_BUCKET, 'radar/latest.json');
        if (!latest || latest.radarId !== snapshot.radarId) return json({ error: { code: 'STALE_RADAR' } }, 409);
        const snapshotKey = priceSnapshotKey(snapshot.radarId);
        await env.RADAR_BUCKET.put(snapshotKey, JSON.stringify(snapshot), {
          httpMetadata: { ...JSON_HTTP_METADATA, cacheControl: 'no-store' },
        });
        await env.RADAR_BUCKET.put('prices/latest.json', JSON.stringify(snapshot), {
          httpMetadata: { ...JSON_HTTP_METADATA, cacheControl: 'no-store' },
        });
        const verified = await readJson<PriceSnapshot>(env.RADAR_BUCKET, snapshotKey);
        if (!verified || verified.radarId !== snapshot.radarId || verified.observedAtKst !== snapshot.observedAtKst) {
          throw new IngestionError('PRICE_SNAPSHOT_VERIFY_FAILED', 'VERIFY_PRICE_SNAPSHOT', true);
        }
        return json({ radarId: snapshot.radarId, status: 'DONE', verified: true, completedAtKst: nowKst() });
      } catch (error) {
        const known = error instanceof IngestionError ? error : new IngestionError('INVALID_PRICE_SNAPSHOT', 'VALIDATE_PRICE_SNAPSHOT', false);
        return json({ status: 'FAILED', verified: false, stage: known.stage, retryable: known.retryable, error: { code: known.code } }, known.retryable ? 500 : 400);
      }
    }

    if (request.method === 'POST' && url.pathname === '/v1/radar-ingestions') {
      const operationId = request.headers.get('Idempotency-Key')?.trim();
      if (!operationId || operationId.length > 128) return json({ error: { code: 'INVALID_IDEMPOTENCY_KEY' } }, 400);
      const declaredLength = Number(request.headers.get('content-length') || 0);
      if (declaredLength > MAX_BODY_BYTES) return json({ error: { code: 'PAYLOAD_TOO_LARGE' } }, 413);
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return json({ error: { code: 'PAYLOAD_TOO_LARGE' } }, 413);
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return json({ error: { code: 'INVALID_JSON' } }, 400); }
      try {
        const envelope = validateEnvelope(parsed);
        return json(await writer.ingest(operationId, envelope));
      } catch (error) {
        return json(publicFailure(operationId, 'unknown', error), error instanceof IngestionError ? 400 : 500);
      }
    }

    const match = /^\/v1\/radar-ingestions\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && match) {
      const result = await writer.getStatus(decodeURIComponent(match[1]));
      return result ? json(result) : json({ error: { code: 'NOT_FOUND' } }, 404);
    }

    return json({ error: { code: 'NOT_FOUND' } }, 404);
  },
} satisfies ExportedHandler<WorkerEnv>;

export class RadarWriter extends DurableObject<WorkerEnv> {
  private serial: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY,
        radar_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  async ingest(operationId: string, envelope: IngestEnvelope): Promise<PublicResult> {
    const run = this.serial.then(() => this.ingestExclusive(operationId, envelope));
    this.serial = run.then(() => undefined, () => undefined);
    return run;
  }

  async getStatus(operationId: string): Promise<PublicResult | null> {
    const rows = this.ctx.storage.sql.exec<{ result_json: string; status: string; updated_at: string }>(
      'SELECT result_json, status, updated_at FROM operations WHERE operation_id = ?', operationId,
    ).toArray();
    if (!rows.length) return null;
    if (rows[0].status === 'PROCESSING' && Date.now() - Date.parse(rows[0].updated_at) > 10 * 60 * 1000) {
      return {
        operationId,
        radarId: (JSON.parse(rows[0].result_json) as PublicResult).radarId,
        status: 'FAILED',
        verified: false,
        stage: 'RECOVERY',
        retryable: true,
        error: { code: 'PROCESSING_STALE' },
        completedAtKst: nowKst(),
      };
    }
    return JSON.parse(rows[0].result_json) as PublicResult;
  }

  private async ingestExclusive(operationId: string, envelope: IngestEnvelope): Promise<PublicResult> {
    const radar = envelope.radar;
    const payload = canonicalJson(radar);
    const payloadHash = await sha256Hex(payload);
    const existing = this.ctx.storage.sql.exec<{
      radar_id: string; payload_hash: string; status: string; result_json: string;
    }>('SELECT radar_id, payload_hash, status, result_json FROM operations WHERE operation_id = ?', operationId).toArray()[0];

    if (existing && existing.payload_hash !== payloadHash) {
      return publicFailure(operationId, radar.radarId, new IngestionError('IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY', false));
    }
    if (existing && (existing.status === 'DONE' || (existing.status === 'FAILED' && (JSON.parse(existing.result_json) as PublicResult).retryable === false))) {
      return JSON.parse(existing.result_json) as PublicResult;
    }

    this.storeOperation(operationId, radar.radarId, payloadHash, {
      operationId, radarId: radar.radarId, status: 'PROCESSING', verified: false,
    });

    try {
      await this.writeOriginal(radar, payload, payloadHash);
      const latestUpdated = await this.updateLatest(radar, payload, payloadHash);
      const keys = periodKeys(radar);
      await this.updatePeriod(keys.daily, 'daily', radar);
      await this.updatePeriod(keys.weekly, 'weekly', radar);
      await this.updatePeriod(keys.monthly, 'monthly', radar);
      if (!latestUpdated) await this.verifyLatestSkip(radar);

      const result: PublicResult = {
        operationId, radarId: radar.radarId, status: 'DONE', verified: true, completedAtKst: nowKst(),
      };
      this.storeOperation(operationId, radar.radarId, payloadHash, result);
      return result;
    } catch (error) {
      const result = publicFailure(operationId, radar.radarId, error);
      this.storeOperation(operationId, radar.radarId, payloadHash, result);
      return result;
    }
  }

  private storeOperation(operationId: string, radarId: string, payloadHash: string, result: PublicResult): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO operations(operation_id, radar_id, payload_hash, status, result_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(operation_id) DO UPDATE SET
         radar_id=excluded.radar_id, payload_hash=excluded.payload_hash,
         status=excluded.status, result_json=excluded.result_json, updated_at=excluded.updated_at`,
      operationId, radarId, payloadHash, result.status, JSON.stringify(result), nowKst(),
    );
  }

  private async writeOriginal(radar: Radar, payload: string, payloadHash: string): Promise<void> {
    const key = radarObjectKey(radar);
    const current = await this.env.RADAR_BUCKET.get(key);
    if (current) {
      const currentHash = current.customMetadata?.payloadHash ?? await sha256Hex(await current.text());
      if (currentHash !== payloadHash) throw new IngestionError('IMMUTABLE_RADAR_CONFLICT', 'WRITE_ORIGINAL', false);
    } else {
      await this.env.RADAR_BUCKET.put(key, payload, { httpMetadata: JSON_HTTP_METADATA, customMetadata: { payloadHash } });
    }
    await this.verifyObjectHash(key, payloadHash, 'VERIFY_ORIGINAL');
  }

  private async updateLatest(radar: Radar, payload: string, payloadHash: string): Promise<boolean> {
    const key = 'radar/latest.json';
    const current = await readJson<Radar>(this.env.RADAR_BUCKET, key);
    if (current && Date.parse(current.timeKst) > Date.parse(radar.timeKst)) return false;
    if (current && current.radarId === radar.radarId) {
      const currentHash = await sha256Hex(canonicalJson(current));
      if (currentHash !== payloadHash) throw new IngestionError('IMMUTABLE_RADAR_CONFLICT', 'UPDATE_LATEST', false);
    }
    await this.env.RADAR_BUCKET.put(key, payload, { httpMetadata: JSON_HTTP_METADATA, customMetadata: { payloadHash } });
    await this.verifyObjectHash(key, payloadHash, 'VERIFY_LATEST');
    return true;
  }

  private async verifyLatestSkip(incoming: Radar): Promise<void> {
    const latest = await readJson<Radar>(this.env.RADAR_BUCKET, 'radar/latest.json');
    if (!latest || Date.parse(latest.timeKst) <= Date.parse(incoming.timeKst)) {
      throw new IngestionError('LATEST_SKIP_NOT_VERIFIED', 'VERIFY_LATEST', true);
    }
  }

  private async updatePeriod(key: string, kind: 'daily' | 'weekly' | 'monthly', radar: Radar): Promise<void> {
    const existing = await readJson<unknown>(this.env.RADAR_BUCKET, key);
    const repaired = repairPeriodIndex(existing, radar, kind, key, nowKst());
    await this.env.RADAR_BUCKET.put(key, JSON.stringify(repaired), { httpMetadata: JSON_HTTP_METADATA });
    const verified = await readJson<PeriodIndex>(this.env.RADAR_BUCKET, key);
    if (!verified || !verifyPeriodIndex(verified, radar, kind, key)) {
      throw new IngestionError('PERIOD_INDEX_VERIFY_FAILED', `VERIFY_${kind.toUpperCase()}`, true);
    }
  }

  private async verifyObjectHash(key: string, expectedHash: string, stage: string): Promise<void> {
    const object = await this.env.RADAR_BUCKET.get(key);
    if (!object) throw new IngestionError('OBJECT_NOT_FOUND_AFTER_WRITE', stage, true);
    const actualHash = object.customMetadata?.payloadHash ?? await sha256Hex(await object.text());
    if (actualHash !== expectedHash) throw new IngestionError('OBJECT_HASH_MISMATCH', stage, true);
  }
}

function validatePriceSnapshot(value: unknown): PriceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IngestionError('INVALID_PRICE_SNAPSHOT', 'VALIDATE_PRICE_SNAPSHOT', false);
  const snapshot = value as Partial<PriceSnapshot>;
  if (!/^\d{8}-\d{4}$/.test(snapshot.radarId ?? '')) throw new IngestionError('INVALID_RADAR_ID', 'VALIDATE_PRICE_SNAPSHOT', false);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\+09:00$/.test(snapshot.observedAtKst ?? '')) {
    throw new IngestionError('INVALID_OBSERVED_AT_KST', 'VALIDATE_PRICE_SNAPSHOT', false);
  }
  if (!Array.isArray(snapshot.stocks) || !snapshot.stocks.length || snapshot.stocks.length > 12) {
    throw new IngestionError('INVALID_PRICE_STOCKS', 'VALIDATE_PRICE_SNAPSHOT', false);
  }
  const codes = new Set<string>();
  for (const stock of snapshot.stocks) {
    if (!stock || !/^\d{6}$/.test(stock.code) || !Number.isFinite(stock.price) || stock.price <= 0 || codes.has(stock.code)) {
      throw new IngestionError('INVALID_PRICE_STOCK', 'VALIDATE_PRICE_SNAPSHOT', false);
    }
    codes.add(stock.code);
    if (stock.changePct !== undefined && !Number.isFinite(stock.changePct)) throw new IngestionError('INVALID_CHANGE_PCT', 'VALIDATE_PRICE_SNAPSHOT', false);
    if (stock.intraday !== undefined && (!Array.isArray(stock.intraday) || stock.intraday.length > 40 || stock.intraday.some(point =>
      !point || !Number.isFinite(point.price) || point.price <= 0 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\+09:00$/.test(point.observedAtKst)))) {
      throw new IngestionError('INVALID_INTRADAY', 'VALIDATE_PRICE_SNAPSHOT', false);
    }
  }
  return snapshot as PriceSnapshot;
}

function priceSnapshotKey(radarId: string): string {
  const [, year, month, day, time] = radarId.match(/^(\d{4})(\d{2})(\d{2})-(\d{4})$/) ?? [];
  if (!year || !month || !day || !time) throw new IngestionError('INVALID_RADAR_ID', 'BUILD_PRICE_SNAPSHOT_KEY', false);
  return `prices/${year}/${month}/${day}/${time}.json`;
}

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try { return await object.json<T>(); }
  catch { throw new IngestionError('INVALID_EXISTING_JSON', 'READ_R2', false); }
}

async function authorized(request: Request, secret: string): Promise<boolean> {
  const supplied = request.headers.get('Authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = supplied.length ^ expected.length;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function publicFailure(operationId: string, radarId: string, error: unknown): PublicResult {
  const known = error instanceof IngestionError ? error : new IngestionError('INTERNAL_ERROR', 'RUNTIME', true);
  return {
    operationId,
    radarId,
    status: 'FAILED',
    verified: false,
    stage: known.stage,
    retryable: known.retryable,
    error: { code: known.code },
    completedAtKst: nowKst(),
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
