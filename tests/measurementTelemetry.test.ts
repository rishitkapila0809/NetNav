import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { LiveMeasurement } from '../src/types.ts';
import { calculateMeasurementNqs, selectLatestPersistedMeasurement, selectTelemetryMeasurement, telemetryEmptyMessage } from '../src/services/measurementTelemetry.ts';

const base: LiveMeasurement = {
  id: 'a', operator: 'Jio', latitude: 12.9692, longitude: 79.1559, accuracy: 7, timestamp: '2026-10-26T10:00:00Z',
  latencyMs: 15, downloadMbps: 100, uploadMbps: 10, jitterMs: 2, probeFailurePercent: 0, signalStatus: 'UNAVAILABLE', nqs: 100, status: 'EXCELLENT',
  metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: false }
};

describe('measurement-backed telemetry', () => {
  test('recalculates NQS from all available normalized L/T/P/J components', () => {
    const full = calculateMeasurementNqs(base);
    assert.equal(full.nqs, 100);
    assert.equal(full.verification, 'match');
    assert.equal(full.availableWeight, 0.85);
    assert.deepEqual(full.components.map((component) => component.score), [100, 100, 100, 100, null]);
    const changed = { ...base, latencyMs: 300, downloadMbps: 0, probeFailurePercent: 20, jitterMs: 50, nqs: 0, status: 'POOR' as const };
    assert.equal(calculateMeasurementNqs(changed).nqs, 0);
    assert.equal(calculateMeasurementNqs(changed).verification, 'match');
  });

  test('excludes genuinely unavailable metrics and renormalizes remaining weights', () => {
    const partial = { ...base, latencyMs: 300, downloadMbps: 0, probeFailurePercent: 0, jitterMs: 50, nqs: 67,
      metricAvailability: { latency: true, download: false, upload: false, jitter: false, probeFailure: true, signal: false } };
    assert.equal(calculateMeasurementNqs(partial).nqs, 44);
    assert.equal(calculateMeasurementNqs(partial).verification, 'mismatch');
    assert.equal(calculateMeasurementNqs({ ...partial, metricAvailability: { latency: false, download: false, upload: false, jitter: false, probeFailure: false, signal: false } }).nqs, null);
  });

  test('reports unsupported signal normalization and never rewrites a stored score', () => {
    const row = { ...base, nqs: 73, metricAvailability: { ...base.metricAvailability, signal: true } };
    const result = calculateMeasurementNqs(row);
    assert.equal(result.nqs, null);
    assert.equal(result.verification, 'unsupported-signal');
    assert.equal(row.nqs, 73);
  });

  test('marks records with no valid scoring components unavailable and identifies legacy method rows', () => {
    const noMetrics = { ...base, metricAvailability: { latency: false, download: false, upload: false, jitter: false, probeFailure: false, signal: false } };
    assert.equal(calculateMeasurementNqs(noMetrics).nqs, null);
    const legacy = calculateMeasurementNqs({ ...base, measurementMethodVersion: 'legacy-v1' });
    assert.equal(legacy.nqs, null);
    assert.equal(legacy.verification, 'legacy-method');
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
