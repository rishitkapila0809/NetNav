import type { LiveMeasurement, TelecomOperator } from '../types';
import type { RouteCoordinate } from './walkingRoutes';

export const ROUTE_BIN_METERS = 20;
export const MAX_MEASUREMENT_MATCH_METERS = 25;
const RECENCY_HALF_LIFE_MS = 30 * 86_400_000;
export type RouteSectionClass = 'good' | 'moderate' | 'poor' | 'unknown';
export interface RouteBin { index: number; start: RouteCoordinate; end: RouteCoordinate; midpoint: RouteCoordinate; lengthMeters: number }
export interface NetworkRouteBin extends RouteBin { classification: RouteSectionClass; nqs: number | null; confidence: number; sampleCount: number }
export interface RouteNetworkOverlay {
  operator: TelecomOperator; bins: NetworkRouteBin[]; coveragePercent: number; newestMeasurement: string | null;
  goodMeters: number; moderateMeters: number; poorMeters: number; unknownMeters: number;
}

export function distanceMeters(a: RouteCoordinate, b: RouteCoordinate): number {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function interpolate(a: RouteCoordinate, b: RouteCoordinate, ratio: number): RouteCoordinate {
  return { lat: a.lat + (b.lat - a.lat) * ratio, lng: a.lng + (b.lng - a.lng) * ratio };
}

export function sampleRouteIntoBins(path: RouteCoordinate[], binSizeMeters = ROUTE_BIN_METERS): RouteBin[] {
  if (!Number.isFinite(binSizeMeters) || binSizeMeters <= 0) throw new Error('Route bin size must be positive');
  if (path.length < 2 || path.some((point) => !Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90 || !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180)) return [];
  const bins: RouteBin[] = [];
  let binStart = path[0], accumulated = 0;
  for (let edge = 0; edge < path.length - 1; edge++) {
    const a = path[edge], b = path[edge + 1], edgeLength = distanceMeters(a, b);
    if (edgeLength < 0.01) continue;
    let consumed = 0;
    while (consumed < edgeLength) {
      const needed = binSizeMeters - accumulated;
      const amount = Math.min(needed, edgeLength - consumed);
      consumed += amount;
      accumulated += amount;
      const end = interpolate(a, b, consumed / edgeLength);
      if (accumulated >= binSizeMeters - 0.001) {
        bins.push({ index: bins.length, start: binStart, end, midpoint: interpolate(binStart, end, 0.5), lengthMeters: accumulated });
        binStart = end;
        accumulated = 0;
      }
    }
  }
  if (accumulated > 0.01) {
    const end = path.at(-1)!;
    bins.push({ index: bins.length, start: binStart, end, midpoint: interpolate(binStart, end, 0.5), lengthMeters: accumulated });
  }
  return bins;
}

/** Local equirectangular projection is accurate for the short bins used on campus. */
export function distancePointToSegmentMeters(point: RouteCoordinate, start: RouteCoordinate, end: RouteCoordinate): number {
  const rad = Math.PI / 180, meanLat = ((point.lat + start.lat + end.lat) / 3) * rad;
  const toXY = (coord: RouteCoordinate) => ({ x: coord.lng * rad * Math.cos(meanLat) * 6_371_000, y: coord.lat * rad * 6_371_000 });
  const p = toXY(point), a = toXY(start), b = toXY(end), dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function validMeasurement(row: LiveMeasurement, operator: TelecomOperator, now: number): boolean {
  const timestamp = Date.parse(row.timestamp);
  return row.operator === operator && Number.isFinite(row.latitude) && row.latitude >= -90 && row.latitude <= 90 &&
    Number.isFinite(row.longitude) && row.longitude >= -180 && row.longitude <= 180 && Number.isFinite(row.accuracy) && row.accuracy >= 0 && row.accuracy <= 10000 &&
    Number.isFinite(row.nqs) && row.nqs >= 0 && row.nqs <= 100 && Number.isFinite(timestamp) && timestamp <= now;
}

export function buildRouteNetworkOverlay(
  path: RouteCoordinate[], measurements: LiveMeasurement[], operator: TelecomOperator, now = Date.now(), binSizeMeters = ROUTE_BIN_METERS
): RouteNetworkOverlay {
  const bins = sampleRouteIntoBins(path, binSizeMeters);
  const assigned = bins.map(() => [] as LiveMeasurement[]);
  const unique = new Map<string, LiveMeasurement>();
  for (const row of measurements) if (validMeasurement(row, operator, now)) unique.set(row.id, row);

  // Assign each record to its nearest route bin only. This prevents one point from painting an extended route area.
  for (const row of unique.values()) {
    let nearestIndex = -1, nearestDistance = Number.POSITIVE_INFINITY;
    for (const bin of bins) {
      const distance = distancePointToSegmentMeters({ lat: row.latitude, lng: row.longitude }, bin.start, bin.end);
      const radius = Math.min(MAX_MEASUREMENT_MATCH_METERS, Math.max(8, row.accuracy));
      if (distance <= radius && distance < nearestDistance) { nearestDistance = distance; nearestIndex = bin.index; }
    }
    if (nearestIndex >= 0) assigned[nearestIndex].push(row);
  }

  let newestMeasurement: string | null = null;
  const networkBins: NetworkRouteBin[] = bins.map((bin, index) => {
    const rows = assigned[index];
    if (!rows.length) return { ...bin, classification: 'unknown', nqs: null, confidence: 0, sampleCount: 0 };
    const weights = rows.map((row) => Math.pow(0.5, Math.max(0, now - Date.parse(row.timestamp)) / RECENCY_HALF_LIFE_MS));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const nqs = rows.reduce((sum, row, i) => sum + row.nqs * weights[i], 0) / totalWeight;
    const recent = totalWeight / rows.length;
    const accuracyQuality = rows.reduce((sum, row, i) => sum + (1 / (1 + row.accuracy / 20)) * weights[i], 0) / totalWeight;
    const confidence = (rows.length / (rows.length + 2)) * recent * accuracyQuality;
    for (const row of rows) if (!newestMeasurement || Date.parse(row.timestamp) > Date.parse(newestMeasurement)) newestMeasurement = row.timestamp;
    const classification: RouteSectionClass = rows.length < 2 || confidence < 0.2 ? 'unknown' : nqs >= 70 ? 'good' : nqs >= 40 ? 'moderate' : 'poor';
    return { ...bin, classification, nqs: classification === 'unknown' ? null : Math.round(nqs), confidence, sampleCount: rows.length };
  });

  const totalMeters = networkBins.reduce((sum, bin) => sum + bin.lengthMeters, 0);
  const metersFor = (classification: RouteSectionClass) => networkBins.filter((bin) => bin.classification === classification).reduce((sum, bin) => sum + bin.lengthMeters, 0);
  const goodMeters = metersFor('good'), moderateMeters = metersFor('moderate'), poorMeters = metersFor('poor'), unknownMeters = metersFor('unknown');
  return { operator, bins: networkBins, coveragePercent: totalMeters ? Math.round(((totalMeters - unknownMeters) / totalMeters) * 100) : 0,
    newestMeasurement, goodMeters, moderateMeters, poorMeters, unknownMeters };
}
