import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, findBestSpot, type BestSpotGps } from '../src/services/bestSpot.ts';
import type { LiveMeasurement, TelecomOperator } from '../src/types.ts';

const now = Date.parse('2026-10-25T12:00:00.000Z');
const gps: BestSpotGps = { lat: 12.9692, lng: 79.1559, accuracy: 3, timestamp: now };
function row(id: string, options: Partial<LiveMeasurement> = {}): LiveMeasurement {
  return {
    id, latitude: gps.lat, longitude: gps.lng, accuracy: 4, timestamp: new Date(now - 60_000).toISOString(),
    operator: 'Jio', latencyMs: 20, downloadMbps: 50, uploadMbps: 10, jitterMs: 3, probeFailurePercent: 1,
    signalDbm: undefined, signalStatus: 'UNAVAILABLE', nqs: 80, status: 'EXCELLENT',
    metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: false },
    ...options
  };
}

describe('Find Best Spot persisted measurement search', () => {
  test('calculates geographic distance in metres', () => {
    assert.equal(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
    const oneDegree = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    assert.ok(oneDegree > 111_000 && oneDegree < 111_300);
  });

  test('includes records within the configurable 10 m radius and excludes outside records', () => {
    const near = row('near', { latitude: gps.lat + 0.00004 });
    const far = row('far', { latitude: gps.lat + 0.00011 });
    const result = findBestSpot([near, far], 'Jio', gps, now);
    assert.equal(result.status, 'success');
    if (result.status === 'success') assert.equal(result.candidate.sampleCount, 1);
    assert.equal(findBestSpot([far], 'Jio', gps, now).status, 'no-data');
  });

  test('filters records to the explicitly selected operator', () => {
    const result = findBestSpot([row('jio'), row('airtel', { operator: 'Airtel' })], 'Airtel', gps, now);
    assert.equal(result.status, 'success');
    if (result.status === 'success') assert.equal(result.candidate.operator, 'Airtel');
  });

  test('does not rank legacy sampling or historical fixes with more than ten-metre accuracy', () => {
    const legacy = row('legacy', { measurementMethodVersion: 'legacy-v1' });
    const inaccurate = row('inaccurate', { accuracy: 10.1 });
    assert.equal(findBestSpot([legacy, inaccurate], 'Jio', gps, now).status, 'no-data');
    assert.equal(findBestSpot([row('eligible', { accuracy: 10 })], 'Jio', gps, now).status, 'success');
  });

  test('groups repeated readings within five metres into one candidate spot', () => {
    const records = [row('a'), row('b', { latitude: gps.lat + 0.00001 }), row('c', { longitude: gps.lng + 0.00001 })];
    const result = findBestSpot(records, 'Jio', gps, now);
    assert.equal(result.status, 'success');
    if (result.status === 'success') {
      assert.equal(result.candidate.sampleCount, 3);
      assert.ok(records.some((record) => record.latitude === result.candidate.latitude && record.longitude === result.candidate.longitude), 'map coordinate comes from a persisted fix');
    }
  });

  test('ranking considers NQS, sample support, recency, and recorded GPS accuracy', () => {
    const repeatGroup = [0, 1, 2].map((i) => row(`repeat-${i}`, { nqs: 72, latitude: gps.lat + i * 0.000005 }));
    const lonePerfect = row('single-perfect', { nqs: 100, longitude: gps.lng + 0.00007 });
    const repeatedResult = findBestSpot([...repeatGroup, lonePerfect], 'Jio', gps, now);
    assert.equal(repeatedResult.status, 'success');
    if (repeatedResult.status === 'success') assert.equal(repeatedResult.candidate.sampleCount, 3, 'single perfect sample should not dominate repeated local evidence');

    const same = [row('accurate', { latitude: gps.lat, longitude: gps.lng, accuracy: 2 }), row('rough', { latitude: gps.lat + 0.00007, accuracy: 20 })];
    const accuracyResult = findBestSpot(same, 'Jio', gps, now);
    assert.equal(accuracyResult.status, 'success');
    if (accuracyResult.status === 'success') assert.equal(accuracyResult.candidate.averageAccuracy, 2);

    const recencyRows = [row('old', { latitude: gps.lat, longitude: gps.lng, nqs: 90, timestamp: new Date(now - 90 * 86_400_000).toISOString() }),
      row('recent', { latitude: gps.lat + 0.00007, nqs: 89, timestamp: new Date(now - 86_400_000).toISOString() })];
    const recencyResult = findBestSpot(recencyRows, 'Jio', gps, now);
    assert.equal(recencyResult.status, 'success');
    if (recencyResult.status === 'success') assert.equal(recencyResult.candidate.latitude, recencyRows[1].latitude);
  });

  test('rejects missing, stale, malformed, future, and insufficient-accuracy GPS fixes', () => {
    assert.equal(findBestSpot([row('a')], 'Jio', null, now).status, 'gps-unavailable');
    assert.equal(findBestSpot([row('a')], 'Jio', { ...gps, timestamp: now - 30_001 }, now).status, 'gps-stale');
    assert.equal(findBestSpot([row('a')], 'Jio', { ...gps, accuracy: 10.1 }, now).status, 'gps-inaccurate');
    assert.equal(findBestSpot([row('a')], 'Jio', { ...gps, lat: 91 }, now).status, 'gps-invalid');
    assert.equal(findBestSpot([row('a')], 'Jio', { ...gps, timestamp: now + 1 }, now).status, 'gps-stale');
  });

  test('returns a true no-data result for no nearby valid rows and handles malformed records', () => {
    const malformed = row('bad', { latitude: Number.NaN });
    const otherOperator = row('other-op', { operator: 'Vi' as TelecomOperator });
    assert.equal(findBestSpot([malformed, otherOperator], 'Jio', gps, now).status, 'no-data');
  });

  test('missing and unavailable metrics remain unavailable instead of becoming zero', () => {
    const result = findBestSpot([row('no-metrics', { latencyMs: 0, downloadMbps: 0, uploadMbps: 0, jitterMs: 0, probeFailurePercent: 0,
      metricAvailability: { latency: false, download: false, upload: false, jitter: false, probeFailure: false, signal: false } })], 'Jio', gps, now);
    assert.equal(result.status, 'success');
    if (result.status === 'success') {
      assert.equal(result.candidate.metrics.latencyMs, undefined);
      assert.equal(result.candidate.metricAvailability.latency, false);
      assert.equal(result.candidate.metrics.signalDbm, undefined);
    }
  });
});
