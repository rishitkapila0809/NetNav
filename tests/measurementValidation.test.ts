import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { LiveMeasurement } from '../src/types.ts';
import { gpsAccuracyCircleRadiusMeters, hasPreferredGpsAccuracy, measurementGpsAccuracyWarning, measurementGpsMessage, shouldPersistMeasurement, validateMeasurementGps, validateMeasurementStart } from '../src/services/measurementValidation.ts';
import { resolveMeasurementServerUrl } from '../src/services/networkMeasurer.ts';

const now = Date.now();
const fix = { lat: 12.9692, lng: 79.1559, accuracy: 8, timestamp: now };

describe('measurement location and persistence gates', () => {
  test('production never falls back to localhost or a page hostname when API configuration is absent', () => {
    assert.equal(resolveMeasurementServerUrl(undefined, true, 'netnav.vercel.app'), '');
    assert.equal(resolveMeasurementServerUrl('https://netnav-api.onrender.com/', true, 'netnav.vercel.app'), 'https://netnav-api.onrender.com');
    assert.equal(resolveMeasurementServerUrl('http://localhost:3001', true, 'netnav.vercel.app'), '');
    assert.equal(resolveMeasurementServerUrl('https://127.0.0.1:3001', true, 'netnav.vercel.app'), '');
    assert.equal(resolveMeasurementServerUrl(undefined, false, 'localhost'), 'http://localhost:3001');
    assert.equal(resolveMeasurementServerUrl(undefined, false, '192.168.1.4'), 'http://192.168.1.4:3001');
  });

  test('validity requires fresh valid coordinates/accuracy; ten metres is only the preferred target', () => {
    assert.equal(validateMeasurementGps(fix, now), 'ready');
    assert.equal(validateMeasurementGps(null, now), 'missing');
    assert.equal(validateMeasurementGps({ ...fix, lat: 91 }, now), 'invalid');
    assert.equal(validateMeasurementGps({ ...fix, timestamp: now + 1 }, now), 'invalid');
    assert.equal(validateMeasurementGps({ ...fix, timestamp: now - 10_001 }, now), 'stale');
    const campusFix = { ...fix, accuracy: 64 };
    assert.equal(validateMeasurementGps(campusFix, now), 'ready');
    assert.equal(hasPreferredGpsAccuracy(fix), true);
    assert.equal(hasPreferredGpsAccuracy({ ...fix, accuracy: 10.01 }), false);
    assert.equal(gpsAccuracyCircleRadiusMeters(64), 64);
    assert.equal(gpsAccuracyCircleRadiusMeters(8), 8);
    assert.equal(gpsAccuracyCircleRadiusMeters(Infinity), null);
    assert.match(measurementGpsAccuracyWarning(campusFix) ?? '', /±64 m.*less precise.*improve/);
    assert.equal(measurementGpsAccuracyWarning(fix), null);
    assert.equal(validateMeasurementGps({ ...fix, accuracy: 10001 }, now), 'invalid');
  });

  test('measurement cannot start until a supported operator and a fresh accurate fix are selected', () => {
    assert.equal(validateMeasurementStart('', fix, now), 'operator-required');
    assert.equal(validateMeasurementStart('Unknown', fix, now), 'operator-required');
    assert.equal(validateMeasurementStart('Airtel', null, now), 'missing');
    assert.equal(validateMeasurementStart('Vi', { ...fix, accuracy: 64 }, now), 'ready');
    assert.equal(validateMeasurementStart('BSNL', fix, now), 'ready');
  });

  test('persists fresh corrected scored throughput cycles with the actual valid browser accuracy', () => {
    const valid: LiveMeasurement = {
      id: 'sample', operator: 'Jio', latitude: fix.lat, longitude: fix.lng, accuracy: fix.accuracy,
      timestamp: new Date(now).toISOString(), latencyMs: 30, downloadMbps: 12, uploadMbps: 4, jitterMs: 3,
      probeFailurePercent: 0, signalStatus: 'UNAVAILABLE', nqs: 75, status: 'GOOD',
      measurementMethodVersion: 'quality-v2', throughputTestPerformed: true,
      metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: false }
    };
    assert.equal(shouldPersistMeasurement(valid), true);
    assert.equal(shouldPersistMeasurement({ ...valid, throughputTestPerformed: false }), false);
    assert.equal(shouldPersistMeasurement({ ...valid, measurementMethodVersion: 'legacy-v1' }), false);
    assert.equal(shouldPersistMeasurement({ ...valid, accuracy: 64 }), true);
    assert.equal(shouldPersistMeasurement({ ...valid, accuracy: 10001 }), false);
    assert.equal(shouldPersistMeasurement({ ...valid, status: 'UNAVAILABLE' }), false);
    assert.equal(shouldPersistMeasurement({ ...valid, metricAvailability: { ...valid.metricAvailability, probeFailure: false } }), false);
    assert.equal(shouldPersistMeasurement({ ...valid, longitude: 181 }), false);
  });
});
