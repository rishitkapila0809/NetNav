import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createMeasurementServer, validateMeasurement } from '../server/index.js';
import { NetworkMeasurerService } from '../src/services/networkMeasurer.ts';

describe('Network Measurer Service with Real Server Tests', () => {
  let server: http.Server;
  const TEST_PORT = 3099;
  const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
  let measurer: NetworkMeasurerService;

  before(async () => {
    server = createMeasurementServer();
    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, '127.0.0.1', () => resolve());
    });
    measurer = new NetworkMeasurerService({
      serverUrl: SERVER_URL,
      probeTimeoutMs: 1500,
      downloadTimeoutMs: 3000,
      uploadTimeoutMs: 3000,
      downloadBytes: 64 * 1024, // 64 KB for quick test
      uploadBytes: 32 * 1024, // 32 KB for quick test
      initialDownloadBytes: 32 * 1024,
      initialUploadBytes: 16 * 1024
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  test('measureProbe returns genuine latency and success from live server', async () => {
    const { latencyMs, isSuccess } = await measurer.measureProbe();
    assert.strictEqual(isSuccess, true);
    assert.ok(latencyMs >= 0, `Expected latencyMs >= 0, got ${latencyMs}`);
  });

  test('measureDownloadThroughput calculates genuine Mbps from bytes and elapsed time', async () => {
    const mbps = await measurer.measureDownloadThroughput(64 * 1024);
    assert.ok(typeof mbps === 'number', 'Expected number');
    assert.ok(mbps > 0, `Expected positive Mbps, got ${mbps}`);
  });

  test('measureUploadThroughput calculates genuine Mbps from bytes sent and elapsed time', async () => {
    const mbps = await measurer.measureUploadThroughput(32 * 1024);
    assert.ok(typeof mbps === 'number', 'Expected number');
    assert.ok(mbps > 0, `Expected positive Mbps, got ${mbps}`);
  });

  test('measureSample produces complete LiveMeasurement with genuine metrics', async () => {
    measurer.resetSession();
    const sample = await measurer.measureSample(12.9692, 79.1559, 10, 'Jio', 45, 1.2);

    assert.ok(sample.id.startsWith('meas-'));
    assert.strictEqual(sample.latitude, 12.9692);
    assert.strictEqual(sample.longitude, 79.1559);
    assert.strictEqual(sample.accuracy, 10);
    assert.strictEqual(sample.operator, 'Jio');
    assert.strictEqual(sample.signalStatus, 'UNAVAILABLE');
    assert.strictEqual(sample.signalDbm, undefined);
    assert.equal(sample.measurementMethodVersion, 'quality-v2');
    assert.equal(sample.throughputTestPerformed, true);
    assert.ok(sample.nqs >= 0 && sample.nqs <= 100, `NQS should be in range 0-100, got ${sample.nqs}`);
    assert.ok(['EXCELLENT', 'GOOD', 'MODERATE', 'POOR', 'UNAVAILABLE'].includes(sample.status));
    if (sample.status === 'UNAVAILABLE') assert.equal(sample.nqsComponents?.raw, null, 'early-session partial metrics do not produce a displayable NQS');
    assert.ok(sample.downloadMbps > 0, 'Download throughput should be positive');
    assert.ok(sample.uploadMbps > 0, 'Upload throughput should be positive');
      assert.equal(sample.metricAvailability?.jitter, false, 'First sample has no previous probe from which to calculate jitter');
      assert.equal(sample.nqsComponents?.jitter, null);
  });

  test('Failed probe against unreachable port records failure and updates probe failure rate', async () => {
    const badMeasurer = new NetworkMeasurerService({
      serverUrl: 'http://127.0.0.1:49999', // Non-existent port
      probeTimeoutMs: 400
    });

    const probe = await badMeasurer.measureProbe();
    assert.strictEqual(probe.isSuccess, false);
    assert.strictEqual(probe.latencyMs, 0);

    const sample1 = await badMeasurer.measureSample(12.9692, 79.1559, 10, 'Airtel');
    assert.strictEqual(sample1.probeFailurePercent, 100);
    assert.equal(sample1.metricAvailability?.probeFailure, false, 'the one-sample startup window is not a stable failure rate');
    assert.equal(sample1.status, 'UNAVAILABLE');
  });

  test('3 consecutive probe failures triggers NO_CONNECTIVITY offline classification', async () => {
    const badMeasurer = new NetworkMeasurerService({
      serverUrl: 'http://127.0.0.1:49999',
      probeTimeoutMs: 300
    });

    // 1st failure
    const s1 = await badMeasurer.measureSample(12.9692, 79.1559, 10, 'Vi');
    assert.strictEqual(s1.isOffline, false);

    // 2nd failure
    const s2 = await badMeasurer.measureSample(12.9692, 79.1559, 10, 'Vi');
    assert.strictEqual(s2.isOffline, false);

    // 3rd failure -> classified as NO_CONNECTIVITY
    const s3 = await badMeasurer.measureSample(12.9692, 79.1559, 10, 'Vi');
    assert.strictEqual(s3.isOffline, true);
    assert.strictEqual(s3.status, 'NO_CONNECTIVITY');
    assert.strictEqual(s3.nqs, 0);
    assert.strictEqual(s3.offlineReason, 'MEASUREMENT_SERVER_UNREACHABLE');
    assert.strictEqual(s3.probeFailurePercent, 100);
    assert.equal(s3.metricAvailability?.latency, false);
    assert.equal(s3.metricAvailability?.jitter, false);
  });

  test('NQS excludes missing metrics and renormalizes over the remaining measured weights', () => {
    const result = measurer.calculateNqs({ latencyMs: 15, downloadMbps: 100, probeFailurePercent: 0, jitterMs: 0,
      availability: { latency: true, download: true, probeFailure: true, jitter: false } });
    assert.deepStrictEqual(result.scores, { latency: 100, throughput: 100, probeFailure: 100, jitter: null });
    assert.equal(result.raw, 100);
    assert.equal(result.nqs, 100);
  });

  test('NQS low throughput and high latency produce their intended low component scores', () => {
    assert.equal(measurer.calcThroughputScore(1), 1);
    assert.equal(measurer.calcThroughputScore(1000), 100);
    assert.equal(measurer.calcLatencyScore(300), 0);
    assert.equal(measurer.calcLatencyScore(15), 100);
    const result = measurer.calculateNqs({ latencyMs: 600, downloadMbps: 1, probeFailurePercent: 20, jitterMs: 100,
      availability: { latency: true, download: true, probeFailure: true, jitter: true } });
    assert.deepStrictEqual(result.scores, { latency: 0, throughput: 1, probeFailure: 0, jitter: 0 });
    assert.ok(result.nqs < 1);
  });

  test('controlled excellent, moderate, mixed, and poor cases preserve the locked formula', () => {
    const cases = [
      { name: 'excellent', input: { latencyMs: 10, downloadMbps: 100, probeFailurePercent: 0, jitterMs: 1 }, scores: [100, 100, 100, 100], raw: 100, final: 100 },
      { name: 'moderate', input: { latencyMs: 100, downloadMbps: 50, probeFailurePercent: 10, jitterMs: 20 }, scores: [70, 50, 50, 63], raw: 57.411764705882355, final: 57 },
      { name: 'mixed', input: { latencyMs: 30, downloadMbps: 5, probeFailurePercent: 10, jitterMs: 20 }, scores: [95, 5, 50, 63], raw: 48.88235294117647, final: 49 },
      { name: 'poor', input: { latencyMs: 500, downloadMbps: 0, probeFailurePercent: 25, jitterMs: 60 }, scores: [0, 0, 0, 0], raw: 0, final: 0 }
    ];
    for (const row of cases) {
      const result = measurer.calculateNqs({ ...row.input, availability: { latency: true, download: true, probeFailure: true, jitter: true } });
      assert.deepEqual([result.scores.latency, result.scores.throughput, result.scores.probeFailure, result.scores.jitter], row.scores, row.name);
      assert.equal(result.available, true);
      assert.ok(result.raw !== null && Math.abs(result.raw - row.raw) < 1e-12, `${row.name}: raw score ${result.raw}`);
      assert.equal(result.nqs, row.final);
      const serverRow = validateMeasurement({
        id: `controlled-${row.name}`, operator: 'Jio', latitude: 12.9, longitude: 79.1, accuracy: 5,
        timestamp: new Date().toISOString(), ...row.input, uploadMbps: 10, signalStatus: 'UNAVAILABLE',
        measurementMethodVersion: 'quality-v2',
        metricAvailability: { latency: true, download: true, upload: true, probeFailure: true, jitter: true, signal: false }
      });
      assert.equal(serverRow.nqs, result.nqs, `client/server formula parity for ${row.name}`);
    }
  });

  test('insufficient valid metric weight is unavailable instead of producing a perfect one-metric score', () => {
    const result = measurer.calculateNqs({ latencyMs: Number.NaN, downloadMbps: -1, probeFailurePercent: 2, jitterMs: 1,
      availability: { latency: true, download: true, probeFailure: false, jitter: true } });
    assert.deepEqual(result.scores, { latency: null, throughput: null, probeFailure: null, jitter: 100 });
    assert.equal(result.available, false);
    assert.equal(result.raw, null);
    assert.equal(result.nqs, 0, '0 remains an internal sentinel when evidence is insufficient');
    const sufficient = measurer.calculateNqs({ latencyMs: 15, downloadMbps: 100, probeFailurePercent: 0, jitterMs: 0,
      availability: { latency: true, download: true, probeFailure: true, jitter: false } });
    assert.equal(sufficient.available, true, '0.75 available weight meets the documented minimum');
    assert.equal(sufficient.nqs, 100);
    const empty = measurer.calculateNqs({ latencyMs: 0, downloadMbps: 0, probeFailurePercent: 0, jitterMs: 0,
      availability: { latency: false, download: false, probeFailure: false, jitter: false } });
    assert.equal(empty.available, false);
    assert.equal(empty.nqs, 0, '0 is only an internal sentinel when available=false');
    assert.equal(measurer.getNqsStatus(null), 'UNAVAILABLE');
  });

  test('genuinely excellent available measurements produce 100; integer rounding can also reach 100 below the ceiling', () => {
    const excellent = measurer.calculateNqs({ latencyMs: 15, downloadMbps: 100, probeFailurePercent: 0, jitterMs: 2,
      availability: { latency: true, download: true, probeFailure: true, jitter: true } });
    assert.equal(excellent.raw, 100);
    assert.equal(excellent.nqs, 100);
    const rounded = measurer.calculateNqs({ latencyMs: 15, downloadMbps: 100, probeFailurePercent: 0, jitterMs: 3,
      availability: { latency: true, download: true, probeFailure: true, jitter: true } });
    assert.ok(rounded.raw < 100 && rounded.raw >= 99.5);
    assert.equal(rounded.nqs, 100);
  });

  test('localhost probes still run when navigator.onLine reports false', async () => {
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
    try {
      const localMeasurer = new NetworkMeasurerService({ serverUrl: SERVER_URL, initialDownloadBytes: 1024, initialUploadBytes: 1024 });
      const sample = await localMeasurer.measureSample(12.9, 79.1, 10, 'Jio');
      assert.equal(sample.isOffline, false);
      assert.equal(sample.metricAvailability?.latency, true);
    } finally {
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }
  });

  test('failed probes recover on the next successful response and failure window is retained', async () => {
    let probeCount = 0;
    const flaky = http.createServer((req, res) => {
      if (req.url?.startsWith('/probe')) {
        probeCount++;
        if (probeCount <= 3) { res.writeHead(503); res.end('unavailable'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
      }
      if (req.url?.startsWith('/download')) { const body = Buffer.alloc(2048); res.writeHead(200, { 'Content-Length': body.length }); res.end(body); return; }
      if (req.url?.startsWith('/upload')) { let size = 0; req.on('data', chunk => size += chunk.length); req.on('end', () => { const body = JSON.stringify({ ok: true, bytesReceived: size }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); }); return; }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((resolve) => flaky.listen(0, '127.0.0.1', resolve));
    const address = flaky.address(); assert.ok(address && typeof address !== 'string');
    const recovery = new NetworkMeasurerService({ serverUrl: `http://127.0.0.1:${address.port}`, initialDownloadBytes: 1024, initialUploadBytes: 1024 });
    try {
      const first = await recovery.measureSample(12.9, 79.1, 10, 'Vi');
      const second = await recovery.measureSample(12.9, 79.1, 10, 'Vi');
      const third = await recovery.measureSample(12.9, 79.1, 10, 'Vi');
      assert.equal(first.isOffline, false);
      assert.equal(second.isOffline, false);
      assert.equal(third.isOffline, true);
      assert.equal(third.probeFailurePercent, 100);
      const recovered = await recovery.measureSample(12.9, 79.1, 10, 'Vi');
      assert.equal(recovered.isOffline, false);
      assert.equal(recovered.metricAvailability?.latency, true);
    } finally { await new Promise<void>((resolve, reject) => flaky.close((error) => error ? reject(error) : resolve())); }
  });
});
