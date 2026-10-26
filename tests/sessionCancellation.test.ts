import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createMeasurementServer } from '../server/index.js';
import { NetworkMeasurerService } from '../src/services/networkMeasurer.ts';

describe('Session Cancellation and Loop Overlap Tests', () => {
  let server: http.Server;
  const TEST_PORT = 3098;
  const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
  let measurer: NetworkMeasurerService;

  before(async () => {
    server = createMeasurementServer();
    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, '127.0.0.1', () => resolve());
    });
    measurer = new NetworkMeasurerService({
      serverUrl: SERVER_URL,
      probeTimeoutMs: 1500,
      downloadTimeoutMs: 3000,
      uploadTimeoutMs: 3000
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  test('Immediate cancellation via AbortSignal aborts in-flight probe', async () => {
    const controller = new AbortController();
    controller.abort(); // already aborted

    await assert.rejects(
      async () => {
        await measurer.measureProbe(controller.signal);
      },
      (err: unknown) => {
        return err instanceof DOMException && err.name === 'AbortError';
      }
    );
  });

  test('In-flight cancellation during measureSample throws AbortError cleanly', async () => {
    const controller = new AbortController();

    // Abort as soon as the async fetch is queued
    queueMicrotask(() => {
      controller.abort();
    });

    await assert.rejects(
      async () => {
        await measurer.measureSample(12.9692, 79.1559, 10, 'Jio', 0, 0, controller.signal);
      },
      (err: unknown) => {
        return err instanceof DOMException && err.name === 'AbortError';
      }
    );
  });

  test('Sequential measurement loop executes without overlapping calls', async () => {
    let activeExecutions = 0;
    let maxConcurrent = 0;
    const samples: number[] = [];

    // Simulate the sequential loop used in App.tsx
    const isMeasuring = { value: true };
    const abortController = new AbortController();

    let loopCount = 0;
    const executeStep = async () => {
      if (!isMeasuring.value) return;

      activeExecutions++;
      maxConcurrent = Math.max(maxConcurrent, activeExecutions);

      try {
        const s = await measurer.measureSample(
          12.9692,
          79.1559,
          10,
          'Jio',
          0,
          0,
          abortController.signal
        );
        if (isMeasuring.value) {
          samples.push(s.nqs);
        }
      } finally {
        activeExecutions--;
      }

      loopCount++;
      if (loopCount < 3 && isMeasuring.value) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await executeStep();
      }
    };

    await executeStep();

    assert.strictEqual(maxConcurrent, 1, `Max concurrent calls should be 1, got ${maxConcurrent}`);
    assert.strictEqual(samples.length, 3, `Expected 3 sequential samples, got ${samples.length}`);
  });
});
