import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserLocationTracker, type GeolocationPort, type GeolocationPositionLike } from '../src/services/locationTracker.ts';

const position = (accuracy = 5): GeolocationPositionLike => ({
  coords: { latitude: 12.9692, longitude: 79.1559, accuracy, heading: null, speed: null }, timestamp: Date.now()
});

class FakeGeolocation implements GeolocationPort {
  currentSuccess?: (position: GeolocationPositionLike) => void;
  currentError?: (error: { code: number; message?: string }) => void;
  watchSuccess?: (position: GeolocationPositionLike) => void;
  watchError?: (error: { code: number; message?: string }) => void;
  watchCount = 0;
  getCalls = 0;
  cleared: number[] = [];
  getCurrentPosition(success: (position: GeolocationPositionLike) => void, error: (error: { code: number; message?: string }) => void): void {
    this.getCalls++;
    this.currentSuccess = success; this.currentError = error;
  }
  watchPosition(success: (position: GeolocationPositionLike) => void, error: (error: { code: number; message?: string }) => void): number {
    this.watchCount++; this.watchSuccess = success; this.watchError = error; return this.watchCount;
  }
  clearWatch(id: number): void { this.cleared.push(id); }
}

describe('initial browser location request and watcher lifecycle', () => {
  test('requests an initial fix immediately, then starts one reusable watcher', async () => {
    const geo = new FakeGeolocation(); const statuses: string[] = []; const fixes: number[] = [];
    const tracker = new BrowserLocationTracker(geo, (status) => statuses.push(status), (fix) => fixes.push(fix.accuracy));
    tracker.start(); tracker.start();
    assert.ok(geo.currentSuccess, 'initial getCurrentPosition request was made at start');
    assert.equal(geo.watchCount, 0, 'watch waits until the one-shot initial result');
    geo.currentSuccess!(position());
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(statuses, ['requesting', 'ready']);
    assert.deepEqual(fixes, [5]);
    assert.equal(geo.watchCount, 1);
    geo.watchSuccess!(position(4));
    assert.equal(fixes.length, 2);
    assert.equal(geo.watchCount, 1);
    tracker.stop(); tracker.stop();
    assert.deepEqual(geo.cleared, [1]);
  });

  test('classifies denied, unavailable, timeout, and valid lower-confidence fixes', async () => {
    for (const [code, expected] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']] as const) {
      const geo = new FakeGeolocation(); const statuses: string[] = [];
      const tracker = new BrowserLocationTracker(geo, (status) => statuses.push(status), () => undefined);
      tracker.start(); geo.currentError!({ code });
      await Promise.resolve(); await Promise.resolve();
      assert.ok(statuses.includes(expected));
      assert.equal(geo.watchCount, code === 1 ? 0 : 1);
      tracker.stop();
    }
    const geo = new FakeGeolocation(); const statuses: string[] = [];
    const tracker = new BrowserLocationTracker(geo, (status) => statuses.push(status), () => undefined);
    tracker.start(); geo.currentSuccess!(position(64));
    await Promise.resolve(); await Promise.resolve();
    assert.ok(statuses.includes('low-confidence'));
    assert.equal(geo.watchCount, 1);
    geo.watchSuccess!(position(8));
    assert.equal(statuses.at(-1), 'ready', 'a preferred accuracy fix clears the low-confidence state');
    tracker.stop();
  });

  test('retry does not create concurrent one-shot requests or duplicate watchers and stop ignores later callbacks', async () => {
    const geo = new FakeGeolocation(); const statuses: string[] = []; let fixes = 0;
    const tracker = new BrowserLocationTracker(geo, (status) => statuses.push(status), () => fixes++);
    tracker.start(); tracker.retry();
    geo.currentSuccess!(position());
    await Promise.resolve(); await Promise.resolve();
    tracker.retry(); tracker.retry();
    assert.equal(geo.watchCount, 1);
    tracker.stop(); geo.watchSuccess!(position());
    assert.equal(fixes, 1);
    assert.deepEqual(geo.cleared, [1]);
  });

  test('shares an in-flight initial request across StrictMode remounts', async () => {
    const geo = new FakeGeolocation(); let firstFixes = 0, secondFixes = 0;
    const first = new BrowserLocationTracker(geo, () => undefined, () => firstFixes++);
    first.start(); first.stop();
    const second = new BrowserLocationTracker(geo, () => undefined, () => secondFixes++);
    second.start();
    assert.equal(geo.getCalls, 1);
    geo.currentSuccess!(position()); await Promise.resolve(); await Promise.resolve();
    assert.equal(firstFixes, 0);
    assert.equal(secondFixes, 1);
    assert.equal(geo.watchCount, 1);
    second.stop();
  });

  test('triggers throttled one-shot GPS refresh when fix is stale (>10s) and does not duplicate watcher', async () => {
    const geo = new FakeGeolocation();
    const statuses: string[] = [];
    const fixes: number[] = [];
    const tracker = new BrowserLocationTracker(geo, (status) => statuses.push(status), (fix) => fixes.push(fix.timestamp));
    const t0 = 1_000_000;
    tracker.start();
    assert.equal(geo.getCalls, 1);
    geo.currentSuccess!({ coords: { latitude: 12.9692, longitude: 79.1559, accuracy: 5, heading: null, speed: null }, timestamp: t0 });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(geo.watchCount, 1);
    assert.equal(fixes.length, 1);

    // If not stale (e.g. 5 seconds later), refreshIfStale should not call getCurrentPosition
    tracker.refreshIfStale(t0 + 5_000);
    assert.equal(geo.getCalls, 1);

    // When stale (> 10s, e.g. 11s later), refreshIfStale triggers a one-shot request
    tracker.refreshIfStale(t0 + 11_000);
    assert.equal(geo.getCalls, 2);
    assert.equal(geo.watchCount, 1, 'does not create a second watcher');

    // Throttled: if called again 2s later, should not trigger another call (< 15s throttle)
    tracker.refreshIfStale(t0 + 13_000);
    assert.equal(geo.getCalls, 2);

    // Complete the one-shot request with a fresh fix
    const t1 = t0 + 12_000;
    geo.currentSuccess!({ coords: { latitude: 12.9695, longitude: 79.1560, accuracy: 4, heading: null, speed: null }, timestamp: t1 });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(fixes.length, 2);
    assert.equal(fixes[1], t1);

    tracker.stop();
  });
});
