export const MAX_MEASUREMENT_GPS_AGE_MS = 10_000;
export const MAX_MEASUREMENT_GPS_ACCURACY_METERS = 10;

export interface MeasurementGpsFix {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export type MeasurementGpsStatus = 'ready' | 'missing' | 'invalid' | 'stale' | 'inaccurate';

export function validateMeasurementGps(
  fix: MeasurementGpsFix | null,
  now = Date.now(),
  maxAgeMs = MAX_MEASUREMENT_GPS_AGE_MS,
  maxAccuracyMeters = MAX_MEASUREMENT_GPS_ACCURACY_METERS
): MeasurementGpsStatus {
  if (!fix) return 'missing';
  if (!Number.isFinite(fix.lat) || fix.lat < -90 || fix.lat > 90 || !Number.isFinite(fix.lng) || fix.lng < -180 || fix.lng > 180 ||
      !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || !Number.isFinite(fix.timestamp) || fix.timestamp > now) return 'invalid';
  if (now - fix.timestamp > maxAgeMs) return 'stale';
  if (fix.accuracy > maxAccuracyMeters) return 'inaccurate';
  return 'ready';
}

export function measurementGpsMessage(status: MeasurementGpsStatus): string {
  switch (status) {
    case 'missing': return 'Waiting for a GPS fix before measuring.';
    case 'invalid': return 'The browser returned invalid GPS coordinates. Retry location access.';
    case 'stale': return 'GPS fix is older than 10 seconds. Measurement paused until a fresh fix arrives.';
    case 'inaccurate': return `GPS accuracy must be ±${MAX_MEASUREMENT_GPS_ACCURACY_METERS} m or better for a location-based sample.`;
    default: return '';
  }
}
import type { LiveMeasurement } from '../types';


/** Persist only corrected, scored rows from cycles that actually ran the active throughput tests. */
export function shouldPersistMeasurement(sample: LiveMeasurement): boolean {
  return sample.measurementMethodVersion === 'quality-v2' && sample.throughputTestPerformed === true &&
    !sample.isOffline && sample.status !== 'NO_CONNECTIVITY' && sample.status !== 'UNAVAILABLE' &&
    Number.isFinite(sample.nqs) && sample.nqs >= 0 && sample.nqs <= 100 &&
    Number.isFinite(Date.parse(sample.timestamp)) &&
    Number.isFinite(sample.latitude) && sample.latitude >= -90 && sample.latitude <= 90 &&
    Number.isFinite(sample.longitude) && sample.longitude >= -180 && sample.longitude <= 180 &&
    Number.isFinite(sample.accuracy) && sample.accuracy >= 0 && sample.accuracy <= MAX_MEASUREMENT_GPS_ACCURACY_METERS;
}
