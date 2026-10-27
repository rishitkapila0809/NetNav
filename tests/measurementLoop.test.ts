import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SequentialMeasurementLoop, type MeasurementCycleOutcome } from '../src/services/measurementLoop.ts';

function manualScheduler() {
  let nextId = 0;
  const tasks = new Map<number, () => void>();
  return {
    tasks,
    schedule: (callback: () => void) => {
      const id = ++nextId;
      tasks.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (timer: ReturnType<typeof setTimeout>) => { tasks.delete(timer as unknown as number); },
    fireNext: () => {
      const next = tasks.entries().next().value as [number, () => void] | undefined;
      assert.ok(next, 'expected one scheduled cycle');
      tasks.delete(next[0]);
      next[1]();
    }
  };
}

describe('persistent measurement loop', () => {
  test('continues with later cycles after a transient measurement request failure', async () => {
    const scheduler = manualScheduler();
    const outcomes: MeasurementCycleOutcome[] = [];
    const errors: number[] = [];
    let calls = 0;
    const loop = new SequentialMeasurementLoop({
      schedule: scheduler.schedule, cancel: scheduler.cancel,
      runCycle: () => { calls++; if (calls === 1) throw new Error('temporary probe failure'); },
      onCycleError: (_error, cycle) => errors.push(cycle),
      onCycleSettled: (outcome) => outcomes.push(outcome)
    });
    loop.start();
    loop.start();
    assert.equal(scheduler.tasks.size, 1);
    scheduler.fireNext(); await loop.whenIdle();
    scheduler.fireNext(); await loop.whenIdle();
    assert.equal(calls, 2);
    assert.deepEqual(errors, [1]);
    assert.deepEqual(outcomes, ['failed', 'completed']);
    loop.stop();
  });

  test('a GPS-stale/skipped cycle does not stop later valid cycles', async () => {
    const scheduler = manualScheduler();
    const outcomes: MeasurementCycleOutcome[] = [];
    let validFix = false, measured = 0;
    const loop = new SequentialMeasurementLoop({
      schedule: scheduler.schedule, cancel: scheduler.cancel,
      runCycle: () => { if (!validFix) return 'skipped'; measured++; },
      onCycleSettled: (outcome) => outcomes.push(outcome)
    });
    loop.start();
    scheduler.fireNext(); await loop.whenIdle();
    assert.equal(loop.isActive, true);
    validFix = true;
    scheduler.fireNext(); await loop.whenIdle();
    assert.equal(measured, 1);
    assert.deepEqual(outcomes, ['skipped', 'completed']);
    loop.stop();
  });

  test('explicit stop clears the pending cycle and prevents rescheduling after an in-flight cycle', async () => {
    const scheduler = manualScheduler();
    let finish!: () => void;
    let calls = 0;
    const loop = new SequentialMeasurementLoop({
      schedule: scheduler.schedule, cancel: scheduler.cancel,
      runCycle: () => { calls++; return new Promise<void>((resolve) => { finish = resolve; }); }
    });
    loop.start();
    scheduler.fireNext();
    await Promise.resolve();
    assert.equal(loop.isRunning, true);
    loop.stop();
    finish(); await loop.whenIdle();
    assert.equal(loop.isActive, false);
    assert.equal(scheduler.tasks.size, 0);
    assert.equal(calls, 1);
  });

  test('a rerender-equivalent repeated start does not create a second timer or overlapping cycle', async () => {
    const scheduler = manualScheduler();
    let finish!: () => void;
    let activeCalls = 0, maxConcurrent = 0;
    const loop = new SequentialMeasurementLoop({
      schedule: scheduler.schedule, cancel: scheduler.cancel,
      runCycle: () => {
        activeCalls++; maxConcurrent = Math.max(maxConcurrent, activeCalls);
        return new Promise<void>((resolve) => { finish = () => { activeCalls--; resolve(); }; });
      }
    });
    loop.start(); loop.start();
    scheduler.fireNext();
    await Promise.resolve();
    loop.start();
    assert.equal(scheduler.tasks.size, 0);
    assert.equal(maxConcurrent, 1);
    finish(); await loop.whenIdle();
    assert.equal(scheduler.tasks.size, 1);
    loop.stop();
  });

  test('measurement pauses when GPS is stale and resumes with fresh fix without persisting stale coordinates', async () => {
    const scheduler = manualScheduler();
    const persistedCoordinates: Array<{ lat: number; lng: number }> = [];
    let currentGps: { lat: number; lng: number; accuracy: number; timestamp: number } | null = {
      lat: 12.9692, lng: 79.1559, accuracy: 5, timestamp: 1_000_000
    };
    let now = 1_000_000;

    const loop = new SequentialMeasurementLoop({
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      runCycle: () => {
        const isFresh = currentGps && (now - currentGps.timestamp <= 10_000);
        if (!isFresh) {
          return 'skipped';
        }
        persistedCoordinates.push({ lat: currentGps.lat, lng: currentGps.lng });
      }
    });

    loop.start();
    scheduler.fireNext(); await loop.whenIdle();
    assert.equal(persistedCoordinates.length, 1);
    assert.deepEqual(persistedCoordinates[0], { lat: 12.9692, lng: 79.1559 });

    now = 1_015_000;
    scheduler.fireNext(); await loop.whenIdle();
    assert.equal(persistedCoordinates.length, 1, 'stale coordinate was not recorded/persisted');
    assert.equal(loop.isActive, true, 'measurement session remains active');

    currentGps = { lat: 12.9698, lng: 79.1565, accuracy: 4, timestamp: now };
    scheduler.fireNext(); await loop.whenIdle();
    assert.equal(persistedCoordinates.length, 2, 'resumed sampling upon fresh fix');
    assert.deepEqual(persistedCoordinates[1], { lat: 12.9698, lng: 79.1565 });

    loop.stop();
  });
});
