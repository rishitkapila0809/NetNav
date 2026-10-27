import type { LiveMeasurement } from '../types.ts';
import { calculateMeasurementNqs } from './measurementTelemetry.ts';
import { shouldPersistMeasurement } from './measurementValidation.ts';

export type MeasurementStorageStatus = 'score-ineligible' | 'persistence-ineligible' | 'pending' | 'saved' | 'failed';

/** Separates NQS eligibility from the stricter conditions required for a persisted sample. */
export function getMeasurementStorageEligibility(sample: LiveMeasurement): Exclude<MeasurementStorageStatus, 'saved' | 'failed'> {
  const evaluation = calculateMeasurementNqs(sample);
  if (evaluation.nqs === null || evaluation.verification !== 'match') return 'score-ineligible';
  return shouldPersistMeasurement(sample) ? 'pending' : 'persistence-ineligible';
}

/** A resolved request is the only path to `saved`; a failed request retains its error. */
export async function confirmMeasurementSave(save: () => Promise<unknown>): Promise<
  { status: 'saved' } | { status: 'failed'; error: string }
> {
  try {
    await save();
    return { status: 'saved' };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : 'Measurement API request failed' };
  }
}
