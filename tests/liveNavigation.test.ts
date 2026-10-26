import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { advanceOffRouteFixCount, calculateRouteProgress, canRequestReroute, endNavigationSession, isGpsJump, startNavigationSession, validateNavigationFix } from '../src/services/liveNavigation.ts';
import { requestWalkingRoutesWith } from '../src/services/walkingRoutes.ts';
import type { WalkingRouteOption } from '../src/services/walkingRoutes.ts';

const now = Date.parse('2026-10-26T10:00:00Z');
const route: WalkingRouteOption = { id: 'chosen', distanceMeters: 111.2, durationSeconds: 120, routeLabel: 'chosen', path: [{ lat: 12.9692, lng: 79.1559 }, { lat: 12.9692, lng: 79.1569 }] };
const fix = { lat: 12.9692, lng: 79.1559, accuracy: 8, timestamp: now };

describe('live navigation helpers', () => {
  test('calculates progress and remaining distance along route geometry', () => {
    const midway = calculateRouteProgress(route, { lat: 12.9692, lng: 79.1564 });
    assert.ok(midway.progressPercent > 45 && midway.progressPercent < 55);
    assert.ok(midway.remainingMeters > 50 && midway.remainingMeters < 65);
    assert.ok(midway.remainingSeconds > 55 && midway.remainingSeconds < 65);
    assert.ok(midway.distanceFromRouteMeters < 1);
  });

  test('accepts only fresh, accurate, valid navigation fixes', () => {
    assert.equal(validateNavigationFix(fix, now), 'ready');
    assert.equal(validateNavigationFix({ ...fix, accuracy: 51 }, now), 'inaccurate');
    assert.equal(validateNavigationFix({ ...fix, timestamp: now - 15_001 }, now), 'stale');
    assert.equal(validateNavigationFix({ ...fix, lat: 91 }, now), 'invalid');
    assert.equal(validateNavigationFix(null, now), 'missing');
  });

  test('off-route state needs three consecutive fixes beyond the accuracy-aware threshold', () => {
    let count = 0;
    for (let i = 0; i < 2; i++) { const result = advanceOffRouteFixCount(40, 8, count); count = result.count; assert.equal(result.offRoute, false); }
    const third = advanceOffRouteFixCount(40, 8, count);
    assert.equal(third.offRoute, true);
    assert.deepEqual(advanceOffRouteFixCount(20, 8, third.count), { count: 0, offRoute: false });
    assert.equal(advanceOffRouteFixCount(35, 30, 0).offRoute, false);
  });

  test('rejects GPS jumps before they can advance navigation or off-route count', () => {
    const previous = { ...fix, timestamp: now };
    const jump = { ...fix, lat: 12.971, timestamp: now + 1000 };
    assert.equal(isGpsJump(previous, jump), true);
    assert.equal(isGpsJump(previous, { ...fix, lng: 79.15591, timestamp: now + 1000 }), false);
  });

  test('navigation lifecycle starts only with the selected valid route and ends explicitly', () => {
    assert.equal(startNavigationSession(route, 'ready', fix, now), route);
    assert.equal(startNavigationSession(null, 'ready', fix, now), null);
    assert.equal(startNavigationSession(route, 'loading', fix, now), null);
    assert.equal(startNavigationSession(route, 'ready', { ...fix, accuracy: 90 }, now), null);
    assert.equal(endNavigationSession(), null);
  });

  test('reroute requests are blocked while in flight and during cooldown', () => {
    assert.equal(canRequestReroute(now - 20_000, now, false), true);
    assert.equal(canRequestReroute(now, now, false), false);
    assert.equal(canRequestReroute(now - 50_000, now, true), false);
  });

  test('reroute provider failure leaves caller’s existing route available for recovery', async () => {
    const currentRoute = route;
    await assert.rejects(requestWalkingRoutesWith(async () => { throw new Error('provider unavailable'); }, fix, { lat: 12.9702, lng: 79.157 }), /could not calculate walking routes/i);
    assert.equal(currentRoute, route);
  });
});
