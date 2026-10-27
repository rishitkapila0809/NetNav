export const MAX_MEASUREMENT_GPS_AGE_MS = 10_000;
export const MAX_VALID_GPS_ACCURACY_METERS = 10_000;
export const PREFERRED_GPS_ACCURACY_METERS = 10;

export interface MeasurementGpsFix {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export type MeasurementGpsStatus = 'ready' | 'missing' | 'invalid' | 'stale';
export type MeasurementStartStatus = MeasurementGpsStatus | 'operator-required';

export function validateMeasurementStart(operator: unknown, fix: MeasurementGpsFix | null, now = Date.now()): MeasurementStartStatus {
  if (!['Jio', 'Airtel', 'Vi', 'BSNL'].includes(String(operator))) return 'operator-required';
  return validateMeasurementGps(fix, now);
}

export function validateMeasurementGps(
  fix: MeasurementGpsFix | null,
  now = Date.now(),
  maxAgeMs = MAX_MEASUREMENT_GPS_AGE_MS
): MeasurementGpsStatus {
  if (!fix) return 'missing';
  if (!Number.isFinite(fix.lat) || fix.lat < -90 || fix.lat > 90 || !Number.isFinite(fix.lng) || fix.lng < -180 || fix.lng > 180 ||
      !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > MAX_VALID_GPS_ACCURACY_METERS || !Number.isFinite(fix.timestamp) || fix.timestamp > now) return 'invalid';
  if (now - fix.timestamp > maxAgeMs) return 'stale';
  return 'ready';
}

export function hasPreferredGpsAccuracy(fix: MeasurementGpsFix | null): boolean {
  return !!fix && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= PREFERRED_GPS_ACCURACY_METERS;
}

export function measurementGpsAccuracyWarning(fix: MeasurementGpsFix | null): string | null {
  if (!fix || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > MAX_VALID_GPS_ACCURACY_METERS || hasPreferredGpsAccuracy(fix)) return null;
  return `GPS accuracy is approximately ±${Math.round(fix.accuracy)} m. Results may be less precise. We’re still trying to improve your location.`;
}

/** Maps the browser's reported horizontal uncertainty directly to the Google Maps circle radius. */
export function gpsAccuracyCircleRadiusMeters(accuracy: number): number | null {
  return Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= MAX_VALID_GPS_ACCURACY_METERS ? accuracy : null;
}

export function measurementGpsMessage(status: MeasurementGpsStatus): string {
  switch (status) {
    case 'missing': return 'Waiting for a GPS fix before measuring.';
    case 'invalid': return 'The browser returned invalid GPS coordinates. Retry location access.';
    case 'stale': return 'GPS fix is older than 10 seconds. Measurement paused until a fresh fix arrives.';
    default: return '';
  }
}
import type { LiveMeasurement } from '../types';


/** Persist only corrected, scored rows from cycles that actually ran the active throughput tests. */
export function shouldPersistMeasurement(sample: LiveMeasurement): boolean {
  return sample.measurementMethodVersion === 'quality-v2' && sample.throughputTestPerformed === true &&
    !sample.isOffline && sample.status !== 'NO_CONNECTIVITY' && sample.status !== 'UNAVAILABLE' &&
    sample.metricAvailability?.probeFailure === true &&
    Number.isFinite(sample.nqs) && sample.nqs >= 0 && sample.nqs <= 100 &&
    Number.isFinite(Date.parse(sample.timestamp)) &&
    Number.isFinite(sample.latitude) && sample.latitude >= -90 && sample.latitude <= 90 &&
    Number.isFinite(sample.longitude) && sample.longitude >= -180 && sample.longitude <= 180 &&
    Number.isFinite(sample.accuracy) && sample.accuracy >= 0 && sample.accuracy <= MAX_VALID_GPS_ACCURACY_METERS;
}
