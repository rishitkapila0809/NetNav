import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMeasurementServer, parseAllowedOrigins, validateMeasurement, saveMeasurement, listMeasurements } from '../server/index.js';
import { buildMeasurementRequestPayload } from '../src/services/measurementPayload.ts';
import type { LiveMeasurement } from '../src/types.ts';

const valid = {
  id: 'sample-1', operator: 'Jio', latitude: 12.9692, longitude: 79.1559, accuracy: 8,
  timestamp: '2026-10-25T10:00:00.000Z', latencyMs: 30, downloadMbps: 50, uploadMbps: 12,
  jitterMs: 5, probeFailurePercent: 0, signalStatus: 'UNAVAILABLE', measurementMethodVersion: 'quality-v2'
};

describe('Measurement API validation and persistence contract', () => {
  test('CORS allows configured origins, rejects others, and supports requests without Origin', async () => {
    const server = createMeasurementServer({
      db: { async query() { return { rows: [] }; } },
      allowedOrigins: parseAllowedOrigins('https://netnav.example, https://preview.example')
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/health`;
    try {
      const allowed = await fetch(url, { headers: { Origin: 'https://netnav.example' } });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://netnav.example');

      const rejected = await fetch(url, { headers: { Origin: 'https://attacker.example' } });
      assert.equal(rejected.status, 403);
      assert.equal(rejected.headers.get('access-control-allow-origin'), null);

      const localTool = await fetch(url);
      assert.equal(localTool.status, 200);
      assert.equal(localTool.headers.get('access-control-allow-origin'), null);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  test('CORS preflight grants configured origins and rejects unapproved origins', async () => {
    const server = createMeasurementServer({ allowedOrigins: new Set(['https://netnav.example']) });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/measurements`;
    try {
      const allowed = await fetch(url, {
        method: 'OPTIONS',
        headers: { Origin: 'https://netnav.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
      });
      assert.equal(allowed.status, 204);
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://netnav.example');
      assert.match(allowed.headers.get('access-control-allow-methods') ?? '', /POST/);

      const rejected = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://attacker.example' } });
      assert.equal(rejected.status, 403);
      assert.equal(rejected.headers.get('access-control-allow-origin'), null);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  test('CORS configuration accepts only exact HTTP(S) origins', () => {
    assert.deepEqual([...parseAllowedOrigins('https://netnav.example, http://localhost:5173')], ['https://netnav.example', 'http://localhost:5173']);
    assert.throws(() => parseAllowedOrigins('*'), /exact http\(s\) origins/);
    assert.throws(() => parseAllowedOrigins('https://netnav.example/path'), /without paths/);
  });

  test('accepts valid measurement and recalculates NQS', () => {
    const result = validateMeasurement({ ...valid, nqs: 0 });
    assert.equal(result.nqs, 80);
    assert.equal(result.metricAvailability.signal, false);
  });

  test('accepts and preserves a valid lower-confidence browser GPS accuracy', () => {
    const result = validateMeasurement({ ...valid, accuracy: 64 });
    assert.equal(result.accuracy, 64);
  });

  test('accepts legacy packetLoss payloads but stores them as HTTP probe failures with a legacy version', () => {
    const oldClient = validateMeasurement({ ...valid, measurementMethodVersion: 'legacy-v1', probeFailurePercent: undefined,
      packetLossPercent: 10, metricAvailability: { latency: true, download: true, upload: true, jitter: true, packetLoss: true, signal: false } });
    assert.equal(oldClient.probeFailurePercent, 10);
    assert.equal(oldClient.metricAvailability.probeFailure, true);
    assert.equal(oldClient.metricAvailability.packetLoss, undefined);
    assert.equal(oldClient.measurementMethodVersion, 'legacy-v1');
  });

  test('accepts the client compatibility alias while preserving HTTP probe-failure semantics', () => {
    const compatible = validateMeasurement({ ...valid, probeFailurePercent: 12.5, packetLossPercent: 12.5,
      metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, packetLoss: true, signal: false } });
    assert.equal(compatible.probeFailurePercent, 12.5);
    assert.equal(compatible.metricAvailability.probeFailure, true);
    assert.equal(compatible.metricAvailability.packetLoss, undefined);
  });

  test('server rejects out-of-range, non-finite, and malformed legacy alias values', () => {
    const availability = { latency: true, download: true, upload: true, jitter: true, probeFailure: true, packetLoss: true, signal: false };
    for (const packetLossPercent of [-0.1, 100.1, Number.NaN, Number.POSITIVE_INFINITY, '12.5']) {
      assert.throws(() => validateMeasurement({ ...valid, probeFailurePercent: undefined, packetLossPercent, metricAvailability: availability }), /Invalid probeFailurePercent/);
    }
  });

  test('client payload emits numeric aliases only for available finite probe failure data', () => {
    const sample = { ...valid, status: 'GOOD', metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: false } } as LiveMeasurement;
    const zero = buildMeasurementRequestPayload({ ...sample, probeFailurePercent: 0 });
    assert.equal(zero.probeFailurePercent, 0);
    assert.equal(zero.packetLossPercent, 0);
    assert.equal((zero.metricAvailability as Record<string, unknown>).packetLoss, true);
    const nonzero = buildMeasurementRequestPayload({ ...sample, probeFailurePercent: 12.5 });
    assert.equal(nonzero.packetLossPercent, 12.5);
    const unavailable = buildMeasurementRequestPayload({ ...sample, probeFailurePercent: 0,
      metricAvailability: { ...sample.metricAvailability, probeFailure: false } });
    assert.equal(unavailable.probeFailurePercent, null);
    assert.equal(unavailable.packetLossPercent, null);
    assert.equal((unavailable.metricAvailability as Record<string, unknown>).packetLoss, false);
    assert.throws(() => buildMeasurementRequestPayload({ ...sample, probeFailurePercent: Number.NaN }), /finite percentage/);
    assert.throws(() => buildMeasurementRequestPayload({ ...sample, probeFailurePercent: Number.POSITIVE_INFINITY }), /finite percentage/);
    assert.throws(() => buildMeasurementRequestPayload({ ...sample, probeFailurePercent: 100.1 }), /finite percentage/);
    assert.throws(() => buildMeasurementRequestPayload({ ...sample, probeFailurePercent: -0.1 }), /finite percentage/);
    assert.throws(() => buildMeasurementRequestPayload({ ...sample, probeFailurePercent: '0' as unknown as number }), /finite percentage/);
  });

  test('rejects invalid operator, coordinates, numeric ranges, timestamps and metadata', () => {
    for (const value of [
      { ...valid, operator: 'Other' }, { ...valid, latitude: 91 }, { ...valid, longitude: Infinity },
      { ...valid, accuracy: -1 }, { ...valid, accuracy: 10000.1 }, { ...valid, latencyMs: -1 }, { ...valid, downloadMbps: NaN },
      { ...valid, probeFailurePercent: 101 }, { ...valid, timestamp: 'not a date' },
      { ...valid, timestamp: '2999-01-01T00:00:00.000Z' },
      { ...valid, metricAvailability: { signal: 'no' } },
      { ...valid, probeFailurePercent: undefined, packetLossPercent: 101, metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, packetLoss: true, signal: false } },
      { ...valid, packetLossPercent: '10', probeFailurePercent: undefined, metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, packetLoss: true, signal: false } },
      { ...valid, signalDbm: -96, signalStatus: 'AVAILABLE', metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: true } }
    ]) assert.throws(() => validateMeasurement(value));
  });

  test('refuses to persist an NQS when every score component is unavailable', () => {
    assert.throws(() => validateMeasurement({ ...valid, probeFailurePercent: null, packetLossPercent: null,
      metricAvailability: { latency: false, download: false, upload: false, jitter: false, probeFailure: false, signal: false } }), /enough valid metrics/);
    assert.throws(() => validateMeasurement({ ...valid, probeFailurePercent: null, packetLossPercent: null,
      metricAvailability: { latency: false, download: false, upload: false, jitter: true, probeFailure: false, signal: false } }), /enough valid metrics/);
  });

  test('unavailable probe failure is explicit null, never a fabricated zero, and is rejected as insufficient for scoring', () => {
    assert.throws(() => validateMeasurement({ ...valid, probeFailurePercent: null, packetLossPercent: null,
      metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: false, packetLoss: false, signal: false } }), /enough valid metrics/);
    assert.throws(() => validateMeasurement({ ...valid, probeFailurePercent: 0, packetLossPercent: 0,
      metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: false, packetLoss: false, signal: false } }), /must be null when.*unavailable/);
  });

  test('uses parameterized SQL for insert and bounded filtered retrieval', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = { async query(sql: string, values: unknown[] = []) { calls.push({ sql, values }); return { rows: [{ id: 'sample-1' }] }; } };
    await saveMeasurement(valid, db);
    await listMeasurements({ operator: 'Jio', limit: 20 }, db);
    await listMeasurements({ operator: 'Jio', limit: 20, before: '2026-10-25T10:00:00.000Z', beforeId: 'sample-1' }, db);
    assert.match(calls[0].sql, /VALUES \(\$1/);
    assert.equal(calls[0].values[1], 'Jio');
    assert.match(calls[1].sql, /operator = \$1/);
    assert.equal(calls[1].values.at(-1), 20);
    assert.match(calls[2].sql, /\(measured_at, id\) < \(\$2::timestamptz, \$3::text\)/);
    assert.deepEqual(calls[2].values, ['Jio', '2026-10-25T10:00:00.000Z', 'sample-1', 20]);
    assert.deepEqual(JSON.parse(String(calls[0].values[13])), { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: false, _methodVersion: 'quality-v2' });
    await assert.rejects(listMeasurements({ beforeId: 'sample-1' }, db), /Invalid before cursor/);
  });

  test('HTTP API saves, lists, rejects invalid payload and handles storage failure', async () => {
    let rows: Record<string, unknown>[] = [];
    const db = { async query(sql: string, values: unknown[] = []) {
      if (sql.startsWith('INSERT')) {
        const row = { id: values[0], operator: values[1], latitude: values[2], longitude: values[3], accuracy: values[4], timestamp: values[5], latencyMs: values[6], downloadMbps: values[7], uploadMbps: values[8], jitterMs: values[9], probeFailurePercent: values[10], nqs: values[11], signalDbm: values[12], signalStatus: 'UNAVAILABLE', metricAvailability: JSON.parse(String(values[13])) };
        rows.push(row); return { rows: [row] };
      }
      if (sql.startsWith('SELECT')) return { rows };
      throw new Error('unexpected SQL');
    } };
    const server = createMeasurementServer({ db });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const legacyFieldPayload = { ...valid, probeFailurePercent: undefined, packetLossPercent: 0,
        metricAvailability: { latency: true, download: true, upload: true, jitter: true, packetLoss: true, signal: false } };
      const saved = await fetch(`${base}/api/measurements`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(legacyFieldPayload) });
      assert.equal(saved.status, 201);
      const savedBody = await saved.json() as Record<string, unknown>;
      assert.equal(savedBody.id, valid.id);
      assert.equal(savedBody.probeFailurePercent, 0, 'legacy alias zero is preserved as an observed HTTP probe failure rate');
      const lowerConfidenceSave = await fetch(`${base}/api/measurements`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...valid, id: 'lower-confidence', accuracy: 64 }) });
      assert.equal(lowerConfidenceSave.status, 201);
      const lowerConfidenceRecord = await lowerConfidenceSave.json() as Record<string, unknown>;
      assert.equal(lowerConfidenceRecord.accuracy, 64);
      const listed = await fetch(`${base}/api/measurements?operator=Jio&limit=10`);
      assert.equal(listed.status, 200);
      const history = (await listed.json() as { measurements: Array<Record<string, unknown>> }).measurements;
      assert.equal(history.length, 2);
      assert.equal(history[0].downloadMbps, valid.downloadMbps);
      assert.equal(history[0].operator, valid.operator);
      assert.equal(history[0].nqs, 80, 'history returns the server-recalculated NQS for the inserted record');
      assert.equal((history[0].metricAvailability as Record<string, unknown>)._methodVersion, 'quality-v2');
      const cursorPage = await fetch(`${base}/api/measurements?operator=Jio&limit=10&before=${encodeURIComponent(valid.timestamp)}&beforeId=${valid.id}`);
      assert.equal(cursorPage.status, 200);
      const bad = await fetch(`${base}/api/measurements`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...valid, latitude: 100 }) });
      assert.equal(bad.status, 400);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  test('storage errors become service unavailable without leaking details', async () => {
    const server = createMeasurementServer({ db: { async query() { const e = new Error('private detail with credential postgresql://user:secret@host/db') as Error & { code: string }; e.code = 'ECONNREFUSED'; throw e; } } });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/measurements`);
      assert.equal(response.status, 503);
      assert.equal((await response.json() as { error: string }).error, 'Measurement storage unavailable');
      const saved = await fetch(`http://127.0.0.1:${address.port}/api/measurements`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(valid) });
      assert.equal(saved.status, 503);
      assert.equal((await saved.json() as { error: string }).error, 'Measurement storage unavailable');
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});
