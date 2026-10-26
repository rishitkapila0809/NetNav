import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRouteRankings, MIN_NETWORK_RECOMMENDATION_COVERAGE } from '../src/services/routeRanking.ts';
import type { RouteNetworkOverlay } from '../src/services/routeNetworkOverlay.ts';
import type { WalkingRouteOption } from '../src/services/walkingRoutes.ts';

const route = (id: string, durationSeconds: number): WalkingRouteOption => ({ id, durationSeconds, distanceMeters: durationSeconds * 1.2, path: [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }], routeLabel: id });
function overlay(coverage: number, nqs: number, confidence = 0.8, timestamp = '2026-10-26T10:00:00.000Z'): RouteNetworkOverlay {
  const measuredMeters = coverage, unknownMeters = 100 - coverage;
  const bins: RouteNetworkOverlay['bins'] = [];
  if (measuredMeters) bins.push({ index: 0, start: { lat: 0, lng: 0 }, end: { lat: 0, lng: 0.001 }, midpoint: { lat: 0, lng: 0.0005 }, lengthMeters: measuredMeters, classification: 'good', nqs, confidence, sampleCount: 3 });
  if (unknownMeters) bins.push({ index: 1, start: { lat: 0, lng: 0.001 }, end: { lat: 0, lng: 0.002 }, midpoint: { lat: 0, lng: 0.0015 }, lengthMeters: unknownMeters, classification: 'unknown', nqs: null, confidence: 0, sampleCount: 0 });
  return { operator: 'Jio', bins, coveragePercent: coverage, newestMeasurement: timestamp, goodMeters: measuredMeters, moderateMeters: 0, poorMeters: 0, unknownMeters };
}

describe('transparent route ranking', () => {
  test('normalizes duration across alternatives and applies 70/30 weighted cost', () => {
    const routes = [route('fast', 100), route('slow', 200)];
    const rows = new Map([['fast', overlay(100, 100)], ['slow', overlay(100, 0)]]);
    const result = calculateRouteRankings(routes, rows);
    assert.equal(result[0].durationCost, 0);
    assert.equal(result[1].durationCost, 1);
    assert.ok(Math.abs(result[0].finalCost! - 0.3 * 0.2) < 1e-9);
    assert.ok(Math.abs(result[1].finalCost! - (0.7 + 0.3)) < 1e-9);
    assert.equal(result[0].bestNetwork, true);
  });

  test('unknown distance increases risk instead of being treated as excellent', () => {
    const result = calculateRouteRankings([route('full', 100), route('sparse', 100)], new Map([
      ['full', overlay(100, 90)], ['sparse', overlay(40, 90)]
    ]));
    assert.ok(result[1].networkRisk! > result[0].networkRisk!);
    assert.equal(result[1].confidentNetworkEvidence, false);
    assert.match(result[1].explanation, /Insufficient network data/);
  });

  test('requires minimum coverage and uses threshold inclusively', () => {
    const result = calculateRouteRankings([route('below', 100), route('at', 110)], new Map([
      ['below', overlay(MIN_NETWORK_RECOMMENDATION_COVERAGE - 1, 95)], ['at', overlay(MIN_NETWORK_RECOMMENDATION_COVERAGE, 60)]
    ]));
    assert.equal(result[0].bestNetwork, false);
    assert.equal(result[0].confidentNetworkEvidence, false);
    assert.equal(result[1].confidentNetworkEvidence, true);
    assert.equal(result[1].bestNetwork, true);
  });

  test('does not recommend a network route when paginated history hit its safety cap', () => {
    const result = calculateRouteRankings([route('partial', 100)], new Map([['partial', overlay(100, 99)]]), undefined, false);
    assert.equal(result[0].confidentNetworkEvidence, false);
    assert.equal(result[0].bestNetwork, false);
    assert.match(result[0].explanation, /safety cap/);
  });

  test('handles ties and one route without division by zero', () => {
    const tied = calculateRouteRankings([route('a', 100), route('b', 100)], new Map([['a', overlay(100, 70)], ['b', overlay(100, 70)]]));
    assert.deepEqual(tied.map((item) => item.durationCost), [0, 0]);
    assert.equal(tied.filter((item) => item.fastest).length, 1);
    assert.equal(tied.filter((item) => item.bestNetwork).length, 1);
    const single = calculateRouteRankings([route('only', 100)], new Map([['only', overlay(100, 75)]]));
    assert.ok(Math.abs(single[0].finalCost! - 0.3 * 0.4) < 1e-9);
  });

  test('does not mix operators, stale-confidence overlays increase risk, and missing data has no fabricated score', () => {
    const jio = overlay(100, 80, 0.1, '2026-07-28T10:00:00.000Z');
    const chosenOperator = 'Jio';
    const onlyJio = new Map([['r', jio]]);
    assert.equal(onlyJio.get('r')?.operator, chosenOperator);
    assert.ok(Math.abs(calculateRouteRankings([route('r', 90)], onlyJio)[0].networkRisk! - 0.92) < 1e-9);
    assert.ok(calculateRouteRankings([route('fresh', 90)], new Map([['fresh', overlay(100, 80, 0.9)]]))[0].networkRisk! < 0.6);
    const missing = calculateRouteRankings([route('none', 90)], new Map());
    assert.equal(missing[0].finalCost, null);
    assert.equal(missing[0].networkRisk, null);
    assert.equal(missing[0].bestNetwork, false);
  });
});
