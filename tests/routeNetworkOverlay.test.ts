import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteNetworkOverlay, distanceMeters, distancePointToSegmentMeters, sampleRouteIntoBins } from '../src/services/routeNetworkOverlay.ts';
import type { LiveMeasurement } from '../src/types.ts';
import type { RouteCoordinate } from '../src/services/walkingRoutes.ts';

const now = Date.parse('2026-10-25T12:00:00Z');
const start: RouteCoordinate = { lat: 12.9692, lng: 79.1559 };
const end: RouteCoordinate = { lat: 12.9692, lng: 79.157 };
const path = [start, end];
function row(id: string, longitude: number, overrides: Partial<LiveMeasurement> = {}): LiveMeasurement {
  return { id, latitude: start.lat, longitude, accuracy: 5, timestamp: new Date(now - 60_000).toISOString(),
    operator: 'Jio', latencyMs: 20, downloadMbps: 40, uploadMbps: 8, jitterMs: 3, probeFailurePercent: 1,
    signalStatus: 'UNAVAILABLE', nqs: 85, status: 'EXCELLENT', metricAvailability: {}, ...overrides };
}
const nearFirstBin = start.lng + 0.0001;

describe('Route quality overlay helpers', () => {
  test('distance calculations and path sampling produce distance-based bins', () => {
    assert.equal(distanceMeters(start, start), 0);
    assert.ok(distancePointToSegmentMeters({ lat: start.lat + 0.0001, lng: nearFirstBin }, start, end) > 10);
    const bins = sampleRouteIntoBins(path, 20);
    const routeLength = distanceMeters(start, end);
    assert.ok(bins.length >= 5 && bins.length <= 7);
    assert.ok(Math.abs(bins.reduce((sum, bin) => sum + bin.lengthMeters, 0) - routeLength) < 0.1);
    assert.ok(bins.every((bin) => bin.lengthMeters <= 20.01));
  });

  test('isolates the selected operator and match radius respects accuracy with a hard cap', () => {
    const points = [row('j1', nearFirstBin), row('j2', nearFirstBin), row('a1', nearFirstBin, { operator: 'Airtel' }), row('a2', nearFirstBin, { operator: 'Airtel' })];
    const jio = buildRouteNetworkOverlay(path, points, 'Jio', now);
    assert.equal(jio.bins.reduce((sum, bin) => sum + bin.sampleCount, 0), 2);
    assert.equal(jio.operator, 'Jio');
    const withinAccuracy = [row('in1', nearFirstBin, { latitude: start.lat + 0.00007 }), row('in2', nearFirstBin, { latitude: start.lat + 0.00007 })];
    const matches = buildRouteNetworkOverlay(path, withinAccuracy, 'Jio', now);
    assert.equal(matches.bins.reduce((sum, bin) => sum + bin.sampleCount, 0), 2);
    const outside = [row('out1', nearFirstBin, { latitude: start.lat + 0.00011, accuracy: 5 }), row('out2', nearFirstBin, { latitude: start.lat + 0.00011, accuracy: 5 })];
    assert.equal(buildRouteNetworkOverlay(path, outside, 'Jio', now).bins.reduce((sum, bin) => sum + bin.sampleCount, 0), 0);
    const cappedRadius = [row('cap1', nearFirstBin, { latitude: start.lat + 0.00023, accuracy: 500 }), row('cap2', nearFirstBin, { latitude: start.lat + 0.00023, accuracy: 500 })];
    assert.equal(buildRouteNetworkOverlay(path, cappedRadius, 'Jio', now).bins.reduce((sum, bin) => sum + bin.sampleCount, 0), 0);
  });

  test('uses sample count, recency, and accuracy for confidence; low-confidence bins are unknown', () => {
    const fresh = buildRouteNetworkOverlay(path, [row('fresh1', nearFirstBin), row('fresh2', nearFirstBin)], 'Jio', now);
    const measured = fresh.bins.find((bin) => bin.sampleCount > 0)!;
    assert.equal(measured.classification, 'good');
    assert.ok(measured.confidence > 0.3 && measured.confidence < 0.5);
    const single = buildRouteNetworkOverlay(path, [row('single', nearFirstBin)], 'Jio', now);
    assert.equal(single.bins.find((bin) => bin.sampleCount > 0)?.classification, 'unknown');
    const staleRows = [row('old1', nearFirstBin, { timestamp: new Date(now - 90 * 86_400_000).toISOString() }),
      row('old2', nearFirstBin, { timestamp: new Date(now - 90 * 86_400_000).toISOString() })];
    const stale = buildRouteNetworkOverlay(path, staleRows, 'Jio', now);
    assert.equal(stale.bins.find((bin) => bin.sampleCount > 0)?.classification, 'unknown');
  });

  test('reports poor and moderate quality distinctly and leaves large unmeasured gaps unknown', () => {
    const bins = sampleRouteIntoBins(path, 20);
    const first = bins[0].midpoint;
    const last = bins.at(-1)!.midpoint;
    const points = [row('good1', first.lng), row('good2', first.lng), row('poor1', last.lng, { nqs: 20 }), row('poor2', last.lng, { nqs: 20 })];
    const overlay = buildRouteNetworkOverlay(path, points, 'Jio', now, 20);
    assert.ok(overlay.bins.some((bin) => bin.classification === 'good'));
    assert.ok(overlay.bins.some((bin) => bin.classification === 'poor'));
    assert.ok(overlay.bins.some((bin) => bin.classification === 'unknown'));
    assert.equal(overlay.bins.filter((bin) => bin.classification === 'unknown').length > 1, true);
    assert.equal(overlay.coveragePercent, Math.round((overlay.goodMeters + overlay.moderateMeters + overlay.poorMeters) / overlay.bins.reduce((sum, bin) => sum + bin.lengthMeters, 0) * 100));
    assert.ok(overlay.unknownMeters > 0);
    assert.ok(overlay.newestMeasurement);
  });

  test('classifies moderate quality and reports zero coverage for routes with no measurements', () => {
    const midpoint = sampleRouteIntoBins(path, 20)[0].midpoint;
    const moderate = buildRouteNetworkOverlay(path, [row('m1', midpoint.lng, { nqs: 55 }), row('m2', midpoint.lng, { nqs: 55 })], 'Jio', now);
    assert.ok(moderate.bins.some((bin) => bin.classification === 'moderate'));
    const empty = buildRouteNetworkOverlay(path, [], 'Jio', now);
    assert.equal(empty.coveragePercent, 0);
    assert.ok(empty.bins.every((bin) => bin.classification === 'unknown'));
    assert.equal(empty.newestMeasurement, null);
  });
});
