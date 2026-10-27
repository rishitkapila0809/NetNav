import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterHistoricalMeasurements, getLivePathSegments, getNqsMarkerColor, groupExactLocations,
  historicalDetailHtml, historicalMarkerSpec, historyStateMessage, mapHistoricalRecord, mapHistoricalRecords, recencyWeightedGroupNqs
} from '../src/services/historicalMeasurements.ts';
import type { LiveMeasurement } from '../src/types.ts';

const base = {
  id: 'db-row-17', operator: 'Airtel', latitude: 12.9692, longitude: 79.1559, accuracy: 8.5,
  timestamp: '2026-10-25T10:00:00.000Z', latencyMs: 23, downloadMbps: 45.2, uploadMbps: 9.1,
  jitterMs: 3.4, probeFailurePercent: 1, nqs: 82, signalDbm: -96, signalStatus: 'AVAILABLE',
  metricAvailability: { latency: true, download: true, upload: true, jitter: true, probeFailure: true, signal: true }
};

function measurement(overrides: Partial<LiveMeasurement> = {}): LiveMeasurement {
  return { ...mapHistoricalRecord(base)!, ...overrides };
}

describe('Historical map data', () => {
  test('maps API values without changing the exact coordinate, score, timestamp, or metrics', () => {
    const mapped = mapHistoricalRecord(base);
    assert.ok(mapped);
    assert.equal(mapped.id, 'db-row-17');
    assert.deepEqual([mapped.latitude, mapped.longitude], [12.9692, 79.1559]);
    assert.equal(mapped.nqs, 82);
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
      position: { lat: 12.9692, lng: 79.1559 }, color: '#00E676', count: 1, nqs: 82
    });
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
    assert.equal(recencyWeightedGroupNqs(groups[0], Date.parse('2026-10-26T10:00:00Z')), 72);
    const spec = historicalMarkerSpec(groups[0], Date.parse('2026-10-26T10:00:00Z'));
    assert.equal(spec.nqs, 72);
    assert.equal(spec.count, 2);
    const details = historicalDetailHtml(groups[0]);
    assert.match(details, /2 saved samples/);
    assert.match(details, /Recency-weighted NQS/);
  });

  test('uses an explicit neutral N/A marker when the group has no usable score', () => {
    const offline = measurement({ isOffline: true, status: 'NO_CONNECTIVITY' });
    const spec = historicalMarkerSpec([offline], Date.parse('2026-10-26T10:00:00Z'));
    assert.equal(spec.nqs, null);
    assert.equal(spec.color, '#60788C');
  });

  test('identifies old packetLoss rows as legacy and does not aggregate their NQS as corrected data', () => {
    const legacy = mapHistoricalRecord({ ...base, packetLossPercent: base.probeFailurePercent,
      metricAvailability: { latency: true, download: true, upload: true, jitter: true, packetLoss: true, signal: false } });
    assert.ok(legacy);
    assert.equal(legacy.measurementMethodVersion, 'legacy-v1');
    assert.equal(recencyWeightedGroupNqs([legacy]), null);
    assert.equal(historicalMarkerSpec([legacy]).nqs, null);
    assert.match(historicalDetailHtml([legacy]), /Legacy measurement method/);
  });

  test('records with no available score components are explicitly unavailable', () => {
    const row = mapHistoricalRecord({ ...base, metricAvailability: { latency: false, download: false, upload: false, jitter: false, probeFailure: false, signal: false } });
    assert.ok(row);
    assert.equal(row.status, 'UNAVAILABLE');
    assert.equal(historicalMarkerSpec([row]).nqs, null);
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
