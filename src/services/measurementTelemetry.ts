import type { LiveMeasurement, TelecomOperator } from '../types';
import { NQS_BROWSER_WEIGHTS, networkMeasurer } from './networkMeasurer.ts';

export const NQS_FORMULA_VERSION = 'browser-renormalized-v2';
export type TelemetrySource = 'live' | 'persisted';
export type FormulaVerification = 'match' | 'mismatch' | 'unavailable' | 'unsupported-signal' | 'legacy-method';
export interface NqsComponentDetail {
  key: 'latency' | 'throughput' | 'probeFailure' | 'jitter' | 'signal';
  label: string;
  raw: number | undefined;
  unit: 'ms' | 'Mbps' | '%' | 'dBm';
  weight: number;
  score: number | null;
  contribution: number | null;
}

export interface MeasurementNqsEvaluation {
  nqs: number | null;
  verification: FormulaVerification;
  availableWeight: number;
  isProvisional: boolean;
  components: NqsComponentDetail[];
}

export function selectLatestPersistedMeasurement(rows: LiveMeasurement[], operator: TelecomOperator): LiveMeasurement | null {
  return rows.filter((row) => row.operator === operator && Number.isFinite(Date.parse(row.timestamp)))
    .reduce<LiveMeasurement | null>((latest, row) => !latest || Date.parse(row.timestamp) > Date.parse(latest.timestamp) ? row : latest, null);
}

export function calculateMeasurementNqs(row: LiveMeasurement): MeasurementNqsEvaluation {
  const noData = (verification: FormulaVerification): MeasurementNqsEvaluation => ({ nqs: null, verification, availableWeight: 0, isProvisional: false, components: [] });
  if (row.isOffline || row.status === 'NO_CONNECTIVITY') return noData('unavailable');
  if (row.measurementMethodVersion === 'legacy-v1') return noData('legacy-method');
  const availability = row.metricAvailability ?? {};
  const candidates: NqsComponentDetail[] = [
    { key: 'latency', label: 'Latency (L)', raw: row.latencyMs, unit: 'ms', weight: NQS_BROWSER_WEIGHTS.latency, score: availability.latency === true && Number.isFinite(row.latencyMs) && row.latencyMs >= 0 && row.latencyMs <= 600000 ? networkMeasurer.calcLatencyScore(row.latencyMs) : null, contribution: null },
    { key: 'throughput', label: 'Download (T)', raw: row.downloadMbps, unit: 'Mbps', weight: NQS_BROWSER_WEIGHTS.throughput, score: availability.download === true && Number.isFinite(row.downloadMbps) && row.downloadMbps >= 0 && row.downloadMbps <= 100000 ? networkMeasurer.calcThroughputScore(row.downloadMbps) : null, contribution: null },
    { key: 'probeFailure', label: 'HTTP failure (P)', raw: row.probeFailurePercent, unit: '%', weight: NQS_BROWSER_WEIGHTS.probeFailure, score: availability.probeFailure === true && Number.isFinite(row.probeFailurePercent) && row.probeFailurePercent >= 0 && row.probeFailurePercent <= 100 ? networkMeasurer.calcProbeFailureScore(row.probeFailurePercent) : null, contribution: null },
    { key: 'jitter', label: 'Jitter (J)', raw: row.jitterMs, unit: 'ms', weight: NQS_BROWSER_WEIGHTS.jitter, score: availability.jitter === true && Number.isFinite(row.jitterMs) && row.jitterMs >= 0 && row.jitterMs <= 600000 ? networkMeasurer.calcJitterScore(row.jitterMs) : null, contribution: null },
    { key: 'signal', label: 'Signal (S)', raw: row.signalDbm, unit: 'dBm', weight: NQS_BROWSER_WEIGHTS.signal, score: null, contribution: null }
  ];
  const components = candidates.map((component) => ({ ...component, contribution: component.score === null ? null : component.weight * component.score }));
  const availableWeight = components.reduce((sum, component) => sum + (component.score === null ? 0 : component.weight), 0);
  const availableCount = components.filter((c) => c.score !== null && c.weight > 0).length;
  if (availability.signal === true) return { nqs: null, verification: 'unsupported-signal', availableWeight, isProvisional: false, components };
  if (availableWeight === 0 || availableCount === 0) return { nqs: null, verification: 'unavailable', availableWeight: 0, isProvisional: false, components };
  const score = Math.round(components.reduce((sum, component) => sum + (component.contribution ?? 0), 0) / availableWeight);
  const verification = score === row.nqs ? 'match' : 'mismatch';
  const isProvisional = availableCount < 4;
  return { nqs: score, verification, availableWeight, isProvisional, components };
}

/** Keep current-session and persisted rows distinct; only compare rows for the selected operator. */
export function selectTelemetryMeasurement(
  liveRows: LiveMeasurement[], latestPersisted: LiveMeasurement | null, operator: TelecomOperator
): { measurement: LiveMeasurement | null; source: TelemetrySource | null } {
  const latestLive = liveRows.filter((row) => row.operator === operator && Number.isFinite(Date.parse(row.timestamp)))
    .reduce<LiveMeasurement | null>((latest, row) => !latest || Date.parse(row.timestamp) > Date.parse(latest.timestamp) ? row : latest, null);
  if (latestLive && (!latestPersisted || Date.parse(latestLive.timestamp) >= Date.parse(latestPersisted.timestamp))) {
    return { measurement: latestLive, source: 'live' };
  }
  return latestPersisted?.operator === operator ? { measurement: latestPersisted, source: 'persisted' } : { measurement: null, source: null };
}

export function telemetryEmptyMessage(status: 'loading' | 'loaded' | 'error', operator: string): string {
  if (status === 'loading') return `Loading saved ${operator} measurement…`;
  if (status === 'error') return `Could not load saved ${operator} measurement.`;
  return `No valid live or saved measurement for ${operator}.`;
}
