import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWalkingRouteRequest, isValidCurrentRouteOrigin, requestWalkingRoutesWith, selectWalkingRoute, WalkingRouteError } from '../src/services/walkingRoutes.ts';
import type { RouteCoordinate, WalkingRouteRequest } from '../src/services/walkingRoutes.ts';

const origin: RouteCoordinate = { lat: 12.9692, lng: 79.1559 };
const destination: RouteCoordinate = { lat: 12.9701, lng: 79.157 };
const route = (lat: number, lng: number, distance: number, duration: string, label: string) => ({
  path: [origin, { lat, lng }, destination], distanceMeters: distance, duration, routeLabels: [label]
});

describe('Walking route request and selection', () => {
  test('accepts only a fresh, valid GPS origin with sensible accuracy', () => {
    const fix = { lat: origin.lat, lng: origin.lng, accuracy: 8, timestamp: 10_000 };
    assert.equal(isValidCurrentRouteOrigin(fix, 20_000), true);
    assert.equal(isValidCurrentRouteOrigin(fix, 50_001), false);
    assert.equal(isValidCurrentRouteOrigin({ ...fix, accuracy: 51 }, 20_000), false);
    assert.equal(isValidCurrentRouteOrigin({ ...fix, lng: 181 }, 20_000), false);
    assert.equal(isValidCurrentRouteOrigin(null, 20_000), false);
  });

  test('requests walking mode, alternatives, and only route fields needed for display', () => {
    assert.deepEqual(buildWalkingRouteRequest(origin, destination), {
      origin, destination, travelMode: 'WALKING', computeAlternativeRoutes: true,
      fields: ['path', 'distanceMeters', 'duration', 'routeLabels']
    });
  });

  test('maps default and alternate routes into display inputs and selects geometry by index', async () => {
    let received: WalkingRouteRequest | undefined;
    const routes = await requestWalkingRoutesWith(async (request) => {
      received = request;
      return { routes: [route(12.9695, 79.156, 100, '80s', 'DEFAULT_ROUTE'), route(12.9697, 79.1562, 125, '90s', 'DEFAULT_ROUTE_ALTERNATE')] };
    }, origin, destination);
    assert.equal(received?.travelMode, 'WALKING');
    assert.equal(routes.length, 2);
    assert.equal(routes[1].distanceMeters, 125);
    assert.equal(routes[1].durationSeconds, 90);
    assert.deepEqual(routes[1].path[1], { lat: 12.9697, lng: 79.1562 });
    assert.equal(selectWalkingRoute(routes, 1), routes[1]);
    assert.equal(selectWalkingRoute(routes, 5), null);
  });

  test('converts Google LatLng route geometry objects', async () => {
    const routes = await requestWalkingRoutesWith(async () => ({ routes: [{
      path: [{ lat: () => origin.lat, lng: () => origin.lng }, { lat: () => destination.lat, lng: () => destination.lng }],
      distanceMeters: 100, duration: '60s'
    }] }), origin, destination);
    assert.deepEqual(routes[0].path, [origin, destination]);
  });

  test('turns no-route, API failure, and malformed response cases into useful typed errors', async () => {
    await assert.rejects(requestWalkingRoutesWith(async () => ({ routes: [] }), origin, destination),
      (error) => error instanceof WalkingRouteError && error.code === 'NOT_FOUND');
    await assert.rejects(requestWalkingRoutesWith(async () => { throw new Error('provider detail'); }, origin, destination),
      (error) => error instanceof WalkingRouteError && error.code === 'API_ERROR' && !error.message.includes('provider detail'));
    await assert.rejects(requestWalkingRoutesWith(async () => ({ routes: [{ path: [], distanceMeters: 2, duration: '2s' }] }), origin, destination),
      (error) => error instanceof WalkingRouteError && error.code === 'INVALID_RESPONSE');
  });
});
