import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterHistoricalMeasurements, getLivePathSegments, getNqsMarkerColor, groupExactLocations,
  historicalDetailHtml, historicalMarkerSpec, historyStateMessage, mapHistoricalRecord, mapHistoricalRecords,
  recencyWeightedGroupNqs, summarizeHistoricalScores
} from '../src/services/historicalMeasurements.ts';
import type { LiveMeasurement } from '../src/types.ts';

const base = {
  id: 'db-row-17', operator: 'Airtel', latitude: 12.9692, longitude: 79.1559, accuracy: 8.5,
  timestamp: '2026-10-25T10:00:00.000Z', latencyMs: 23, downloadMbps: 45.2, uploadMbps: 9.1,
  jitterMs: 3.4, probeFailurePercent: 1, nqs: 78, signalStatus: 'UNAVAILABLE',
  metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: false, _methodVersion: 'quality-v2' }
};

function measurement(overrides: Partial<LiveMeasurement> = {}): LiveMeasurement {
  const nqs = overrides.nqs ?? base.nqs;
  return { ...mapHistoricalRecord({ ...base, nqs,
    latencyMs: 15 + ((100 - nqs) / 100) * 285, downloadMbps: nqs, probeFailurePercent: (100 - nqs) / 5,
    jitterMs: 2 + ((100 - nqs) / 100) * 48 })!, ...overrides };
}

function apiRowForNqs(nqs: number): Record<string, unknown> {
  return { ...base, nqs, latencyMs: 15 + ((100 - nqs) / 100) * 285, downloadMbps: nqs,
    probeFailurePercent: (100 - nqs) / 5, jitterMs: 2 + ((100 - nqs) / 100) * 48 };
}

describe('Historical map data', () => {
  test('maps API values without changing the exact coordinate, score, timestamp, or metrics', () => {
    const mapped = mapHistoricalRecord(base);
    assert.ok(mapped);
    assert.equal(mapped.id, 'db-row-17');
    assert.deepEqual([mapped.latitude, mapped.longitude], [12.9692, 79.1559]);
    assert.equal(mapped.nqs, 78);
    assert.equal(mapped.timestamp, base.timestamp);
    assert.equal(mapped.downloadMbps, 45.2);
  });

  test('marker color uses the existing NQS bands and no fixed click-adapter score', () => {
    assert.equal(getNqsMarkerColor(82), '#00E676');
    assert.equal(getNqsMarkerColor(71), '#A3E635');
    assert.equal(getNqsMarkerColor(52), '#FF9100');
    assert.equal(getNqsMarkerColor(20), '#FF1744');
    assert.equal(getNqsMarkerColor(2, 'NO_CONNECTIVITY'), '#60788C');
    assert.deepEqual(historicalMarkerSpec([mapHistoricalRecord(base)!]), {
      position: { lat: 12.9692, lng: 79.1559 }, color: '#A3E635', count: 1, scoredCount: 1,
      scoreField: 'nqs', label: '78', unavailableReason: null, nqs: 78
    });
  });

  test('historical marker labels show exact trusted NQS values including 0 and 100', () => {
    for (const score of [0, 57, 100]) {
      const row = mapHistoricalRecord(apiRowForNqs(score))!;
      const spec = historicalMarkerSpec([row]);
      assert.equal(spec.label, String(score));
      assert.equal(spec.nqs, score);
      assert.equal(spec.scoreField, 'nqs');
    }
  });

  test('API NQS normalization accepts its lowercase field and a legacy uppercase spelling without deriving scores', () => {
    assert.equal(mapHistoricalRecord({ ...base, nqs: 0 })?.nqs, 0);
    assert.equal(mapHistoricalRecord({ ...base, nqs: undefined, NQS: 63 })?.nqs, 63);
    assert.equal(mapHistoricalRecord({ ...base, nqs: undefined, NQS: 'not-a-score' }), null);
  });

  test('history score diagnostics separate loaded, score-bearing, trusted, and legacy rows', () => {
    const legacy = { ...base, id: 'legacy', metricAvailability: { latency: true, download: true, upload: true, jitter: true, packetLoss: true, signal: false } };
    const summary = summarizeHistoricalScores([base, legacy, { ...base, nqs: 110 }]);
    assert.deepEqual(summary, { loaded: 3, validNqs: 2, trustedNqs: 1, legacyOrUnverified: 1, ineligible: 2 });
  });

  test('operator filtering changes only returned history and preserves all-mode rows', () => {
    const rows = [measurement({ operator: 'Jio' }), measurement({ operator: 'Vi' }), measurement({ operator: 'BSNL' })];
    assert.equal(filterHistoricalMeasurements(rows, 'All').length, 3);
    assert.deepEqual(filterHistoricalMeasurements(rows, 'Vi').map((row) => row.operator), ['Vi']);
    assert.equal(rows.length, 3);
  });

  test('invalid records are skipped individually and unavailable metrics remain N/A in details', () => {
    const mapped = mapHistoricalRecords({ measurements: [base, { ...base, latitude: 190 }, { ...base, timestamp: 'bad-date' }] });
    assert.equal(mapped.length, 1);
    const unavailable = mapHistoricalRecord({ ...base, latencyMs: null, downloadMbps: null, signalDbm: null,
      metricAvailability: { latency: false, download: false, upload: true, jitter: false, probeFailure: false, signal: false } });
    assert.ok(unavailable);
    assert.equal(unavailable.latencyMs, 0);
    const html = historicalDetailHtml([unavailable]);
    assert.match(html, /Latency: N\/A/);
    assert.match(html, /Download: N\/A/);
    assert.match(html, /Signal: N\/A/);
    assert.match(html, /Upload: 9\.1 Mbps/);
  });

  test('invalid operator, coordinates, accuracy, score, and available metric values are rejected', () => {
    for (const row of [
      { ...base, operator: 'Other' }, { ...base, longitude: 181 }, { ...base, accuracy: -1 },
      { ...base, nqs: 101 }, { ...base, latencyMs: -1 }
    ]) assert.equal(mapHistoricalRecord(row), null);
  });

  test('exact coordinate repeats retain every record and expose a count group', () => {
    const a = measurement({ id: 'one' }), b = measurement({ id: 'two', nqs: 61 });
    const groups = groupExactLocations([a, b]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].map((row) => row.id), ['one', 'two']);
    assert.equal(recencyWeightedGroupNqs(groups[0], Date.parse('2026-10-26T10:00:00Z')), 70);
    const spec = historicalMarkerSpec(groups[0], Date.parse('2026-10-26T10:00:00Z'));
    assert.equal(spec.nqs, 70);
    assert.equal(spec.label, '70');
    assert.equal(spec.scoredCount, 2);
    assert.equal(spec.count, 2);
    const details = historicalDetailHtml(groups[0]);
    assert.match(details, /2 saved samples/);
    assert.match(details, /Recency-weighted NQS/);
  });

  test('uses an explicit neutral N/A marker when the group has no usable score', () => {
    const offline = measurement({ isOffline: true, status: 'NO_CONNECTIVITY' });
    const spec = historicalMarkerSpec([offline], Date.parse('2026-10-26T10:00:00Z'));
    assert.equal(spec.nqs, null);
    assert.equal(spec.label, 'N/A');
    assert.equal(spec.color, '#60788C');
    assert.match(spec.unavailableReason ?? '', /no eligible quality-v2/);
  });

  test('identifies old packetLoss rows as legacy and does not aggregate their NQS as corrected data', () => {
    const legacy = mapHistoricalRecord({ ...base, packetLossPercent: base.probeFailurePercent,
      metricAvailability: { latency: true, download: true, upload: true, jitter: true, packetLoss: true, signal: false } });
    assert.ok(legacy);
    assert.equal(legacy.measurementMethodVersion, 'legacy-v1');
    assert.equal(recencyWeightedGroupNqs([legacy]), null);
    assert.equal(historicalMarkerSpec([legacy]).nqs, null);
    assert.equal(historicalMarkerSpec([legacy]).label, 'N/A');
    assert.match(historicalDetailHtml([legacy]), /Legacy measurement method/);
  });

  test('fresh record with numeric NQS and probeFailure but missing _methodVersion remains legacy-v1 and untrusted', () => {
    const unverified = mapHistoricalRecord({
      ...base,
      metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: false }
    });
    assert.ok(unverified);
    assert.equal(unverified.measurementMethodVersion, 'legacy-v1');
    assert.equal(recencyWeightedGroupNqs([unverified]), null);
    const spec = historicalMarkerSpec([unverified]);
    assert.equal(spec.nqs, null);
    assert.equal(spec.label, 'N/A');
    assert.equal(spec.scoredCount, 0);
    assert.match(spec.unavailableReason ?? '', /legacy\/unverified/);
  });

  test('records with no available score components are explicitly unavailable', () => {
    const row = mapHistoricalRecord({ ...base, metricAvailability: { latency: false, download: false, upload: false, jitter: false, probeFailure: false, signal: false } });
    assert.ok(row);
    assert.equal(row.status, 'UNAVAILABLE');
    assert.equal(historicalMarkerSpec([row]).nqs, null);
  });

  test('quality-v2 records with less than 0.70 available formula weight are unavailable on the map', () => {
    const row = mapHistoricalRecord({ ...base, nqs: 100,
      metricAvailability: { latency: false, download: false, upload: false, jitter: true, probeFailure: false, signal: false, _methodVersion: 'quality-v2' } });
    assert.ok(row);
    assert.equal(row.status, 'UNAVAILABLE');
    assert.equal(historicalMarkerSpec([row]).label, 'N/A');
    assert.equal(historicalMarkerSpec([row]).scoredCount, 0);
  });

  test('history loading, empty, and error states are distinguishable and errors offer retry', () => {
    assert.equal(historyStateMessage('loading', 0), 'Loading saved measurements…');
    assert.equal(historyStateMessage('loaded', 0), 'No saved measurements yet.');
    assert.equal(historyStateMessage('error', 0), 'Could not load measurement history.');
  });

  test('live-session path uses only ordered same-operator nearby samples and never historical input', () => {
    const a = measurement({ operator: 'Jio', timestamp: '2026-10-25T10:00:00Z' });
    const b = measurement({ operator: 'Jio', latitude: 12.9693, timestamp: '2026-10-25T10:00:01Z' });
    const otherOperator = measurement({ operator: 'Vi', timestamp: '2026-10-25T10:00:02Z' });
    const far = measurement({ operator: 'Vi', latitude: 13.1, timestamp: '2026-10-25T10:00:03Z' });
    assert.equal(getLivePathSegments([a, b, otherOperator, far]).length, 1);
    assert.equal(getLivePathSegments([a, measurement({ ...b, timestamp: a.timestamp })]).length, 0);
    assert.equal(getLivePathSegments([a, measurement({ ...b, isOffline: true })]).length, 0);
  });
});
