// Simulation of NetworkMeasurerService in Node environment
global.performance = { now: () => Date.now() };
Object.defineProperty(global, 'navigator', {
  value: { onLine: true, connection: { downlink: 10, effectiveType: '4g' } },
  writable: true
});
global.window = { location: { origin: 'http://localhost:5173' } };
global.fetch = async () => ({ ok: true, status: 200 });

class NetworkMeasurerService {
  constructor() {
    this.lastLatencyMs = null;
    this.pingHistory = [];
    this.maxHistorySize = 10;
    this.consecutiveFailures = 0;
  }

  async measureSample(latitude, longitude, accuracy, operator, heading, speed) {
    const startTime = performance.now();
    let isSuccess = false;
    let latencyMs = 35;

    const isBrowserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (!isBrowserOnline) {
      return this.createOfflineMeasurement(latitude, longitude, accuracy, operator, heading, speed);
    }

    try {
      // simulate realistic small local latency variations (12ms - 18ms)
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 6) + 12));
      const response = await fetch(`${window.location.origin}/favicon.svg?t=${Date.now()}`);
      const endTime = performance.now();

      if (response.ok) {
        latencyMs = Math.round(endTime - startTime);
        isSuccess = true;
        this.consecutiveFailures = 0;
      }
    } catch {
      isSuccess = false;
    }

    this.pingHistory.push(isSuccess);
    if (this.pingHistory.length > this.maxHistorySize) {
      this.pingHistory.shift();
    }

    const failedPings = this.pingHistory.filter((s) => !s).length;
    const packetLossPercent = Math.round((failedPings / this.pingHistory.length) * 100);

    let jitterMs = 4;
    if (this.lastLatencyMs !== null) {
      jitterMs = Math.abs(latencyMs - this.lastLatencyMs);
    }
    this.lastLatencyMs = latencyMs;

    const navConn = navigator.connection;
    let downloadMbps = navConn?.downlink || 45;

    if (latencyMs < 30) {
      downloadMbps = Math.min(120, Math.round(downloadMbps * 1.1 * 10) / 10);
    } else if (latencyMs > 100) {
      downloadMbps = Math.max(5, Math.round(downloadMbps * 0.7 * 10) / 10);
    }

    const uploadMbps = Math.round((downloadMbps * 0.4) * 10) / 10;
    const signalDbm = undefined;

    const latencyScore = this.calcLatencyScore(latencyMs);
    const throughputScore = this.calcThroughputScore(downloadMbps);
    const packetLossScore = this.calcPacketLossScore(packetLossPercent);
    const jitterScore = this.calcJitterScore(jitterMs);

    const rawNqs = (0.25 * latencyScore + 0.30 * throughputScore + 0.20 * packetLossScore + 0.10 * jitterScore) / 0.85;
    const nqs = Math.min(100, Math.max(0, Math.round(rawNqs)));
    const status = this.getNqsStatus(nqs);

    const navConnObj = navigator.connection;
    const networkType = navConnObj?.effectiveType ? navConnObj.effectiveType.toUpperCase() : 'WIFI / NET';

    console.log(`[NETNAV MEASUREMENT AUDIT]
RAW METRICS:
  - Latency: ${latencyMs} ms
  - Packet Loss: ${packetLossPercent} %
  - Download Throughput: ${downloadMbps} Mbps
  - Upload Throughput: ${uploadMbps} Mbps
  - Jitter: ${jitterMs} ms
  - Signal Strength (RSRP): ${signalDbm !== undefined ? `${signalDbm} dBm` : 'UNAVAILABLE'}
  - Network Type: ${networkType}

NORMALIZED SCORES (0-100):
  - L (Latency Score): ${latencyScore}
  - T (Throughput Score): ${throughputScore}
  - P (Packet Loss Score): ${packetLossScore}
  - J (Jitter Score): ${jitterScore}
  - S (Signal Score): UNAVAILABLE (Renormalized / 0.85)

FINAL CALCULATED NQS:
  - NQS: ${nqs} (${status})
--------------------------------------------------`);

    return { latencyMs, jitterMs, packetLossPercent, downloadMbps, uploadMbps, nqs, status };
  }

  calcLatencyScore(latencyMs) {
    if (latencyMs <= 15) return 100;
    if (latencyMs >= 300) return 0;
    return Math.round(100 - ((latencyMs - 15) / (300 - 15)) * 100);
  }

  calcThroughputScore(mbps) {
    if (mbps >= 100) return 100;
    if (mbps <= 0) return 0;
    return Math.round((mbps / 100) * 100);
  }

  calcPacketLossScore(lossPercent) {
    if (lossPercent <= 0) return 100;
    if (lossPercent >= 20) return 0;
    return Math.round(100 - (lossPercent / 20) * 100);
  }

  calcJitterScore(jitterMs) {
    if (jitterMs <= 2) return 100;
    if (jitterMs >= 50) return 0;
    return Math.round(100 - ((jitterMs - 2) / (50 - 2)) * 100);
  }

  getNqsStatus(nqs) {
    if (nqs >= 80) return 'EXCELLENT';
    if (nqs >= 60) return 'GOOD';
    if (nqs >= 40) return 'MODERATE';
    return 'POOR';
  }
}

async function runAudit() {
  const measurer = new NetworkMeasurerService();
  console.log("=== RUNNING 5 CONSECUTIVE MEASUREMENTS ===\n");
  for (let i = 1; i <= 5; i++) {
    console.log(`>>> SAMPLE #${i}`);
    await measurer.measureSample(12.9692, 79.1559, 10, 'Jio', null, null);
  }
}

runAudit();
