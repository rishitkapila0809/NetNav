import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { LiveMeasurement } from '../src/types.ts';
import { findNearbyMeasurements, locationSearchStateMessage, MAP_SEARCH_MEASUREMENT_RADIUS_METERS, searchMapLocationsWith } from '../src/services/mapLocationSearch.ts';

const base: LiveMeasurement = { id: 'near', operator: 'Jio', latitude: 12.9692, longitude: 79.1559, accuracy: 5, timestamp: '2026-10-26T10:00:00Z', latencyMs: 10, downloadMbps: 20, uploadMbps: 5, jitterMs: 2, packetLossPercent: 0, signalStatus: 'UNAVAILABLE', nqs: 82, status: 'EXCELLENT', metricAvailability: { latency: true, download: true, upload: true, jitter: true, packetLoss: true, signal: false } };

describe('campus and address map search', () => {
  test('maps selectable geocoder results to actual returned coordinates', async () => {
    const requests: unknown[] = [];
    const results = await searchMapLocationsWith(async (request) => {
      requests.push(request);
      return [{ place_id: 'vit-main-gate', formatted_address: 'VIT Main Gate, Vellore, India', geometry: { location: { lat: () => 12.9692, lng: () => 79.1559 } } }];
    }, 'VIT Main Gate');
    assert.deepEqual(requests, [{ address: 'VIT Main Gate', region: 'IN' }]);
    assert.deepEqual(results[0].position, { lat: 12.9692, lng: 79.1559 });
    assert.equal(results[0].id, 'vit-main-gate');
  });

  test('handles empty queries and provider no-result errors without fabricated location', async () => {
    await assert.rejects(searchMapLocationsWith(async () => [], '   '), /Enter a building/);
    await assert.rejects(searchMapLocationsWith(async () => [], 'unknown place'), /No matching location/);
    await assert.rejects(searchMapLocationsWith(async () => { throw new Error('provider'); }, 'VIT'), /Geocoding API access/);
  });

  test('filters nearby persisted measurements by explicit operator and 100 m radius', () => {
    const close = { ...base, id: 'close', latitude: 12.9698 };
    const far = { ...base, id: 'far', latitude: 12.9715 };
    const otherOperator = { ...close, id: 'airtel', operator: 'Airtel' as const };
    const nearby = findNearbyMeasurements([close, far, otherOperator], 'Jio', { lat: base.latitude, lng: base.longitude });
    assert.equal(MAP_SEARCH_MEASUREMENT_RADIUS_METERS, 100);
    assert.deepEqual(nearby.map((row) => row.measurement.id), ['close']);
    assert.ok(nearby[0].distanceMeters <= 100);
  });

  test('reports loaded no-data separately from loading and failure', () => {
    assert.match(locationSearchStateMessage('loading', 0)!, /Searching saved/);
    assert.equal(locationSearchStateMessage('loaded', 0), 'No measurements available for this location.');
    assert.match(locationSearchStateMessage('error', 0)!, /Could not load/);
    assert.equal(locationSearchStateMessage('loaded', 1), null);
  });
});
