import type { LiveMeasurement, TelecomOperator } from '../types';
import { mapHistoricalRecord, mapHistoricalRecords } from './historicalMeasurements';
import { fetchAllMeasurementPages } from './measurementPagination';
import { selectLatestPersistedMeasurement } from './measurementTelemetry';

function getApiBase(): string {
  const configured = import.meta.env.VITE_MEASUREMENT_SERVER_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') return `http://${window.location.hostname}:3001`;
  return 'http://localhost:3001';
}

function diagnosticEndpoint(path: string): string {
  try { return `${new URL(getApiBase()).origin}${path}`; }
  catch { return path; }
}

export async function saveMeasurement(measurement: LiveMeasurement): Promise<void> {
  const endpoint = diagnosticEndpoint('/api/measurements');
  let response: Response;
  try {
    response = await fetch(`${getApiBase()}/api/measurements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(measurement) });
  } catch (error) {
    console.error(`[NETNAV STORAGE] POST ${endpoint} failed before receiving an HTTP response:`, error instanceof Error ? error.message : String(error));
    throw new Error('Measurement API could not be reached');
  }
  if (import.meta.env.DEV) console.info(`[NETNAV STORAGE] POST ${endpoint} returned HTTP ${response.status}`);
  if (!response.ok) {
    let detail = '';
    try { const body = await response.json() as { error?: unknown }; detail = typeof body.error === 'string' ? body.error : ''; } catch { /* response may be non-JSON */ }
    throw new Error(`Saving measurement failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
}

export async function loadMeasurements(operator?: TelecomOperator, options: { limit?: number; before?: string; beforeId?: string } = {}): Promise<LiveMeasurement[]> {
  const rows = await fetchMeasurementRecords(operator, options);
  const measurements: LiveMeasurement[] = mapHistoricalRecords({ measurements: rows });
  if (import.meta.env.DEV) console.info(`[NETNAV STORAGE] GET ${diagnosticEndpoint('/api/measurements')} returned ${measurements.length} saved measurement(s)`);
  return measurements;
}

async function fetchMeasurementRecords(operator?: TelecomOperator, options: { limit?: number; before?: string; beforeId?: string } = {}): Promise<unknown[]> {
  const query = new URLSearchParams({ limit: String(options.limit ?? '200') });
  if (operator) query.set('operator', operator);
  if (options.before) query.set('before', options.before);
  if (options.beforeId) query.set('beforeId', options.beforeId);
  const endpoint = diagnosticEndpoint('/api/measurements');
  let response: Response;
  try { response = await fetch(`${getApiBase()}/api/measurements?${query}`); }
  catch (error) {
    console.error(`[NETNAV STORAGE] GET ${endpoint} failed before receiving an HTTP response:`, error instanceof Error ? error.message : String(error));
    throw new Error('Measurement history API could not be reached');
  }
  if (!response.ok) {
    console.error(`[NETNAV STORAGE] GET ${endpoint} returned HTTP ${response.status}`);
    throw new Error(`Loading measurements failed (${response.status})`);
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !Array.isArray((data as { measurements?: unknown }).measurements)) throw new Error('Measurement history response has an invalid format');
  return (data as { measurements: unknown[] }).measurements;
}

/** Gets the newest valid saved record for one explicitly selected operator. */
export async function loadLatestMeasurementForOperator(operator: TelecomOperator): Promise<LiveMeasurement | null> {
  const pageSize = 500;
  let before: string | undefined;
  let beforeId: string | undefined;
  let examined = 0;
  while (examined < 20_000) {
    const rows = await fetchMeasurementRecords(operator, { limit: pageSize, before, beforeId });
    const valid = rows.flatMap((row) => row && typeof row === 'object' && !Array.isArray(row) ? mapHistoricalRecord(row as Record<string, unknown>) ?? [] : []);
    const latest = selectLatestPersistedMeasurement(valid, operator);
    if (latest) return latest;
    if (rows.length < pageSize) return null;
    const last = rows.at(-1) as Record<string, unknown> | undefined;
    const timestamp = typeof last?.timestamp === 'string' ? last.timestamp : '';
    const id = typeof last?.id === 'string' ? last.id : '';
    if (!id || !Number.isFinite(Date.parse(timestamp))) return null;
    before = timestamp;
    beforeId = id;
    examined += rows.length;
  }
  console.warn(`[NETNAV STORAGE] Latest ${operator} measurement search reached its 20,000-row safety cap.`);
  return null;
}

/** Loads the selected operator's persisted history with a stable timestamp+id cursor. */
export async function loadAllMeasurementsForOperator(operator: TelecomOperator, maxRecords = 20_000): Promise<{ measurements: LiveMeasurement[]; truncated: boolean }> {
  const result = await fetchAllMeasurementPages(
    ({ limit, before, beforeId }) => loadMeasurements(operator, { limit, before, beforeId }),
    500,
    maxRecords
  );
  if (result.truncated) console.warn(`[NETNAV STORAGE] Route overlay history capped at ${result.measurements.length} records for ${operator}; coverage may be incomplete.`);
  else if (import.meta.env.DEV) console.info(`[NETNAV STORAGE] Loaded ${result.measurements.length} paginated route-overlay record(s) for ${operator}`);
  return result;
}
