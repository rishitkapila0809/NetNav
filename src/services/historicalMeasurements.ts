import type { LiveMeasurement, TelecomOperator } from '../types';
import { networkMeasurer } from './networkMeasurer.ts';
import { calculateMeasurementNqs } from './measurementTelemetry.ts';

export type HistoryStatus = 'loading' | 'loaded' | 'error';
export type OperatorFilter = 'All' | TelecomOperator;
const operators = new Set<TelecomOperator>(['Jio', 'Airtel', 'Vi', 'BSNL']);
const availabilityKeys = ['latency', 'download', 'upload', 'jitter', 'probeFailure', 'signal'] as const;

function numeric(value: unknown, min: number, max: number, optional = false): number | undefined {
  if ((value === null || value === undefined || value === '') && optional) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : undefined;
}

/** Maps one database/API row. Invalid rows return null so one bad row cannot hide valid history. */
export function mapHistoricalRecord(row: Record<string, unknown>): LiveMeasurement | null {
  if (!operators.has(row.operator as TelecomOperator)) return null;
  const latitude = numeric(row.latitude, -90, 90);
  const longitude = numeric(row.longitude, -180, 180);
  const accuracy = numeric(row.accuracy, 0, 10000);
  // The Express history API aliases the database SMALLINT to `nqs`; accept `NQS`
  // as a compatibility spelling for older exports without deriving a score.
  const nqs = numeric(row.nqs ?? row.NQS, 0, 100);
  const timestamp = new Date(String(row.timestamp));
  if (latitude === undefined || longitude === undefined || accuracy === undefined || nqs === undefined || !Number.isFinite(timestamp.getTime()) || timestamp.getTime() > Date.now() + 300_000) return null;

  const rawAvailability = row.metricAvailability && typeof row.metricAvailability === 'object' && !Array.isArray(row.metricAvailability)
    ? row.metricAvailability as Record<string, unknown> : {};
  const metricAvailability: Record<string, boolean> = {};
  for (const key of availabilityKeys) metricAvailability[key] = key === 'probeFailure'
    ? rawAvailability.probeFailure === true || (rawAvailability._methodVersion !== 'quality-v2' && rawAvailability.packetLoss === true)
    : rawAvailability[key] === true;
  // Trust requires the explicit version written by the current persistence path.
  // A `probeFailure` property alone is not sufficient: older serializers used
  // compatibility aliases and may contain scores calculated under another method.
  const measurementMethodVersion = rawAvailability._methodVersion === 'quality-v2' ? 'quality-v2' : 'legacy-v1';
  const storedDownloadAt = typeof row.downloadMeasuredAt === 'string' && Number.isFinite(Date.parse(row.downloadMeasuredAt)) ? row.downloadMeasuredAt : undefined;
  const storedUploadAt = typeof row.uploadMeasuredAt === 'string' && Number.isFinite(Date.parse(row.uploadMeasuredAt)) ? row.uploadMeasuredAt : undefined;
  const metric = (key: typeof availabilityKeys[number], value: unknown, min: number, max: number): number => {
    const parsed = numeric(value, min, max, !metricAvailability[key]);
    return parsed ?? 0; // Zero is an internal sentinel; details use availability to display N/A.
  };
  const latencyMs = metric('latency', row.latencyMs, 0, 600000);
  const downloadMbps = metric('download', row.downloadMbps, 0, 100000);
  const uploadMbps = metric('upload', row.uploadMbps, 0, 100000);
  const jitterMs = metric('jitter', row.jitterMs, 0, 600000);
  const probeFailurePercent = metric('probeFailure', row.probeFailurePercent ?? row.packetLossPercent, 0, 100);
  const signalDbm = numeric(row.signalDbm, -200, 0, true);
  if (availabilityKeys.some((key) => rawAvailability[key] === true &&
        numeric(({ latency: row.latencyMs, download: row.downloadMbps, upload: row.uploadMbps, jitter: row.jitterMs, probeFailure: row.probeFailurePercent ?? row.packetLossPercent, signal: row.signalDbm })[key],
        key === 'probeFailure' ? 0 : key === 'signal' ? -200 : 0,
        key === 'probeFailure' ? 100 : key === 'signal' ? 0 : key === 'download' || key === 'upload' ? 100000 : 600000) === undefined)) return null;

  const hasScorableMetric = ['latency', 'download', 'probeFailure', 'jitter'].some((key) => metricAvailability[key] === true);
  const mapped: LiveMeasurement = {
    id: String(row.id ?? `${latitude},${longitude},${timestamp.toISOString()}`), latitude, longitude, accuracy,
    timestamp: timestamp.toISOString(), operator: row.operator as TelecomOperator,
    latencyMs, downloadMbps, uploadMbps, jitterMs, probeFailurePercent, nqs,
    downloadMeasuredAt: storedDownloadAt ?? (measurementMethodVersion === 'quality-v2' ? timestamp.toISOString() : undefined),
    uploadMeasuredAt: storedUploadAt ?? (measurementMethodVersion === 'quality-v2' ? timestamp.toISOString() : undefined),
    status: row.status === 'NO_CONNECTIVITY' ? 'NO_CONNECTIVITY' : !hasScorableMetric ? 'UNAVAILABLE' : nqs >= 80 ? 'EXCELLENT' : nqs >= 60 ? 'GOOD' : nqs >= 40 ? 'MODERATE' : 'POOR',
    measurementMethodVersion,
    signalDbm: metricAvailability.signal ? signalDbm : undefined,
    signalStatus: metricAvailability.signal && signalDbm !== undefined ? 'AVAILABLE' : 'UNAVAILABLE',
    metricAvailability
  };
  if (measurementMethodVersion === 'quality-v2' && calculateMeasurementNqs(mapped).nqs === null) mapped.status = 'UNAVAILABLE';
  return mapped;
}

export function mapHistoricalRecords(value: unknown): LiveMeasurement[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { measurements?: unknown }).measurements)) {
    throw new Error('Measurement history response has an invalid format');
  }
  const rows = (value as { measurements: unknown[] }).measurements;
  return rows.flatMap((row) => row && typeof row === 'object' && !Array.isArray(row)
    ? (mapHistoricalRecord(row as Record<string, unknown>) ?? []) : []);
}

export function filterHistoricalMeasurements(rows: LiveMeasurement[], operator: OperatorFilter): LiveMeasurement[] {
  return operator === 'All' ? rows : rows.filter((row) => row.operator === operator);
}

export function getNqsMarkerColor(nqs: number, status?: LiveMeasurement['status']): string {
  return networkMeasurer.getNqsColor(nqs, status);
}

export function groupExactLocations(rows: LiveMeasurement[]): LiveMeasurement[][] {
  const groups = new Map<string, LiveMeasurement[]>();
  for (const row of rows) {
    const key = `${row.operator}:${row.latitude},${row.longitude}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}

const NQS_RECENCY_HALF_LIFE_MS = 30 * 86_400_000;
function trustedScoredRows(group: LiveMeasurement[]): LiveMeasurement[] {
  return group.filter((row) => row.status !== 'NO_CONNECTIVITY' && row.status !== 'UNAVAILABLE' && row.measurementMethodVersion === 'quality-v2' &&
    Number.isFinite(row.nqs) && row.nqs >= 0 && row.nqs <= 100 && calculateMeasurementNqs(row).verification === 'match');
}

export function recencyWeightedGroupNqs(group: LiveMeasurement[], now = Date.now()): number | null {
  const scored = trustedScoredRows(group);
  if (!scored.length) return null;
  const weights = scored.map((row) => Math.pow(0.5, Math.max(0, now - Date.parse(row.timestamp)) / NQS_RECENCY_HALF_LIFE_MS));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  return weightSum ? Math.round(scored.reduce((sum, row, index) => sum + row.nqs * weights[index], 0) / weightSum) : null;
}

export function historicalMarkerSpec(group: LiveMeasurement[], now = Date.now()): { position: { lat: number; lng: number }; color: string; count: number; scoredCount: number; scoreField: 'nqs'; label: string; unavailableReason: string | null; nqs: number | null } {
  const row = group[0];
  const scoredCount = trustedScoredRows(group).length;
  const nqs = recencyWeightedGroupNqs(group, now);
  const allLegacy = group.length > 0 && group.every((item) => item.measurementMethodVersion === 'legacy-v1');
  const unavailableReason = nqs !== null ? null : allLegacy
    ? 'No trusted NQS: this group contains only legacy/unverified measurements.'
    : 'No trusted NQS: no eligible quality-v2 record has a valid available score.';
  return { position: { lat: row.latitude, lng: row.longitude }, color: nqs === null ? '#60788C' : getNqsMarkerColor(nqs), count: group.length,
    scoredCount, scoreField: 'nqs', label: nqs === null ? 'N/A' : String(nqs), unavailableReason, nqs };
}

export interface HistoricalScoreDiagnostics { loaded: number; validNqs: number; trustedNqs: number; legacyOrUnverified: number; ineligible: number }
export function summarizeHistoricalScores(rows: unknown[]): HistoricalScoreDiagnostics {
  let validNqs = 0, trustedNqs = 0, legacyOrUnverified = 0;
  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { legacyOrUnverified++; continue; }
    const row = value as Record<string, unknown>;
    if (numeric(row.nqs ?? row.NQS, 0, 100) !== undefined) validNqs++;
    const mapped = mapHistoricalRecord(row);
    if (mapped?.measurementMethodVersion === 'legacy-v1') legacyOrUnverified++;
    if (mapped && mapped.measurementMethodVersion === 'quality-v2' && mapped.status !== 'UNAVAILABLE' && mapped.status !== 'NO_CONNECTIVITY' &&
        Number.isFinite(mapped.nqs) && mapped.nqs >= 0 && mapped.nqs <= 100 && calculateMeasurementNqs(mapped).verification === 'match') trustedNqs++;
  }
  return { loaded: rows.length, validNqs, trustedNqs, legacyOrUnverified, ineligible: rows.length - trustedNqs };
}

export function formatHistoricalMetric(value: number | undefined, available: boolean, suffix: string): string {
  return !available || value === undefined || !Number.isFinite(value) ? 'N/A' : `${value} ${suffix}`;
}

export function historicalDetailHtml(rows: LiveMeasurement[]): string {
  const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const aggregate = recencyWeightedGroupNqs(rows);
  const spec = historicalMarkerSpec(rows);
  const scoreNote = `<div>Marker score uses stored ${spec.scoreField} from ${spec.scoredCount} eligible sample(s).${spec.unavailableReason ? ` ${esc(spec.unavailableReason)}` : ''}</div>`;
  const summary = `<strong>${rows.length} saved sample${rows.length === 1 ? '' : 's'} Â· Recency-weighted NQS: ${aggregate === null ? 'N/A' : `${aggregate}/100`}</strong>`;
  return `<div style="font:12px system-ui,sans-serif;color:#101820;max-width:300px;max-height:320px;overflow:auto">${summary}${scoreNote}${rows.map((row) => {
    const available = row.metricAvailability ?? {};
    const metric = (key: string, value: number | undefined, suffix: string) => formatHistoricalMetric(value, available[key] === true, suffix);
    return `<section style="padding:6px 0;border-bottom:1px solid #ccd">` +
      `${row.measurementMethodVersion === 'legacy-v1' ? '<div><strong>Legacy measurement method:</strong> this score and sample cadence are not comparable with corrected readings.</div>' : ''}` +
      `<strong>${esc(row.operator)} · ${esc(new Date(row.timestamp).toLocaleString())}</strong>` +
      `<div>NQS: ${row.nqs}/100</div><div>Latency: ${metric('latency', row.latencyMs, 'ms')}</div>` +
      `<div>Download: ${metric('download', row.downloadMbps, 'Mbps')}</div><div>Upload: ${metric('upload', row.uploadMbps, 'Mbps')}</div>` +
      `<div>Jitter: ${metric('jitter', row.jitterMs, 'ms')}</div><div>Probe failure: ${metric('probeFailure', row.probeFailurePercent, '%')}</div>` +
      `<div>GPS accuracy: ${esc(String(row.accuracy))} m</div><div>Signal: ${available.signal === true && row.signalDbm !== undefined ? `${row.signalDbm} dBm (available)` : 'N/A (unavailable)'}</div>` +
      `</section>`;
  }).join('')}</div>`;
}

export function historyStateMessage(status: HistoryStatus, count: number): string | null {
  if (status === 'loading') return 'Loading saved measurements…';
  if (status === 'error') return 'Could not load measurement history.';
  if (count === 0) return 'No saved measurements yet.';
  return null;
}

export function getLivePathSegments(rows: LiveMeasurement[]): Array<[LiveMeasurement, LiveMeasurement]> {
  const validCoordinate = (row: LiveMeasurement) => Number.isFinite(row.latitude) && row.latitude >= -90 && row.latitude <= 90 &&
    Number.isFinite(row.longitude) && row.longitude >= -180 && row.longitude <= 180;
  const distance = (a: LiveMeasurement, b: LiveMeasurement) => {
    const rad = Math.PI / 180, dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(h));
  };
  return rows.slice(1).flatMap((row, index) => {
    const previous = rows[index];
    return validCoordinate(previous) && validCoordinate(row) && !previous.isOffline && !row.isOffline &&
      previous.operator === row.operator && Date.parse(row.timestamp) > Date.parse(previous.timestamp) && distance(previous, row) <= 200
      ? [[previous, row] as [LiveMeasurement, LiveMeasurement]] : [];
  });
}
