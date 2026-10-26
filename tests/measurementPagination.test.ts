import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllMeasurementPages } from '../src/services/measurementPagination.ts';

test('timestamp plus id cursor walks equal-timestamp rows without skips or duplicates', async () => {
  const rows = [
    { id: 'id-6', timestamp: '2026-10-25T12:00:00.000Z' },
    { id: 'id-5', timestamp: '2026-10-25T12:00:00.000Z' },
    { id: 'id-4', timestamp: '2026-10-25T12:00:00.000Z' },
    { id: 'id-3', timestamp: '2026-10-24T12:00:00.000Z' },
    { id: 'id-2', timestamp: '2026-10-24T12:00:00.000Z' },
    { id: 'id-1', timestamp: '2026-10-23T12:00:00.000Z' }
  ];
  const cursors: Array<{ before?: string; beforeId?: string }> = [];
  const result = await fetchAllMeasurementPages(async ({ before, beforeId, limit }) => {
    cursors.push({ before, beforeId });
    const filtered = before
      ? rows.filter((row) => row.timestamp < before || (row.timestamp === before && row.id < beforeId!))
      : rows;
    return filtered.slice(0, limit);
  }, 2, 20);
  assert.deepEqual(result.measurements.map((row) => row.id), rows.map((row) => row.id));
  assert.equal(result.truncated, false);
  assert.ok(cursors.some((cursor) => cursor.before === rows[1].timestamp && cursor.beforeId === rows[1].id));
});

test('reports when its explicit safety cap truncates a larger result set', async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ id: `id-${index}`, timestamp: new Date(1_800_000_000_000 - index * 1000).toISOString() }));
  const result = await fetchAllMeasurementPages(async ({ before, beforeId, limit }) => {
    const filtered = before ? rows.filter((row) => row.timestamp < before || (row.timestamp === before && row.id < beforeId!)) : rows;
    return filtered.slice(0, limit);
  }, 2, 5);
  assert.equal(result.measurements.length, 5);
  assert.equal(result.truncated, true);
});
