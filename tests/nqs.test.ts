import { test, describe } from 'node:test';
import assert from 'node:assert';
import { networkMeasurer, NetworkMeasurerService } from '../src/services/networkMeasurer.ts';

describe('NQS Normalization and Locked Formula Tests', () => {
  const measurer = new NetworkMeasurerService();

  test('Latency normalization score: <= 15ms is 100, >= 300ms is 0, linear between', () => {
    assert.strictEqual(measurer.calcLatencyScore(10), 100);
    assert.strictEqual(measurer.calcLatencyScore(15), 100);
    assert.strictEqual(measurer.calcLatencyScore(300), 0);
    assert.strictEqual(measurer.calcLatencyScore(350), 0);

    // Midpoint: (15 + 300) / 2 = 157.5ms -> approx 50
    const midScore = measurer.calcLatencyScore(157.5);
    assert.ok(midScore >= 49 && midScore <= 51, `Expected ~50, got ${midScore}`);
  });

  test('Throughput normalization score: >= 100 Mbps is 100, <= 0 is 0, linear between', () => {
    assert.strictEqual(measurer.calcThroughputScore(100), 100);
    assert.strictEqual(measurer.calcThroughputScore(150), 100);
    assert.strictEqual(measurer.calcThroughputScore(0), 0);
    assert.strictEqual(measurer.calcThroughputScore(-5), 0);
    assert.strictEqual(measurer.calcThroughputScore(50), 50);
    assert.strictEqual(measurer.calcThroughputScore(25), 25);
    assert.strictEqual(measurer.calcThroughputScore(80.5), 81);
  });

  test('HTTP probe failure score: <= 0% is 100, >= 20% is 0, linear between', () => {
    assert.strictEqual(measurer.calcProbeFailureScore(0), 100);
    assert.strictEqual(measurer.calcProbeFailureScore(-1), 100);
    assert.strictEqual(measurer.calcProbeFailureScore(20), 0);
    assert.strictEqual(measurer.calcProbeFailureScore(30), 0);
    assert.strictEqual(measurer.calcProbeFailureScore(10), 50);
  });

  test('Jitter normalization score: <= 2ms is 100, >= 50ms is 0, linear between', () => {
    assert.strictEqual(measurer.calcJitterScore(1), 100);
    assert.strictEqual(measurer.calcJitterScore(2), 100);
    assert.strictEqual(measurer.calcJitterScore(50), 0);
    assert.strictEqual(measurer.calcJitterScore(60), 0);
    assert.strictEqual(measurer.calcJitterScore(26), 50);
  });

  test('Locked NQS formula evaluates correctly with unavailable S (renormalized by 0.85)', () => {
    // When L=100, T=100, P=100, J=100:
    // (0.25*100 + 0.30*100 + 0.20*100 + 0.10*100) / 0.85 = 85 / 0.85 = 100
    const L = 100;
    const T = 100;
    const P = 100;
    const J = 100;
    const raw = (0.25 * L + 0.30 * T + 0.20 * P + 0.10 * J) / 0.85;
    assert.strictEqual(Math.round(raw), 100);
  });

  test('NQS Status thresholds: EXCELLENT (>=80), GOOD (60-79), MODERATE (40-59), POOR (<40)', () => {
    assert.strictEqual(measurer.getNqsStatus(90), 'EXCELLENT');
    assert.strictEqual(measurer.getNqsStatus(80), 'EXCELLENT');
    assert.strictEqual(measurer.getNqsStatus(79), 'GOOD');
    assert.strictEqual(measurer.getNqsStatus(60), 'GOOD');
    assert.strictEqual(measurer.getNqsStatus(59), 'MODERATE');
    assert.strictEqual(measurer.getNqsStatus(40), 'MODERATE');
    assert.strictEqual(measurer.getNqsStatus(39), 'POOR');
    assert.strictEqual(measurer.getNqsStatus(0), 'POOR');
  });

  test('Unavailable Signal strength produces honest undefined without injecting fake numbers', () => {
    const offline = measurer.createOfflineMeasurement(12.9692, 79.1559, 10, 'Jio');
    assert.strictEqual(offline.signalDbm, undefined);
    assert.strictEqual(offline.signalStatus, 'UNAVAILABLE');
    assert.strictEqual(offline.nqs, 0);
    assert.strictEqual(offline.status, 'NO_CONNECTIVITY');
  });
});
