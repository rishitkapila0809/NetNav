import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { LiveMeasurement } from '../src/types.ts';
import { confirmMeasurementSave, getMeasurementStorageEligibility } from '../src/services/measurementPersistence.ts';

const valid: LiveMeasurement = {
  id: 'valid-current-sample', operator: 'Jio', latitude: 12.9, longitude: 79.1, accuracy: 64,
  timestamp: new Date().toISOString(), latencyMs: 15, downloadMbps: 100, uploadMbps: 8, jitterMs: 2,
  probeFailurePercent: 0, signalStatus: 'UNAVAILABLE', nqs: 100, status: 'EXCELLENT',
  measurementMethodVersion: 'quality-v2', throughputTestPerformed: true,
  metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: false }
};

describe('measurement scoring and persistence states', () => {
  test('distinguishes insufficient NQS evidence from a scored but non-persistence cycle', () => {
    const incompleteProbe = { ...valid, nqs: 0, status: 'UNAVAILABLE' as const,
      metricAvailability: { ...valid.metricAvailability, probeFailure: false } };
    assert.equal(getMeasurementStorageEligibility(incompleteProbe), 'score-ineligible');
    assert.equal(getMeasurementStorageEligibility({ ...valid, throughputTestPerformed: false }), 'persistence-ineligible');
    assert.equal(getMeasurementStorageEligibility(valid), 'pending');
    assert.equal(getMeasurementStorageEligibility({ ...valid, nqs: 99 }), 'score-ineligible', 'a formula mismatch cannot be persisted as a trusted score');
  });

  test('only a resolved API save becomes saved; rejection remains failed with its error', async () => {
    assert.deepEqual(await confirmMeasurementSave(async () => ({ status: 201 })), { status: 'saved' });
    assert.deepEqual(await confirmMeasurementSave(async () => { throw new Error('Saving measurement failed (400): Invalid probeFailurePercent'); }),
      { status: 'failed', error: 'Saving measurement failed (400): Invalid probeFailurePercent' });
  });
});
