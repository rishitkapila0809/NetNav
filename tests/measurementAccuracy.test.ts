import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { NetworkMeasurerService } from '../src/services/networkMeasurer.ts';

async function withServer(handler: http.RequestListener, run: (base: string) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

describe('measurement accuracy and failure freshness', () => {
  test('HTTP probe failure percentage stays unavailable until the full ten-probe window exists', async () => {
    let probes = 0;
    await withServer((req, res) => {
      if (req.url?.startsWith('/probe')) {
        probes++;
        if (probes === 1) { res.writeHead(503); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
      }
      if (req.url?.startsWith('/download')) {
        const size = Number(new URL(req.url, 'http://local').searchParams.get('bytes'));
        const body = Buffer.alloc(size); res.writeHead(200, { 'Content-Length': size }); res.end(body); return;
      }
      if (req.url?.startsWith('/upload')) {
        let bytesReceived = 0; req.on('data', (chunk) => bytesReceived += chunk.length);
        req.on('end', () => { const body = JSON.stringify({ ok: true, bytesReceived }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); }); return;
      }
      res.writeHead(404); res.end();
    }, async (base) => {
      const measurer = new NetworkMeasurerService({ serverUrl: base, maxProbeHistory: 10, initialDownloadBytes: 1024, initialUploadBytes: 1024 });
      let sample;
      for (let index = 0; index < 9; index++) {
        sample = await measurer.measureSample(12.9, 79.1, 5, 'Jio');
        assert.equal(sample.metricAvailability?.probeFailure, false);
      }
      sample = await measurer.measureSample(12.9, 79.1, 5, 'Jio');
      assert.equal(sample.metricAvailability?.probeFailure, true);
      assert.equal(sample.probeFailurePercent, 10);
    });
  });

  test('a failed throughput refresh makes the prior result unavailable rather than reusing stale rates', async () => {
    let speedTestsSucceed = true;
    await withServer((req, res) => {
      if (req.url?.startsWith('/probe')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
      if (req.url?.startsWith('/download')) {
        if (!speedTestsSucceed) { res.writeHead(503); res.end(); return; }
        const size = Number(new URL(req.url, 'http://local').searchParams.get('bytes'));
        const body = Buffer.alloc(size);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size }); res.end(body); return;
      }
      if (req.url?.startsWith('/upload')) {
        let bytesReceived = 0;
        req.on('data', (chunk) => { bytesReceived += chunk.length; });
        req.on('end', () => {
          const status = speedTestsSucceed ? 200 : 503;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: status === 200, bytesReceived }));
        }); return;
      }
      res.writeHead(404); res.end();
    }, async (base) => {
      const measurer = new NetworkMeasurerService({ serverUrl: base, throughputIntervalMs: 0, initialDownloadBytes: 1024, initialUploadBytes: 1024 });
      const first = await measurer.measureSample(12.9, 79.1, 5, 'Jio');
      assert.equal(first.throughputTestPerformed, true);
      assert.equal(first.metricAvailability?.download, true);
      assert.equal(first.metricAvailability?.upload, true);
      assert.ok(first.downloadMeasuredAt && first.uploadMeasuredAt);

      speedTestsSucceed = false;
      const refreshed = await measurer.measureSample(12.9, 79.1, 5, 'Jio');
      assert.equal(refreshed.throughputTestPerformed, true);
      assert.equal(refreshed.metricAvailability?.download, false);
      assert.equal(refreshed.metricAvailability?.upload, false);
      assert.equal(refreshed.nqsComponents?.throughput, null);
      assert.equal(refreshed.downloadMeasuredAt, undefined);
      assert.equal(refreshed.uploadMeasuredAt, undefined);
    });
  });

  test('download rejects fewer bytes than requested even when the response Content-Length matches the partial body', async () => {
    await withServer((_req, res) => {
      const body = Buffer.alloc(512);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length }); res.end(body);
    }, async (base) => {
      const measurer = new NetworkMeasurerService({ serverUrl: base });
      assert.equal(await measurer.measureDownloadThroughput(1024), null);
    });
  });

  test('a genuinely very low but complete download can be 0.0 Mbps without becoming unavailable', async () => {
    await withServer((req, res) => {
      const size = Number(new URL(req.url ?? '/', 'http://local').searchParams.get('bytes'));
      const body = Buffer.alloc(size);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size });
      setTimeout(() => res.end(body), 250);
    }, async (base) => {
      const measurer = new NetworkMeasurerService({ serverUrl: base });
      assert.equal(await measurer.measureDownloadThroughput(1024), 0);
    });
  });

  test('operator changes reset probe, jitter, and throughput state before attaching the new label', async () => {
    await withServer((req, res) => {
      if (req.url?.startsWith('/probe')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
      if (req.url?.startsWith('/download')) {
        const size = Number(new URL(req.url, 'http://local').searchParams.get('bytes'));
        const body = Buffer.alloc(size); res.writeHead(200, { 'Content-Length': size }); res.end(body); return;
      }
      if (req.url?.startsWith('/upload')) {
        let bytesReceived = 0; req.on('data', (chunk) => bytesReceived += chunk.length);
        req.on('end', () => { const body = JSON.stringify({ ok: true, bytesReceived }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); }); return;
      }
      res.writeHead(404); res.end();
    }, async (base) => {
      const measurer = new NetworkMeasurerService({ serverUrl: base, throughputIntervalMs: 60_000, initialDownloadBytes: 1024, initialUploadBytes: 1024 });
      const jio = await measurer.measureSample(12.9, 79.1, 5, 'Jio');
      const airtel = await measurer.measureSample(12.9, 79.1, 5, 'Airtel');
      assert.equal(jio.throughputTestPerformed, true);
      assert.equal(airtel.throughputTestPerformed, true);
      assert.equal(airtel.metricAvailability?.jitter, false);
      assert.equal(airtel.metricAvailability?.probeFailure, false);
      assert.equal(airtel.operator, 'Airtel');
    });
  });
});
