import type { LiveMeasurement, TelecomOperator } from '../types';
import { mapHistoricalRecord, mapHistoricalRecords, summarizeHistoricalScores } from './historicalMeasurements';
import { fetchAllMeasurementPages } from './measurementPagination';
import { selectLatestPersistedMeasurement } from './measurementTelemetry';
import { resolveMeasurementServerUrl } from './networkMeasurer';
import { buildMeasurementRequestPayload } from './measurementPayload.ts';

function getApiBase(): string {
  const base = resolveMeasurementServerUrl(import.meta.env.VITE_MEASUREMENT_SERVER_URL, import.meta.env.PROD,
    typeof window !== 'undefined' ? window.location.hostname : undefined);
  if (!base) throw new Error('Measurement API URL is not configured. Set VITE_MEASUREMENT_SERVER_URL to the HTTPS Render service URL and rebuild.');
  return base;
}

function diagnosticEndpoint(path: string): string {
  try { return `${new URL(getApiBase()).origin}${path}`; }
  catch { return path; }
}

export async function saveMeasurement(measurement: LiveMeasurement, signal?: AbortSignal): Promise<void> {
  const endpoint = diagnosticEndpoint('/api/measurements');
  const requestController = new AbortController();
  const timedOutController = { value: false };
  const timeoutId = setTimeout(() => {
    timedOutController.value = true;
    requestController.abort(new DOMException('Measurement save timed out', 'TimeoutError'));
  }, 20_000);
  const abortRequest = () => requestController.abort(signal?.reason);
  if (signal?.aborted) abortRequest();
  else signal?.addEventListener('abort', abortRequest, { once: true });
  let response: Response;
  try {
    const payload = buildMeasurementRequestPayload(measurement);
    response = await fetch(`${getApiBase()}/api/measurements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: requestController.signal });
  } catch (error) {
    if (!signal?.aborted) console.error(`[NETNAV STORAGE] POST ${endpoint} failed before receiving an HTTP response:`, error instanceof Error ? error.message : String(error));
    throw new Error(signal?.aborted ? 'Measurement save was cancelled' : timedOutController.value ? 'Measurement API save timed out' : 'Measurement API could not be reached');
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortRequest);
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
  if (import.meta.env.DEV) {
    const scoreSummary = summarizeHistoricalScores(rows);
    console.info(`[NETNAV HISTORY] loaded=${scoreSummary.loaded}, valid nqs=${scoreSummary.validNqs}, trusted quality-v2 nqs=${scoreSummary.trustedNqs}, legacy/unverified=${scoreSummary.legacyOrUnverified}, ineligible=${scoreSummary.ineligible}; score field=nqs`);
  }
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
