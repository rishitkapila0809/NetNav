import type { LiveMeasurement } from '../types.ts';

/** Keep the old packetLossPercent wire name as an alias for HTTP probe failures. */
export function buildMeasurementRequestPayload(measurement: LiveMeasurement): Record<string, unknown> {
  const available = measurement.metricAvailability?.probeFailure === true;
  const raw = measurement.probeFailurePercent as unknown;
  let probeFailurePercent: number | null = null;
  if (available) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 100) {
      throw new Error('Invalid probeFailurePercent: expected a finite percentage from 0 to 100');
    }
    probeFailurePercent = raw;
  }
  return {
    ...measurement,
    probeFailurePercent,
    packetLossPercent: probeFailurePercent,
    metricAvailability: { ...(measurement.metricAvailability ?? {}), packetLoss: available }
  };
}
