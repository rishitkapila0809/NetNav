import type { LiveMeasurement, TelecomOperator } from '../types';
import { calculateMeasurementNqs } from './measurementTelemetry.ts';
import { MAX_VALID_GPS_ACCURACY_METERS, PREFERRED_GPS_ACCURACY_METERS } from './measurementValidation.ts';

export const FIND_BEST_SPOT_RADIUS_METERS = 10;
export const MAX_FIND_GPS_AGE_MS = 10_000;
export const PREFERRED_FIND_GPS_ACCURACY_METERS = PREFERRED_GPS_ACCURACY_METERS;
export const CANDIDATE_GROUP_RADIUS_METERS = 5;
const DAY_MS = 86_400_000;
const RECENCY_HALF_LIFE_MS = 30 * DAY_MS;

export interface BestSpotGps { lat: number; lng: number; accuracy: number; timestamp: number }
export interface BestSpotCandidate {
  latitude: number; longitude: number; distanceMeters: number; operator: TelecomOperator;
  searchGpsAccuracy: number;
  nqs: number; rankScore: number; sampleCount: number; lastMeasured: string; averageAccuracy: number;
  metrics: { latencyMs?: number; downloadMbps?: number; uploadMbps?: number; jitterMs?: number; probeFailurePercent?: number; signalDbm?: number };
  metricAvailability: Record<string, boolean>;
}
export function bestSpotCameraPoints(candidate: Pick<BestSpotCandidate, 'latitude' | 'longitude'>, current: { lat: number; lng: number } | null): Array<{ lat: number; lng: number }> {
  const spot = { lat: candidate.latitude, lng: candidate.longitude };
  return current ? [current, spot] : [spot];
}
export type BestSpotResult =
  | { status: 'gps-unavailable' | 'gps-stale' | 'gps-invalid' }
  | { status: 'no-data'; searchGpsAccuracy: number }
  | { status: 'success'; candidate: BestSpotCandidate };
export type PersistedBestSpotSearchResult = BestSpotResult | { status: 'history-error'; message: string } | { status: 'history-incomplete' };

export async function searchPersistedBestSpot(
  load: () => Promise<{ measurements: LiveMeasurement[]; truncated: boolean }>,
  operator: TelecomOperator,
  gps: BestSpotGps | null,
  now = Date.now()
): Promise<PersistedBestSpotSearchResult> {
  const gpsResult = findBestSpot([], operator, gps, now);
  if (gpsResult.status !== 'no-data') return gpsResult;
  try {
    const history = await load();
    const result = findBestSpot(history.measurements, operator, gps, now);
    return result.status === 'no-data' && history.truncated ? { status: 'history-incomplete' } : result;
  } catch (error) {
    return { status: 'history-error', message: error instanceof Error ? error.message : 'Measurement history request failed.' };
  }
}

export async function refreshAndSearchAfterSave<T>(
  refresh: () => Promise<unknown>,
  invalidate: () => void,
  search: () => Promise<T>
): Promise<T> {
  await refresh();
  invalidate();
  return search();
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function validGps(gps: BestSpotGps): boolean {
  return Number.isFinite(gps.lat) && gps.lat >= -90 && gps.lat <= 90 && Number.isFinite(gps.lng) && gps.lng >= -180 && gps.lng <= 180 &&
    Number.isFinite(gps.accuracy) && gps.accuracy >= 0 && gps.accuracy <= MAX_VALID_GPS_ACCURACY_METERS && Number.isFinite(gps.timestamp);
}

function validMeasurement(row: LiveMeasurement, operator: TelecomOperator, now: number): boolean {
  const measuredAt = Date.parse(row.timestamp);
  return row.operator === operator && row.measurementMethodVersion === 'quality-v2' && row.status !== 'UNAVAILABLE' &&
    Number.isFinite(row.latitude) && row.latitude >= -90 && row.latitude <= 90 &&
    Number.isFinite(row.longitude) && row.longitude >= -180 && row.longitude <= 180 && Number.isFinite(row.accuracy) && row.accuracy >= 0 && row.accuracy <= MAX_VALID_GPS_ACCURACY_METERS &&
    Number.isFinite(row.nqs) && row.nqs >= 0 && row.nqs <= 100 && Number.isFinite(measuredAt) && measuredAt <= now &&
    ['latencyMs', 'downloadMbps', 'uploadMbps', 'jitterMs', 'probeFailurePercent'].every((key) => {
      const value = row[key as keyof LiveMeasurement];
      if (value === undefined || value === null) return true;
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      const max = key === 'downloadMbps' || key === 'uploadMbps' ? 100000 : key === 'probeFailurePercent' ? 100 : 600000;
      return value >= 0 && value <= max;
    }) && (row.signalDbm === undefined || (Number.isFinite(row.signalDbm) && row.signalDbm >= -200 && row.signalDbm <= 0)) &&
    calculateMeasurementNqs(row).verification === 'match';
}

function available(row: LiveMeasurement, key: string, value: number | undefined): value is number {
  return row.metricAvailability?.[key] === true && typeof value === 'number' && Number.isFinite(value);
}

function averageMetric(rows: LiveMeasurement[], key: string, field: keyof LiveMeasurement): number | undefined {
  const values = rows.flatMap((row) => {
    const value = row[field];
    return available(row, key, typeof value === 'number' ? value : undefined) ? [value as number] : [];
  });
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function makeCandidate(rows: LiveMeasurement[], gps: BestSpotGps, now: number): BestSpotCandidate {
  const lastMeasured = rows.reduce((latest, row) => Date.parse(row.timestamp) > Date.parse(latest) ? row.timestamp : latest, rows[0].timestamp);
  const newestAge = Math.max(0, now - Date.parse(lastMeasured));
  const recentWeights = rows.map((row) => Math.pow(0.5, Math.max(0, now - Date.parse(row.timestamp)) / RECENCY_HALF_LIFE_MS));
  const weightTotal = recentWeights.reduce((sum, weight) => sum + weight, 0);
  const nqs = rows.reduce((sum, row, i) => sum + row.nqs * recentWeights[i], 0) / weightTotal;
  const averageAccuracy = rows.reduce((sum, row) => sum + row.accuracy, 0) / rows.length;
  const confidenceAdjustedNqs = 50 + (nqs - 50) * (rows.length / (rows.length + 2));
  const sampleSupport = 100 * (1 - Math.exp(-rows.length / 3));
  const recency = 100 * Math.pow(0.5, newestAge / RECENCY_HALF_LIFE_MS);
  const gpsAccuracy = 100 / (1 + averageAccuracy / 10);
  const rankScore = confidenceAdjustedNqs * 0.7 + sampleSupport * 0.15 + recency * 0.1 + gpsAccuracy * 0.05;
  // Keep the map coordinate tied to an actual saved fix (best accuracy, then newest), not a synthetic centroid.
  const representative = [...rows].sort((a, b) => a.accuracy - b.accuracy || Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  const latitude = representative.latitude;
  const longitude = representative.longitude;
  const metricAvailability: Record<string, boolean> = {};
  const metrics = {
    latencyMs: averageMetric(rows, 'latency', 'latencyMs'), downloadMbps: averageMetric(rows, 'download', 'downloadMbps'),
    uploadMbps: averageMetric(rows, 'upload', 'uploadMbps'), jitterMs: averageMetric(rows, 'jitter', 'jitterMs'),
    probeFailurePercent: averageMetric(rows, 'probeFailure', 'probeFailurePercent'), signalDbm: averageMetric(rows, 'signal', 'signalDbm')
  };
  for (const [key, value] of Object.entries({ latency: metrics.latencyMs, download: metrics.downloadMbps, upload: metrics.uploadMbps,
    jitter: metrics.jitterMs, probeFailure: metrics.probeFailurePercent, signal: metrics.signalDbm })) metricAvailability[key] = value !== undefined;
  return { latitude, longitude, distanceMeters: distanceMeters(gps, { lat: latitude, lng: longitude }), operator: rows[0].operator,
    searchGpsAccuracy: gps.accuracy, nqs: Math.round(nqs), rankScore: Math.round(rankScore * 10) / 10, sampleCount: rows.length, lastMeasured,
    averageAccuracy, metrics, metricAvailability };
}

export function findBestSpot(
  records: LiveMeasurement[], operator: TelecomOperator, gps: BestSpotGps | null, now = Date.now(),
  radiusMeters = FIND_BEST_SPOT_RADIUS_METERS
): BestSpotResult {
  if (!gps) return { status: 'gps-unavailable' };
  if (!validGps(gps)) return { status: 'gps-invalid' };
  if (now - gps.timestamp > MAX_FIND_GPS_AGE_MS || gps.timestamp > now) return { status: 'gps-stale' };
  const nearby = records.filter((row) => validMeasurement(row, operator, now) &&
    distanceMeters(gps, { lat: row.latitude, lng: row.longitude }) <= radiusMeters);
  if (!nearby.length) return { status: 'no-data', searchGpsAccuracy: gps.accuracy };

  // Greedy bounded-radius clustering prevents a long chain of nearby records from merging distant spots.
  const sorted = [...nearby].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const clusters: LiveMeasurement[][] = [];
  for (const row of sorted) {
    const cluster = clusters.find((items) => distanceMeters({ lat: items[0].latitude, lng: items[0].longitude }, { lat: row.latitude, lng: row.longitude }) <= CANDIDATE_GROUP_RADIUS_METERS);
    if (cluster) cluster.push(row); else clusters.push([row]);
  }
  const candidates = clusters.map((cluster) => makeCandidate(cluster, gps, now));
  candidates.sort((a, b) => b.rankScore - a.rankScore || b.sampleCount - a.sampleCount || b.nqs - a.nqs);
  return { status: 'success', candidate: candidates[0] };
}
