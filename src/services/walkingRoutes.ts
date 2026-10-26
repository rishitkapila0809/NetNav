export interface RouteCoordinate { lat: number; lng: number }
export interface WalkingRouteOption {
  id: string; distanceMeters: number; durationSeconds: number; path: RouteCoordinate[]; routeLabel: string;
}
export interface WalkingRouteRequest {
  origin: RouteCoordinate; destination: RouteCoordinate; travelMode: 'WALKING'; computeAlternativeRoutes: true;
  fields: ['path', 'distanceMeters', 'duration', 'routeLabels'];
}
type RouteLike = { path?: Array<RouteCoordinate | { lat: () => number; lng: () => number }>; distanceMeters?: number; duration?: string; routeLabels?: string[] };
type RouteResponse = { routes?: RouteLike[] };
export type ComputeRoutes = (request: WalkingRouteRequest) => Promise<RouteResponse>;

export function isValidCurrentRouteOrigin(
  gps: { lat: number; lng: number; accuracy: number; timestamp: number } | null,
  now = Date.now(), maxAgeMs = 30_000, maxAccuracyMeters = 50
): boolean {
  return !!gps && Number.isFinite(gps.lat) && gps.lat >= -90 && gps.lat <= 90 && Number.isFinite(gps.lng) && gps.lng >= -180 && gps.lng <= 180 &&
    Number.isFinite(gps.accuracy) && gps.accuracy >= 0 && gps.accuracy <= maxAccuracyMeters && Number.isFinite(gps.timestamp) &&
    now >= gps.timestamp && now - gps.timestamp <= maxAgeMs;
}

export class WalkingRouteError extends Error {
  readonly code: 'NOT_FOUND' | 'API_ERROR' | 'INVALID_RESPONSE';
  constructor(message: string, code: 'NOT_FOUND' | 'API_ERROR' | 'INVALID_RESPONSE') { super(message); this.name = 'WalkingRouteError'; this.code = code; }
}

export function buildWalkingRouteRequest(origin: RouteCoordinate, destination: RouteCoordinate): WalkingRouteRequest {
  return { origin, destination, travelMode: 'WALKING', computeAlternativeRoutes: true, fields: ['path', 'distanceMeters', 'duration', 'routeLabels'] };
}

function readCoordinate(value: RouteCoordinate | { lat: () => number; lng: () => number }): RouteCoordinate {
  const point = value as unknown as { lat: number | (() => number); lng: number | (() => number) };
  const lat = typeof point.lat === 'function' ? point.lat() : point.lat;
  const lng = typeof point.lng === 'function' ? point.lng() : point.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new WalkingRouteError('Google returned invalid route geometry.', 'INVALID_RESPONSE');
  }
  return { lat, lng };
}

function durationSeconds(value: string | undefined): number {
  const match = value?.match(/^(\d+(?:\.\d+)?)s$/);
  return match ? Number(match[1]) : Number.NaN;
}

export async function requestWalkingRoutesWith(computeRoutes: ComputeRoutes, origin: RouteCoordinate, destination: RouteCoordinate): Promise<WalkingRouteOption[]> {
  let response: RouteResponse;
  try { response = await computeRoutes(buildWalkingRouteRequest(origin, destination)); }
  catch { throw new WalkingRouteError('Google Maps could not calculate walking routes. Check Maps/Routes API access and retry.', 'API_ERROR'); }
  if (!Array.isArray(response.routes) || response.routes.length === 0) {
    throw new WalkingRouteError('No walking route was found between those points.', 'NOT_FOUND');
  }
  const routes = response.routes.map((route, index) => {
    const path = Array.isArray(route.path) ? route.path.map(readCoordinate) : [];
    const seconds = durationSeconds(route.duration);
    if (path.length < 2 || !Number.isFinite(route.distanceMeters) || route.distanceMeters! < 0 || !Number.isFinite(seconds)) {
      throw new WalkingRouteError('Google returned incomplete walking route data.', 'INVALID_RESPONSE');
    }
    return { id: String(index), distanceMeters: route.distanceMeters!, durationSeconds: seconds, path,
      routeLabel: route.routeLabels?.[0] ?? (index === 0 ? 'DEFAULT_ROUTE' : 'ALTERNATE_ROUTE') };
  });
  return routes;
}

export function selectWalkingRoute(routes: WalkingRouteOption[], index: number): WalkingRouteOption | null {
  return Number.isInteger(index) && index >= 0 ? routes[index] ?? null : null;
}
