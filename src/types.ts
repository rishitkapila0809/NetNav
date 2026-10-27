export type TelecomOperator = 'Jio' | 'Airtel' | 'Vi' | 'BSNL';

export type NetworkStatus = 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'POOR' | 'NO_CONNECTIVITY' | 'UNAVAILABLE';
export type MeasurementMethodVersion = 'legacy-v1' | 'quality-v2';

export interface NetworkMetrics {
  nqs: number;
  status: NetworkStatus;
  latencyMs: number;
  probeFailurePercent: number;
  throughputMbps: number;
  jitterMs: number;
  signalDbm?: number;
  signalStatus?: 'AVAILABLE' | 'UNAVAILABLE';
  frequencyGhz?: number;
  band?: string;
}

export interface CampusPoint {
  id: string;
  name: string;
  buildingCode: string;
  x: number; // percentage coordinate 0-100
  y: number; // percentage coordinate 0-100
  nqs: number;
  status: NetworkStatus;
  operatorScores: Record<TelecomOperator, number>;
  isBestSpot?: boolean;
  isUserLocation?: boolean;
  lastMeasured: string;
  distanceMeters: number;
  landmarkType: 'academic' | 'hostel' | 'amenity' | 'gate' | 'open';
}

export interface OperatorOption {
  id: TelecomOperator;
  name: string;
  badge: string;
  avgNqs: number;
  status: NetworkStatus;
  color: string;
}

export interface GpsObservation {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  speed: number | null;
  heading: number | null;
}

export interface LiveMeasurement {
  id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed?: number | null;
  heading?: number | null;
  timestamp: string;
  latencyMs: number;
  jitterMs: number;
  probeFailurePercent: number;
  downloadMbps: number;
  uploadMbps: number;
  signalDbm?: number;
  signalStatus: 'AVAILABLE' | 'UNAVAILABLE';
  nqs: number;
  status: NetworkStatus;
  operator: TelecomOperator;
  /** Indicates whether this row uses the corrected probe window and persistence cadence. */
  measurementMethodVersion?: MeasurementMethodVersion;
  /** True only for the sample cycle that actually attempted active download/upload tests. */
  throughputTestPerformed?: boolean;
  /** Time of the most recent successful throughput test; historical rows default to timestamp. */
  downloadMeasuredAt?: string;
  uploadMeasuredAt?: string;
  isOffline?: boolean;
  metricAvailability?: Record<string, boolean>;
  isProvisional?: boolean;
  offlineReason?: 'MEASUREMENT_SERVER_UNREACHABLE';
  nqsComponents?: { latency: number | null; throughput: number | null; probeFailure: number | null; jitter: number | null; raw: number | null };
}

export interface RouteSegment {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  nqs: number;
  status: NetworkStatus;
  color: string;
}

export interface MeasurementSessionSummary {
  totalMeasurements: number;
  distanceMeters: number;
  durationSeconds: number;
  bestSpot: LiveMeasurement | null;
  worstSpot: LiveMeasurement | null;
  startTime: string;
  endTime: string;
  avgNqs: number;
  offlineCount: number;
}
