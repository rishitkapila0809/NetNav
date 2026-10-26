import { distanceMeters } from './routeNetworkOverlay.ts';
import type { RouteCoordinate, WalkingRouteOption } from './walkingRoutes.ts';

export interface NavigationGpsFix extends RouteCoordinate { accuracy: number; timestamp: number }
export interface RouteProgress { distanceAlongMeters: number; remainingMeters: number; progressPercent: number; remainingSeconds: number; distanceFromRouteMeters: number }
export const MAX_NAVIGATION_GPS_AGE_MS = 15_000;
export const MAX_NAVIGATION_GPS_ACCURACY_METERS = 50;
export const OFF_ROUTE_CONFIRMATION_FIXES = 3;

export function validateNavigationFix(fix: NavigationGpsFix | null, now = Date.now()): 'ready' | 'missing' | 'stale' | 'inaccurate' | 'invalid' {
  if (!fix) return 'missing';
  if (!Number.isFinite(fix.lat) || fix.lat < -90 || fix.lat > 90 || !Number.isFinite(fix.lng) || fix.lng < -180 || fix.lng > 180 || !Number.isFinite(fix.timestamp) || !Number.isFinite(fix.accuracy) || fix.accuracy < 0) return 'invalid';
  if (now < fix.timestamp || now - fix.timestamp > MAX_NAVIGATION_GPS_AGE_MS) return 'stale';
  return fix.accuracy <= MAX_NAVIGATION_GPS_ACCURACY_METERS ? 'ready' : 'inaccurate';
}

function project(point: RouteCoordinate, start: RouteCoordinate, end: RouteCoordinate): { distance: number; ratio: number } {
  const rad = Math.PI / 180, meanLat = ((point.lat + start.lat + end.lat) / 3) * rad, scale = 6_371_000;
  const toXY = (value: RouteCoordinate) => ({ x: value.lng * rad * Math.cos(meanLat) * scale, y: value.lat * rad * scale });
  const p = toXY(point), a = toXY(start), b = toXY(end), dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const ratio = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return { distance: Math.hypot(p.x - (a.x + ratio * dx), p.y - (a.y + ratio * dy)), ratio };
}

/** Projects the fix to the closest point along the route, then measures remaining path length. */
export function calculateRouteProgress(route: WalkingRouteOption, point: RouteCoordinate): RouteProgress {
  const path = route.path;
  if (path.length < 2 || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) throw new Error('Cannot calculate progress without a valid route and position.');
  const lengths = path.slice(1).map((coordinate, index) => distanceMeters(path[index], coordinate));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (!total) throw new Error('Route geometry has no measurable length.');
  let cumulative = 0, nearestAlong = 0, nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < lengths.length; index++) {
    const projection = project(point, path[index], path[index + 1]);
    if (projection.distance < nearestDistance) {
      nearestDistance = projection.distance;
      nearestAlong = cumulative + lengths[index] * projection.ratio;
    }
    cumulative += lengths[index];
  }
  const progressPercent = Math.max(0, Math.min(100, (nearestAlong / total) * 100));
  return { distanceAlongMeters: nearestAlong, remainingMeters: Math.max(0, total - nearestAlong), progressPercent,
    remainingSeconds: Math.max(0, route.durationSeconds * (1 - progressPercent / 100)), distanceFromRouteMeters: nearestDistance };
}

export function isGpsJump(previous: NavigationGpsFix | null, current: NavigationGpsFix, maxSpeedMetersPerSecond = 15, maxJumpMeters = 100): boolean {
  if (!previous) return false;
  const elapsedSeconds = (current.timestamp - previous.timestamp) / 1000;
  if (elapsedSeconds <= 0) return true;
  return distanceMeters(previous, current) > Math.max(maxJumpMeters, elapsedSeconds * maxSpeedMetersPerSecond);
}

export function advanceOffRouteFixCount(distanceFromRouteMeters: number, accuracyMeters: number, previousCount: number): { count: number; offRoute: boolean } {
  const threshold = Math.max(25, accuracyMeters * 1.5);
  const count = distanceFromRouteMeters > threshold ? previousCount + 1 : 0;
  return { count, offRoute: count >= OFF_ROUTE_CONFIRMATION_FIXES };
}

export function canRequestReroute(lastRequestAt: number, now: number, inFlight: boolean, cooldownMs = 20_000): boolean {
  return !inFlight && Number.isFinite(now) && Number.isFinite(lastRequestAt) && now - lastRequestAt >= cooldownMs;
}

export function startNavigationSession(route: WalkingRouteOption | null, routeState: string, fix: NavigationGpsFix | null, now = Date.now()): WalkingRouteOption | null {
  return route && routeState === 'ready' && route.path.length >= 2 && validateNavigationFix(fix, now) === 'ready' ? route : null;
}

export function endNavigationSession(): null { return null; }
