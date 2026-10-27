import http from 'node:http';
import { URL } from 'node:url';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { getPool } from './db.js';

/**
 * NetNav Measurement Server
 *
 * Lightweight, zero-dependency HTTP measurement server for NetNav.
 * Provides endpoints for:
 *  - /health: Server availability check
 *  - /probe: Low-overhead RTT latency & jitter measurement
 *  - /download: Controlled binary payload streaming for download throughput
 *  - /upload: Bounded binary payload sink for upload throughput
 */

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

/** Parse comma-separated exact web origins; wildcards and paths are not allowed. */
export function parseAllowedOrigins(value = process.env.CORS_ORIGIN || '') {
  const origins = new Set();
  for (const entry of value.split(',')) {
    const candidate = entry.trim();
    if (!candidate) continue;
    let parsed;
    try { parsed = new URL(candidate); }
    catch { throw new Error('CORS_ORIGIN must be a comma-separated list of exact http(s) origins'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== candidate || parsed.username || parsed.password) {
      throw new Error('CORS_ORIGIN entries must be exact http(s) origins without paths, credentials, or wildcards');
    }
    origins.add(parsed.origin);
  }
  return origins;
}

// Pre-allocate a 64 KB chunk for efficient streaming download payloads
const CHUNK_SIZE = 64 * 1024;
const CHUNK_BUFFER = Buffer.alloc(CHUNK_SIZE, 0x5a); // 0x5A ('Z') pattern

// Bounds for payload sizes
const MIN_DOWNLOAD_BYTES = 1024; // 1 KB
const DEFAULT_DOWNLOAD_BYTES = 512 * 1024; // 512 KB
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB max upload limit
const MAX_JSON_BYTES = 64 * 1024;
const OPERATORS = new Set(['Jio', 'Airtel', 'Vi', 'BSNL']);

function metricScore(value, low, high) {
  if (value <= low) return 100;
  if (value >= high) return 0;
  return Math.round(100 - ((value - low) / (high - low)) * 100);
}
function throughputScore(value) { return Math.max(0, Math.min(100, Math.round(value))); }
function probeFailureScore(value) { return value <= 0 ? 100 : value >= 20 ? 0 : Math.round(100 - value * 5); }
function jitterScore(value) { return metricScore(value, 2, 50); }
export function validateMeasurement(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Measurement must be an object');
  const { id, operator, latitude, longitude, accuracy, timestamp, latencyMs, downloadMbps, uploadMbps, jitterMs, signalDbm, signalStatus, metricAvailability } = input;
  // `packetLossPercent` / availability.packetLoss are accepted only for old clients and rows.
  const probeFailurePercent = input.probeFailurePercent ?? input.packetLossPercent;
  if (!OPERATORS.has(operator)) throw new Error('Invalid operator');
  const number = (name, value, min, max) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  };
  number('latitude', latitude, -90, 90); number('longitude', longitude, -180, 180); number('accuracy', accuracy, 0, 10);
  number('latencyMs', latencyMs, 0, 600000); number('downloadMbps', downloadMbps, 0, 100000); number('uploadMbps', uploadMbps, 0, 100000);
  number('jitterMs', jitterMs, 0, 600000); number('probeFailurePercent', probeFailurePercent, 0, 100);
  if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)) || Date.parse(timestamp) > Date.now() + 300_000) throw new Error('Invalid or future timestamp');
  if (id !== undefined && (typeof id !== 'string' || id.length > 100)) throw new Error('Invalid id');
  if (signalDbm !== undefined && signalDbm !== null) number('signalDbm', signalDbm, -200, 0);
  if (!['AVAILABLE', 'UNAVAILABLE'].includes(signalStatus)) throw new Error('Invalid signalStatus');
  const rawAvailability = metricAvailability && typeof metricAvailability === 'object' && !Array.isArray(metricAvailability) ? metricAvailability : null;
  const readAvailability = (key, legacyKey, fallback) => {
    const value = rawAvailability?.[key] ?? (legacyKey ? rawAvailability?.[legacyKey] : undefined);
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new Error(`Invalid availability metadata: ${key}`);
    return value;
  };
  if (rawAvailability) {
    const validKeys = new Set(['latency', 'download', 'upload', 'jitter', 'probeFailure', 'packetLoss', 'signal']);
    for (const key of Object.keys(rawAvailability)) if (!validKeys.has(key)) throw new Error(`Invalid availability metadata: ${key}`);
  }
  const availability = {
    latency: readAvailability('latency', null, true), download: readAvailability('download', null, true),
    upload: readAvailability('upload', null, true), jitter: readAvailability('jitter', null, true),
    probeFailure: readAvailability('probeFailure', 'packetLoss', true), signal: readAvailability('signal', null, signalStatus === 'AVAILABLE')
  };
  const measurementMethodVersion = input.measurementMethodVersion === 'quality-v2' ? 'quality-v2' : 'legacy-v1';
  const scores = { latency: availability.latency === false ? null : metricScore(latencyMs, 15, 300), throughput: availability.download === false ? null : throughputScore(downloadMbps), probeFailure: availability.probeFailure === false ? null : probeFailureScore(probeFailurePercent), jitter: availability.jitter === false ? null : jitterScore(jitterMs) };
  const weights = { latency: 0.25, throughput: 0.30, probeFailure: 0.20, jitter: 0.10 };
  const included = Object.entries(scores).filter(([, score]) => score !== null);
  const weightSum = included.reduce((sum, [name]) => sum + weights[name], 0);
  if (weightSum === 0) throw new Error('Cannot save a measurement without a valid NQS component');
  const nqs = Math.max(0, Math.min(100, Math.round(included.reduce((sum, [name, score]) => sum + weights[name] * score, 0) / weightSum)));
  return { id: id || randomUUID(), operator, latitude, longitude, accuracy, timestamp: new Date(timestamp).toISOString(), latencyMs, downloadMbps, uploadMbps, jitterMs, probeFailurePercent, nqs, signalDbm: signalDbm ?? null, signalStatus, metricAvailability: availability, measurementMethodVersion };
}
function requirePool() {
  try { return getPool(); }
  catch { throw Object.assign(new Error('Database is not configured'), { statusCode: 503 }); }
}
export async function saveMeasurement(input, db = requirePool()) {
  const m = validateMeasurement(input);
  try {
    const { rows } = await db.query(`INSERT INTO network_measurements (id, operator, latitude, longitude, accuracy_m, measured_at, latency_ms, download_mbps, upload_mbps, jitter_ms, probe_failure_percent, nqs, signal_dbm, metric_availability) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [m.id,m.operator,m.latitude,m.longitude,m.accuracy,m.timestamp,m.latencyMs,m.downloadMbps,m.uploadMbps,m.jitterMs,m.probeFailurePercent,m.nqs,m.signalDbm,JSON.stringify({ ...m.metricAvailability, _methodVersion: m.measurementMethodVersion })]);
    if (!rows[0]) throw new Error('Insert returned no measurement row');
    return rows[0];
  } catch (error) {
    console.error(`[NETNAV DB] INSERT network_measurements failed${error?.code ? ` (code ${error.code})` : ''}${error?.constraint ? ` (constraint ${error.constraint})` : ''}`);
    throw error;
  }
}
export async function listMeasurements({ operator, limit = 100, before, beforeId } = {}, db = requirePool()) {
  if (operator !== undefined && !OPERATORS.has(operator)) throw new Error('Invalid operator');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid limit');
  if (before !== undefined && (typeof before !== 'string' || !Number.isFinite(Date.parse(before)))) throw new Error('Invalid before timestamp');
  if (beforeId !== undefined && (typeof beforeId !== 'string' || beforeId.length < 1 || beforeId.length > 100 || before === undefined)) throw new Error('Invalid before cursor');
  const values = []; const where = [];
  if (operator) { values.push(operator); where.push(`operator = $${values.length}`); }
  if (beforeId !== undefined) {
    values.push(new Date(before).toISOString(), beforeId);
    where.push(`(measured_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::text)`);
  } else if (before) { values.push(new Date(before).toISOString()); where.push(`measured_at < $${values.length}`); }
  values.push(limit);
  const { rows } = await db.query(`SELECT id, operator, latitude, longitude, accuracy_m AS accuracy, measured_at AS timestamp, latency_ms AS "latencyMs", download_mbps AS "downloadMbps", upload_mbps AS "uploadMbps", jitter_ms AS "jitterMs", probe_failure_percent AS "probeFailurePercent", nqs, signal_dbm AS "signalDbm", CASE WHEN signal_dbm IS NULL THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END AS "signalStatus", metric_availability AS "metricAvailability" FROM network_measurements ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY measured_at DESC, id DESC LIMIT $${values.length}`, values);
  return rows;
}

async function readJson(req) {
  const type = req.headers['content-type'] || '';
  if (!type.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('Content-Type must be application/json'), { statusCode: 415 });
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > MAX_JSON_BYTES) throw Object.assign(new Error('Payload too large'), { statusCode: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

/**
 * Set standard CORS and anti-caching headers on all responses
 */
function setStandardHeaders(res, allowedOrigin) {
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Timing-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

export function createMeasurementServer({ db, allowedOrigins = parseAllowedOrigins() } = {}) {
  const originAllowlist = allowedOrigins instanceof Set ? allowedOrigins : new Set(allowedOrigins);
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const isAllowedOrigin = Boolean(origin && originAllowlist.has(origin));
    setStandardHeaders(res, isAllowedOrigin ? origin : undefined);

    if (origin && !isAllowedOrigin) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Origin is not allowed' }));
      return;
    }

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid URL' }));
      return;
    }

    const pathname = parsedUrl.pathname;

    if (pathname === '/api/measurements' && req.method === 'POST') {
      readJson(req).then((body) => saveMeasurement(body, db ?? requirePool())).then((row) => {
        console.info(`[NETNAV API] POST /api/measurements saved id=${row.id}`);
        res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(row));
      }).catch((error) => {
        const status = error.statusCode || (error.code ? 503 : 400);
        if (status === 400 || status === 413 || status === 415) console.warn(`[NETNAV API] POST /api/measurements rejected (${status}): ${error.message}`);
        else if (!error.code) console.error(`[NETNAV API] POST /api/measurements failed (${status}): ${error.message}`);
        res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: status === 503 ? 'Measurement storage unavailable' : error.message }));
      });
      return;
    }
    if (pathname === '/api/measurements' && req.method === 'GET') {
      const limitParam = parsedUrl.searchParams.get('limit');
      const query = { operator: parsedUrl.searchParams.get('operator') || undefined, limit: limitParam === null ? 100 : Number(limitParam), before: parsedUrl.searchParams.get('before') || undefined, beforeId: parsedUrl.searchParams.get('beforeId') || undefined };
      Promise.resolve().then(() => listMeasurements(query, db ?? requirePool())).then((rows) => {
        console.info(`[NETNAV API] GET /api/measurements returned ${rows.length} row(s)`);
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ measurements: rows }));
      }).catch((error) => {
        const status = error.statusCode || (error.code ? 503 : 400);
        console.error(`[NETNAV API] GET /api/measurements failed (${status})${error.code ? `, database code ${error.code}` : `: ${error.message}`}`);
        res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: status === 503 ? 'Measurement storage unavailable' : error.message }));
      });
      return;
    }

    // 1. GET /health
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/health') {
      const data = JSON.stringify({
        status: 'ok',
        service: 'netnav-measurement-server',
        timestamp: Date.now()
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(data);
      }
      return;
    }

    // 2. GET /probe (and HEAD /probe) - lightweight latency check
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/probe') {
      const data = JSON.stringify({ ok: true, t: Date.now() });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(data);
      }
      return;
    }

    // 3. GET /download - controlled payload stream
    if (req.method === 'GET' && pathname === '/download') {
      let requestedBytes = DEFAULT_DOWNLOAD_BYTES;
      const bytesParam = parsedUrl.searchParams.get('bytes');
      if (bytesParam) {
        const parsed = parseInt(bytesParam, 10);
        if (!isNaN(parsed)) {
          requestedBytes = Math.min(MAX_DOWNLOAD_BYTES, Math.max(MIN_DOWNLOAD_BYTES, parsed));
        }
      }

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': requestedBytes.toString(),
        'Content-Disposition': 'inline'
      });

      let bytesRemaining = requestedBytes;
      function streamChunks() {
        while (bytesRemaining > 0) {
          const toSend = Math.min(bytesRemaining, CHUNK_SIZE);
          const chunk = toSend === CHUNK_SIZE ? CHUNK_BUFFER : CHUNK_BUFFER.subarray(0, toSend);
          bytesRemaining -= toSend;

          const canContinue = res.write(chunk);
          if (!canContinue && bytesRemaining > 0) {
            res.once('drain', streamChunks);
            return;
          }
        }
        res.end();
      }

      streamChunks();
      return;
    }

    // 4. POST /upload - bounded payload sink
    if (req.method === 'POST' && pathname === '/upload') {
      const contentLengthHeader = req.headers['content-length'];
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (contentLength > MAX_UPLOAD_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large. Maximum is 10 MB.' }));
          req.destroy();
          return;
        }
      }

      const startTime = Date.now();
      let bytesReceived = 0;

      req.on('data', (chunk) => {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_UPLOAD_BYTES) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload exceeded maximum allowed size of 10 MB.' }));
          req.destroy();
        }
      });

      req.on('end', () => {
        if (res.writableEnded) return;
        const durationMs = Math.max(1, Date.now() - startTime);
        const responseData = JSON.stringify({
          ok: true,
          bytesReceived,
          durationMs
        });

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(responseData)
        });
        res.end(responseData);
      });

      req.on('error', () => {
        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Upload stream error' }));
        }
      });
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });

  return server;
}

// Auto-start if run directly
const isDirectExecution = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('server/index.js');
if (isDirectExecution || process.env.NETNAV_RUN_SERVER === 'true') {
  const server = createMeasurementServer();
  server.listen(PORT, HOST, () => {
    console.log(`[NETNAV SERVER] Measurement server listening on http://${HOST}:${PORT}`);
    console.log(`[NETNAV SERVER] DATABASE_URL configured: ${Boolean(process.env.DATABASE_URL)}`);
    console.log(`[NETNAV SERVER] Endpoints available:`);
    console.log(`  - GET  /health   -> Availability check`);
    console.log(`  - GET  /probe    -> Latency RTT probe`);
    console.log(`  - GET  /download -> Download throughput (?bytes=N)`);
    console.log(`  - POST /upload   -> Upload throughput`);
  });
}
