import type { LiveMeasurement, TelecomOperator } from '../types';
import { networkMeasurer } from './networkMeasurer.ts';

export const NQS_FORMULA_VERSION = 'LTPJ-renormalized-v1';
export type TelemetrySource = 'live' | 'persisted';
export type FormulaVerification = 'match' | 'mismatch' | 'unavailable' | 'unsupported-signal';

export function selectLatestPersistedMeasurement(rows: LiveMeasurement[], operator: TelecomOperator): LiveMeasurement | null {
  return rows.filter((row) => row.operator === operator && Number.isFinite(Date.parse(row.timestamp)))
    .reduce<LiveMeasurement | null>((latest, row) => !latest || Date.parse(row.timestamp) > Date.parse(latest.timestamp) ? row : latest, null);
}

export function calculateMeasurementNqs(row: LiveMeasurement): { nqs: number | null; verification: FormulaVerification } {
  if (row.isOffline || row.status === 'NO_CONNECTIVITY') return { nqs: null, verification: 'unavailable' };
  const availability = row.metricAvailability ?? {};
  if (availability.signal === true) return { nqs: null, verification: 'unsupported-signal' };
  const scoreCandidates: Array<[number, number] | null> = [
    availability.latency === true && Number.isFinite(row.latencyMs) ? [0.25, networkMeasurer.calcLatencyScore(row.latencyMs)] : null,
    availability.download === true && Number.isFinite(row.downloadMbps) ? [0.30, networkMeasurer.calcThroughputScore(row.downloadMbps)] : null,
    availability.packetLoss === true && Number.isFinite(row.packetLossPercent) ? [0.20, networkMeasurer.calcPacketLossScore(row.packetLossPercent)] : null,
    availability.jitter === true && Number.isFinite(row.jitterMs) ? [0.10, networkMeasurer.calcJitterScore(row.jitterMs)] : null,
  ];
  const scores = scoreCandidates.filter((value): value is [number, number] => value !== null);
  const weight = scores.reduce((sum, [value]) => sum + value, 0);
  if (!weight) return { nqs: null, verification: 'unavailable' };
  const score = Math.round(scores.reduce((sum, [value, component]) => sum + value * component, 0) / weight);
  return { nqs: score, verification: score === row.nqs ? 'match' : 'mismatch' };
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
