import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { LiveMeasurement } from '../src/types.ts';
import { calculateMeasurementNqs, selectLatestPersistedMeasurement, selectTelemetryMeasurement, telemetryEmptyMessage } from '../src/services/measurementTelemetry.ts';

const base: LiveMeasurement = {
  id: 'a', operator: 'Jio', latitude: 12.9692, longitude: 79.1559, accuracy: 7, timestamp: '2026-10-26T10:00:00Z',
  latencyMs: 15, downloadMbps: 100, uploadMbps: 10, jitterMs: 2, packetLossPercent: 0, signalStatus: 'UNAVAILABLE', nqs: 100, status: 'EXCELLENT',
  metricAvailability: { latency: true, download: true, upload: true, jitter: true, packetLoss: true, signal: false }
};

describe('measurement-backed telemetry', () => {
  test('recalculates NQS from all available normalized L/T/P/J components', () => {
    assert.deepEqual(calculateMeasurementNqs(base), { nqs: 100, verification: 'match' });
    const changed = { ...base, latencyMs: 300, downloadMbps: 0, packetLossPercent: 20, jitterMs: 50, nqs: 0, status: 'POOR' as const };
    assert.deepEqual(calculateMeasurementNqs(changed), { nqs: 0, verification: 'match' });
  });

  test('excludes genuinely unavailable metrics and renormalizes remaining weights', () => {
    const partial = { ...base, latencyMs: 300, downloadMbps: 0, packetLossPercent: 0, jitterMs: 50, nqs: 67,
      metricAvailability: { latency: true, download: false, upload: false, jitter: false, packetLoss: true, signal: false } };
    assert.deepEqual(calculateMeasurementNqs(partial), { nqs: 44, verification: 'mismatch' });
    assert.equal(calculateMeasurementNqs({ ...partial, metricAvailability: { latency: false, download: false, upload: false, jitter: false, packetLoss: false, signal: false } }).nqs, null);
  });

  test('reports unsupported signal normalization and never rewrites a stored score', () => {
    const row = { ...base, nqs: 73, metricAvailability: { ...base.metricAvailability, signal: true } };
    assert.deepEqual(calculateMeasurementNqs(row), { nqs: null, verification: 'unsupported-signal' });
    assert.equal(row.nqs, 73);
  });

  test('restores latest saved row for operator and lets a newer matching live sample take precedence', () => {
    const saved = [{ ...base, id: 'old', timestamp: '2026-10-25T10:00:00Z' }, { ...base, id: 'saved-new', timestamp: '2026-10-26T09:00:00Z' },
      { ...base, id: 'airtel', operator: 'Airtel' as const, timestamp: '2026-10-26T09:59:00Z' }];
    const latest = selectLatestPersistedMeasurement(saved, 'Jio');
    assert.equal(latest?.id, 'saved-new');
    assert.equal(selectLatestPersistedMeasurement(saved, 'Vi'), null);
    assert.deepEqual(selectTelemetryMeasurement([{ ...base, id: 'live', timestamp: '2026-10-26T10:01:00Z' }], latest, 'Jio'), { measurement: { ...base, id: 'live', timestamp: '2026-10-26T10:01:00Z' }, source: 'live' });
    assert.equal(selectTelemetryMeasurement([{ ...base, operator: 'Airtel' }], latest, 'Jio').measurement?.id, 'saved-new');
  });

  test('uses explicit unavailable state rather than defaulting to a perfect or mock score', () => {
    assert.deepEqual(selectTelemetryMeasurement([], null, 'Jio'), { measurement: null, source: null });
    assert.match(telemetryEmptyMessage('loaded', 'Jio'), /No valid live or saved measurement/);
    assert.equal(calculateMeasurementNqs({ ...base, isOffline: true }).nqs, null);
  });
});
