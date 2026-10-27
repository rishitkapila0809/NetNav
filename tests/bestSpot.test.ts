import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bestSpotCameraPoints, distanceMeters, findBestSpot, refreshAndSearchAfterSave, searchPersistedBestSpot, type BestSpotGps } from '../src/services/bestSpot.ts';
import type { LiveMeasurement, TelecomOperator } from '../src/types.ts';

const now = Date.parse('2026-10-25T12:00:00.000Z');
const gps: BestSpotGps = { lat: 12.9692, lng: 79.1559, accuracy: 3, timestamp: now };
function row(id: string, options: Partial<LiveMeasurement> = {}): LiveMeasurement {
  return {
    id, latitude: gps.lat, longitude: gps.lng, accuracy: 4, timestamp: new Date(now - 60_000).toISOString(),
    operator: 'Jio', latencyMs: 20, downloadMbps: 50, uploadMbps: 10, jitterMs: 3, probeFailurePercent: 1,
    signalDbm: undefined, signalStatus: 'UNAVAILABLE', nqs: 80, status: 'EXCELLENT',
    measurementMethodVersion: 'quality-v2',
    metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: false },
    ...options
  };
}
function rowWithNqs(id: string, nqs: number, options: Partial<LiveMeasurement> = {}): LiveMeasurement {
  const matchingMetrics = { latencyMs: 15 + ((100 - nqs) / 100) * 285, downloadMbps: nqs, uploadMbps: 0,
    jitterMs: 2 + ((100 - nqs) / 100) * 48, probeFailurePercent: (100 - nqs) / 5 };
  return row(id, { ...matchingMetrics, nqs,
    metricAvailability: { latency: true, download: true, upload: false, jitter: true, probeFailure: true, signal: false }, ...options });
}

describe('Find Best Spot persisted measurement search', () => {
  test('calculates geographic distance in metres', () => {
    assert.equal(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
    const oneDegree = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    assert.ok(oneDegree > 111_000 && oneDegree < 111_300);
  });

  test('best-spot camera targets the actual GPS fix and persisted candidate coordinate', () => {
    const candidate = { latitude: gps.lat + 0.00004, longitude: gps.lng, nqs: 80 };
    assert.deepEqual(bestSpotCameraPoints(candidate, { lat: gps.lat, lng: gps.lng }), [
      { lat: gps.lat, lng: gps.lng }, { lat: candidate.latitude, lng: candidate.longitude }
    ]);
    assert.deepEqual(bestSpotCameraPoints(candidate, null), [{ lat: candidate.latitude, lng: candidate.longitude }]);
  });

  test('persisted history API failure remains an error and never becomes an empty search', async () => {
    const result = await searchPersistedBestSpot(async () => { throw new Error('history API unavailable'); }, 'Jio', gps, now);
    assert.equal(result.status, 'history-error');
    if (result.status === 'history-error') assert.match(result.message, /history API unavailable/);
  });

  test('a successful empty history response is a true no-data result, while a capped response is incomplete', async () => {
    const empty = await searchPersistedBestSpot(async () => ({ measurements: [], truncated: false }), 'Jio', gps, now);
    assert.equal(empty.status, 'no-data');
    const incomplete = await searchPersistedBestSpot(async () => ({ measurements: [], truncated: true }), 'Jio', gps, now);
    assert.equal(incomplete.status, 'history-incomplete');
  });

  test('refreshes persisted history before invalidating cache and rerunning search after a save', async () => {
    const order: string[] = [];
    const result = await refreshAndSearchAfterSave(async () => { order.push('refresh'); }, () => { order.push('invalidate'); }, async () => {
      order.push('search'); return 'rerun-result';
    });
    assert.deepEqual(order, ['refresh', 'invalidate', 'search']);
    assert.equal(result, 'rerun-result');
  });

  test('includes records within the configurable 10 m radius and excludes outside records', () => {
    const near = row('near', { latitude: gps.lat + 0.00004 });
    const far = row('far', { latitude: gps.lat + 0.00011 });
    const result = findBestSpot([near, far], 'Jio', gps, now);
    assert.equal(result.status, 'success');
    if (result.status === 'success') assert.equal(result.candidate.sampleCount, 1);
    assert.equal(findBestSpot([far], 'Jio', gps, now).status, 'no-data');
  });

  test('success result retains the saved coordinate, selected operator, score, and supporting timestamp', () => {
    const saved = row('saved', { latitude: gps.lat + 0.00003, longitude: gps.lng + 0.00001, timestamp: new Date(now - 5_000).toISOString() });
    const result = findBestSpot([saved], 'Jio', gps, now);
    assert.equal(result.status, 'success');
    if (result.status === 'success') {
      assert.equal(result.candidate.distanceMeters, distanceMeters(gps, { lat: saved.latitude, lng: saved.longitude }));
      assert.equal(result.candidate.latitude, saved.latitude);
      assert.equal(result.candidate.longitude, saved.longitude);
      assert.equal(result.candidate.operator, 'Jio');
      assert.equal(result.candidate.nqs, saved.nqs);
      assert.equal(result.candidate.lastMeasured, saved.timestamp);
      assert.equal(result.candidate.sampleCount, 1);
    }
  });

  test('filters records to the explicitly selected operator', () => {
    const result = findBestSpot([row('jio'), row('airtel', { operator: 'Airtel' })], 'Airtel', gps, now);
    assert.equal(result.status, 'success');
    if (result.status === 'success') assert.equal(result.candidate.operator, 'Airtel');
  });

  test('keeps legacy rows excluded while using saved GPS accuracy as a confidence input', () => {
    const legacy = row('legacy', { measurementMethodVersion: 'legacy-v1' });
    const lowerConfidence = row('lower-confidence', { accuracy: 64 });
    assert.equal(findBestSpot([legacy], 'Jio', gps, now).status, 'no-data');
    const result = findBestSpot([lowerConfidence], 'Jio', gps, now);
    assert.equal(result.status, 'success');
    if (result.status === 'success') assert.equal(result.candidate.averageAccuracy, 64);
    assert.equal(findBestSpot([row('invalid-accuracy', { accuracy: 10001 })], 'Jio', gps, now).status, 'no-data');
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
    const repeatGroup = [0, 1, 2].map((i) => rowWithNqs(`repeat-${i}`, 72, { latitude: gps.lat + i * 0.000005 }));
    const lonePerfect = rowWithNqs('single-perfect', 100, { longitude: gps.lng + 0.00007 });
    const repeatedResult = findBestSpot([...repeatGroup, lonePerfect], 'Jio', gps, now);
    assert.equal(repeatedResult.status, 'success');
    if (repeatedResult.status === 'success') assert.equal(repeatedResult.candidate.sampleCount, 3, 'single perfect sample should not dominate repeated local evidence');

    const same = [row('accurate', { latitude: gps.lat, longitude: gps.lng, accuracy: 2 }), row('rough', { latitude: gps.lat + 0.00007, accuracy: 20 })];
    const accuracyResult = findBestSpot(same, 'Jio', gps, now);
    assert.equal(accuracyResult.status, 'success');
    if (accuracyResult.status === 'success') assert.equal(accuracyResult.candidate.averageAccuracy, 2);

    const recencyRows = [rowWithNqs('old', 90, { latitude: gps.lat, longitude: gps.lng, timestamp: new Date(now - 90 * 86_400_000).toISOString() }),
      rowWithNqs('recent', 89, { latitude: gps.lat + 0.00007, timestamp: new Date(now - 86_400_000).toISOString() })];
    const recencyResult = findBestSpot(recencyRows, 'Jio', gps, now);
    assert.equal(recencyResult.status, 'success');
    if (recencyResult.status === 'success') assert.equal(recencyResult.candidate.latitude, recencyRows[1].latitude);
  });

  test('rejects missing, stale, malformed, future, and insufficient-accuracy GPS fixes', () => {
    assert.equal(findBestSpot([row('a')], 'Jio', null, now).status, 'gps-unavailable');
    assert.equal(findBestSpot([row('a')], 'Jio', { ...gps, timestamp: now - 10_001 }, now).status, 'gps-stale');
    const lowerConfidence = findBestSpot([row('a')], 'Jio', { ...gps, accuracy: 64 }, now);
    assert.equal(lowerConfidence.status, 'success');
    if (lowerConfidence.status === 'success') assert.equal(lowerConfidence.candidate.searchGpsAccuracy, 64);
    assert.equal(findBestSpot([row('a')], 'Jio', { ...gps, lat: 91 }, now).status, 'gps-invalid');
    assert.equal(findBestSpot([row('a')], 'Jio', { ...gps, timestamp: now + 1 }, now).status, 'gps-stale');
    assert.equal(findBestSpot([row('a')], 'Jio', { ...gps, accuracy: 10001 }, now).status, 'gps-invalid');
  });

  test('returns a true no-data result for no nearby valid rows and handles malformed records', () => {
    const malformed = row('bad', { latitude: Number.NaN });
    const otherOperator = row('other-op', { operator: 'Vi' as TelecomOperator });
    assert.equal(findBestSpot([malformed, otherOperator], 'Jio', gps, now).status, 'no-data');
  });

  test('rows with no available NQS components are ineligible instead of becoming a zero-score best spot', () => {
    const result = findBestSpot([row('no-metrics', { latencyMs: 0, downloadMbps: 0, uploadMbps: 0, jitterMs: 0, probeFailurePercent: 0,
      metricAvailability: { latency: false, download: false, upload: false, jitter: false, probeFailure: false, signal: false } })], 'Jio', gps, now);
    assert.equal(result.status, 'no-data');
  });

  test('only quality-v2 records whose NQS agrees with valid available metrics can be ranked', () => {
    const unmarked = row('unmarked', { measurementMethodVersion: undefined });
    const mismatched = row('mismatch', { nqs: 100 });
    assert.equal(findBestSpot([unmarked, mismatched], 'Jio', gps, now).status, 'no-data');
  });
});
