export interface MeasurementCursor { before?: string; beforeId?: string; limit: number }
export interface CursorMeasurement { id: string; timestamp: string }
export interface PaginatedMeasurements<T> { measurements: T[]; truncated: boolean }

/** Follows the stable (timestamp DESC, id DESC) cursor, preserving equal-timestamp rows. */
export async function fetchAllMeasurementPages<T extends CursorMeasurement>(
  fetchPage: (cursor: MeasurementCursor) => Promise<T[]>,
  pageSize = 500,
  maxRecords = 20_000
): Promise<PaginatedMeasurements<T>> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500 || !Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new Error('Invalid measurement pagination limits');
  }
  const measurements: T[] = [];
  const seenIds = new Set<string>();
  let cursor: MeasurementCursor = { limit: pageSize };
  while (measurements.length < maxRecords) {
    const requestedLimit = Math.min(pageSize, maxRecords - measurements.length);
    const page = await fetchPage({ ...cursor, limit: requestedLimit });
    let added = 0;
    for (const row of page) {
      if (!row || typeof row.id !== 'string' || !row.id || !Number.isFinite(Date.parse(row.timestamp))) continue;
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id);
        measurements.push(row);
        added++;
      }
    }
    if (page.length < requestedLimit) return { measurements, truncated: false };
    const last = page.at(-1);
    if (!last) return { measurements, truncated: false };
    if (last.timestamp === cursor.before && last.id === cursor.beforeId) throw new Error('Measurement pagination cursor did not advance');
    cursor = { limit: pageSize, before: last.timestamp, beforeId: last.id };
    if (measurements.length >= maxRecords) {
      const probe = await fetchPage({ ...cursor, limit: 1 });
      return { measurements, truncated: probe.some((row) => typeof row.id === 'string' && !seenIds.has(row.id)) };
    }
    if (added === 0) throw new Error('Measurement pagination returned no new records');
  }
  return { measurements, truncated: false };
}
