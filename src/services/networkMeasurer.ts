import type { LiveMeasurement, NetworkStatus, TelecomOperator } from '../types';

export interface MeasurementConfig {
  /** Base URL of the measurement server (e.g. 'http://localhost:3001') */
  serverUrl: string;
  /** Probe timeout in ms (default: 2000) */
  probeTimeoutMs: number;
  /** Download throughput test timeout in ms (default: 8000) */
  downloadTimeoutMs: number;
  /** Upload throughput test timeout in ms (default: 8000) */
  uploadTimeoutMs: number;
  /** Throughput measurement interval in ms (default: 25000 = every 25s) */
  throughputIntervalMs: number;
  /** Byte size for regular download speed test (default: 768 KB) */
  downloadBytes: number;
  /** Byte size for regular upload speed test (default: 256 KB) */
  uploadBytes: number;
  /** Byte size for initial quick download speed test at session start (default: 384 KB) */
  initialDownloadBytes: number;
  /** Byte size for initial quick upload speed test at session start (default: 128 KB) */
  initialUploadBytes: number;
  /** Number of probes in sliding window for probe failure rate calculation (default: 10) */
  maxProbeHistory: number;
}

/**
 * Determine default measurement server URL
 * Priority:
 * 1. Vite environment variable: import.meta.env.VITE_MEASUREMENT_SERVER_URL
 * 2. Hostname-relative URL (allows mobile devices on Wi-Fi/hotspot to connect to laptop IP)
 * 3. Fallback: 'http://localhost:3001'
 */
function getDefaultServerUrl(): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_MEASUREMENT_SERVER_URL) {
      return import.meta.env.VITE_MEASUREMENT_SERVER_URL;
    }
  } catch {
    // Environment lookup fallback
  }

  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:3001`;
    }
  }

  return 'http://localhost:3001';
}

export const DEFAULT_CONFIG: MeasurementConfig = {
  serverUrl: getDefaultServerUrl(),
  probeTimeoutMs: 2000,
  downloadTimeoutMs: 8000,
  uploadTimeoutMs: 8000,
  throughputIntervalMs: 25000,
  downloadBytes: 768 * 1024, // 768 KB
  uploadBytes: 256 * 1024, // 256 KB
  initialDownloadBytes: 384 * 1024, // 384 KB
  initialUploadBytes: 128 * 1024, // 128 KB
  maxProbeHistory: 10
};

export class NetworkMeasurerService {
  private config: MeasurementConfig;
  private lastLatencyMs: number | null = null;
  private pingHistory: boolean[] = []; // true = success, false = timeout/loss
  private consecutiveFailures = 0;
  private lastThroughputTime = 0;
  private lastDownloadMbps = 0;
  private lastUploadMbps = 0;
  private isFirstSampleInSession = true;
  private isThroughputTestRunning = false;
  private hasDownloadMeasurement = false;
  private hasUploadMeasurement = false;

  constructor(config: Partial<MeasurementConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public getConfig(): MeasurementConfig {
    return { ...this.config };
  }

  public setConfig(newConfig: Partial<MeasurementConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Reset session state when starting a new measurement session
   */
  public resetSession(): void {
    this.lastLatencyMs = null;
    this.pingHistory = [];
    this.consecutiveFailures = 0;
    this.lastThroughputTime = 0;
    this.lastDownloadMbps = 0;
    this.lastUploadMbps = 0;
    this.isFirstSampleInSession = true;
    this.isThroughputTestRunning = false;
    this.hasDownloadMeasurement = false;
    this.hasUploadMeasurement = false;
  }

  /**
   * Measure single HTTP RTT probe to the measurement server /probe endpoint
   */
  public async measureProbe(signal?: AbortSignal): Promise<{ latencyMs: number; isSuccess: boolean }> {
    if (signal?.aborted) {
      throw new DOMException('Measurement aborted', 'AbortError');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.probeTimeoutMs);
    const onAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener('abort', onAbort);
    }

    const probeUrl = `${this.config.serverUrl}/probe?t=${Date.now()}`;
    const startTime = performance.now();

    try {
      const response = await fetch(probeUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });

      if (!response.ok) {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onAbort);
        console.warn(`[NETNAV] GET /probe returned HTTP ${response.status}`);
        return { latencyMs: 0, isSuccess: false };
      }
      const body = await response.json() as { ok?: unknown };
      if (body?.ok !== true) {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onAbort);
        console.warn('[NETNAV] GET /probe returned an invalid response body');
        return { latencyMs: 0, isSuccess: false };
      }
      const endTime = performance.now();
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      const latencyMs = Math.max(1, Math.round(endTime - startTime));
      return { latencyMs, isSuccess: true };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      // If user aborted session, propagate error
      if (signal?.aborted) {
        throw new DOMException('Measurement aborted', 'AbortError');
      }

      console.warn(`[NETNAV] GET /probe failed at ${new URL(probeUrl).origin}: ${err instanceof Error ? err.message : String(err)}`);
      return { latencyMs: 0, isSuccess: false };
    }
  }

  /**
   * Download a controlled binary payload and calculate genuine throughput in Mbps
   */
  public async measureDownloadThroughput(bytes: number, signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) {
      throw new DOMException('Measurement aborted', 'AbortError');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.downloadTimeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort);

    const downloadUrl = `${this.config.serverUrl}/download?bytes=${bytes}&t=${Date.now()}`;
    const startTime = performance.now();

    try {
      const response = await fetch(downloadUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Download test HTTP ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const expectedBytes = Number(response.headers.get('content-length'));
      if (buffer.byteLength === 0 || (Number.isFinite(expectedBytes) && expectedBytes > 0 && expectedBytes !== buffer.byteLength)) {
        throw new Error(`Download response size mismatch (${buffer.byteLength}/${expectedBytes || 'unknown'} bytes)`);
      }
      const endTime = performance.now();
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      const durationSec = (endTime - startTime) / 1000;
      if (durationSec > 0 && buffer.byteLength > 0) {
        this.hasDownloadMeasurement = true;
        // (bytes * 8 bits) / (seconds * 1,000,000) = Mbps
        const mbps = (buffer.byteLength * 8) / (durationSec * 1_000_000);
        return Math.round(mbps * 10) / 10;
      }
      return 0;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (signal?.aborted) {
        throw new DOMException('Measurement aborted', 'AbortError');
      }
      console.warn('[NETNAV] Download throughput test failed:', err);
      return 0;
    }
  }

  /**
   * Upload a bounded binary payload and calculate genuine uplink throughput in Mbps
   */
  public async measureUploadThroughput(bytes: number, signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) {
      throw new DOMException('Measurement aborted', 'AbortError');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.uploadTimeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onAbort);

    // Create bounded test payload (0xAA pattern)
    const payload = new Uint8Array(bytes);
    payload.fill(0xaa);

    const uploadUrl = `${this.config.serverUrl}/upload?t=${Date.now()}`;
    const startTime = performance.now();

    try {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: payload,
        cache: 'no-store',
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Upload test HTTP ${response.status}`);
      }

      const result = await response.json() as { ok?: unknown; bytesReceived?: unknown };
      if (result.ok !== true || result.bytesReceived !== bytes) {
        throw new Error(`Upload response validation failed (received ${String(result.bytesReceived)} of ${bytes} bytes)`);
      }

      const endTime = performance.now();
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      const durationSec = (endTime - startTime) / 1000;
      if (durationSec > 0) {
        this.hasUploadMeasurement = true;
        // (bytes * 8 bits) / (seconds * 1,000,000) = Mbps
        const mbps = (bytes * 8) / (durationSec * 1_000_000);
        return Math.round(mbps * 10) / 10;
      }
      return 0;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (signal?.aborted) {
        throw new DOMException('Measurement aborted', 'AbortError');
      }
      console.warn('[NETNAV] Upload throughput test failed:', err);
      return 0;
    }
  }

  /**
   * Main sequential measurement cycle.
   * - Probes external RTT latency every call (~1s).
   * - Derives jitter from consecutive successful RTT measurements.
   * - Derives probe failure rate from sliding window of probes.
   * - Triggers genuine throughput download & upload tests initially and every ~25s.
   * - Normalizes metrics into locked NQS formula (renormalizing across available L, T, P, J).
   */
  public async measureSample(
    latitude: number,
    longitude: number,
    accuracy: number,
    operator: TelecomOperator,
    heading?: number | null,
    speed?: number | null,
    signal?: AbortSignal
  ): Promise<LiveMeasurement> {
    if (signal?.aborted) {
      throw new DOMException('Measurement aborted', 'AbortError');
    }

    // navigator.onLine is only a browser hint and can be false while localhost is reachable.
    // The measurement-server probe is the authority for this measurement pipeline.
    const { latencyMs, isSuccess } = await this.measureProbe(signal);

    if (signal?.aborted) {
      throw new DOMException('Measurement aborted', 'AbortError');
    }

    if (isSuccess) {
      if (this.consecutiveFailures > 0) console.info(`[NETNAV] Measurement server recovered after ${this.consecutiveFailures} failed probe(s)`);
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
      if (this.consecutiveFailures === 1 || this.consecutiveFailures === 3) {
        console.warn(`[NETNAV] Measurement server probe failure ${this.consecutiveFailures}/3; retrying`);
      }
    }

    this.pingHistory.push(isSuccess);
    if (this.pingHistory.length > this.config.maxProbeHistory) this.pingHistory.shift();
    const failedPings = this.pingHistory.filter((ok) => !ok).length;
    const packetLossPercent = Math.round((failedPings / this.pingHistory.length) * 100);

    // If 3 consecutive probe failures occur, classify as NO_CONNECTIVITY
    if (this.consecutiveFailures >= 3) {
      return this.createOfflineMeasurement(latitude, longitude, accuracy, operator, heading, speed, packetLossPercent);
    }

    // Jitter needs two successful probes. The first successful probe has no jitter observation.
    const previousLatencyMs = this.lastLatencyMs;
    const hasPreviousLatency = previousLatencyMs !== null;
    let jitterMs = 0;
    if (isSuccess) {
      if (hasPreviousLatency) {
        jitterMs = Math.abs(latencyMs - previousLatencyMs);
      }
      this.lastLatencyMs = latencyMs;
    }

    // 5. Active Throughput Testing Strategy
    // Run initial test at session start, or periodically when throughputIntervalMs elapsed
    const now = Date.now();
    const shouldRunThroughput =
      !this.isThroughputTestRunning &&
      (this.isFirstSampleInSession || now - this.lastThroughputTime >= this.config.throughputIntervalMs);

    if (shouldRunThroughput) {
      this.isThroughputTestRunning = true;
      const downloadBytes = this.isFirstSampleInSession
        ? this.config.initialDownloadBytes
        : this.config.downloadBytes;
      const uploadBytes = this.isFirstSampleInSession
        ? this.config.initialUploadBytes
        : this.config.uploadBytes;

      try {
        const measuredDownload = await this.measureDownloadThroughput(downloadBytes, signal);
        if (measuredDownload > 0) {
          this.lastDownloadMbps = measuredDownload;
          this.hasDownloadMeasurement = true;
        }

        if (signal?.aborted) {
          throw new DOMException('Measurement aborted', 'AbortError');
        }

        const measuredUpload = await this.measureUploadThroughput(uploadBytes, signal);
        if (measuredUpload > 0) {
          this.lastUploadMbps = measuredUpload;
          this.hasUploadMeasurement = true;
        }

        this.lastThroughputTime = Date.now();
        this.isFirstSampleInSession = false;
      } finally {
        this.isThroughputTestRunning = false;
      }
    }

    const downloadMbps = this.lastDownloadMbps;
    const uploadMbps = this.lastUploadMbps;
    const signalDbm = undefined; // Cellular hardware RSRP is unavailable in standard browsers

    // 6. Calculate Normalized Component Scores (0 - 100)
    const availability = {
      latency: isSuccess,
      download: this.hasDownloadMeasurement,
      upload: this.hasUploadMeasurement,
      jitter: isSuccess && hasPreviousLatency,
      packetLoss: true,
      signal: false
    };
    const scoreResult = this.calculateNqs({
      latencyMs, downloadMbps, packetLossPercent, jitterMs, availability
    });
    const { nqs, raw: rawNqs, scores } = scoreResult;
    const status = this.getNqsStatus(nqs);

    return {
      id: `meas-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      latitude,
      longitude,
      accuracy,
      speed: speed ?? null,
      heading: heading ?? null,
      timestamp: new Date().toISOString(),
      latencyMs: isSuccess ? latencyMs : 0,
      jitterMs: isSuccess ? jitterMs : 0,
      packetLossPercent,
      downloadMbps,
      uploadMbps,
      signalDbm,
      signalStatus: 'UNAVAILABLE',
      nqs,
      status,
      operator,
      isOffline: false,
      metricAvailability: availability,
      nqsComponents: { ...scores, raw: rawNqs }
    };
  }

  public createOfflineMeasurement(
    latitude: number,
    longitude: number,
    accuracy: number,
    operator: TelecomOperator,
    heading?: number | null,
    speed?: number | null
    , packetLossPercent = 100
  ): LiveMeasurement {
    return {
      id: `offline-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      latitude,
      longitude,
      accuracy,
      speed: speed ?? null,
      heading: heading ?? null,
      timestamp: new Date().toISOString(),
      latencyMs: 0,
      jitterMs: 0,
      packetLossPercent,
      downloadMbps: 0,
      uploadMbps: 0,
      signalDbm: undefined,
      signalStatus: 'UNAVAILABLE',
      nqs: 0,
      status: 'NO_CONNECTIVITY',
      operator,
      isOffline: true,
      offlineReason: 'MEASUREMENT_SERVER_UNREACHABLE',
      metricAvailability: { latency: false, download: false, upload: false, jitter: false, packetLoss: true, signal: false }
    };
  }

  // -------------------------------------------------------------
  // NORMALIZATION FUNCTIONS (PRESERVED ACCORDING TO LOCKED NQS SPEC)
  // -------------------------------------------------------------

  public calcLatencyScore(latencyMs: number): number {
    if (latencyMs <= 15) return 100;
    if (latencyMs >= 300) return 0;
    return Math.round(100 - ((latencyMs - 15) / (300 - 15)) * 100);
  }

  public calcThroughputScore(mbps: number): number {
    if (mbps >= 100) return 100;
    if (mbps <= 0) return 0;
    return Math.round((mbps / 100) * 100);
  }

  public calcPacketLossScore(lossPercent: number): number {
    if (lossPercent <= 0) return 100;
    if (lossPercent >= 20) return 0;
    return Math.round(100 - (lossPercent / 20) * 100);
  }

  public calcJitterScore(jitterMs: number): number {
    if (jitterMs <= 2) return 100;
    if (jitterMs >= 50) return 0;
    return Math.round(100 - ((jitterMs - 2) / (50 - 2)) * 100);
  }

  public calculateNqs(input: {
    latencyMs: number;
    downloadMbps: number;
    packetLossPercent: number;
    jitterMs: number;
    availability: { latency: boolean; download: boolean; packetLoss: boolean; jitter: boolean };
  }): { nqs: number; raw: number; scores: { latency: number | null; throughput: number | null; packetLoss: number | null; jitter: number | null } } {
    const scores = {
      latency: input.availability.latency ? this.calcLatencyScore(input.latencyMs) : null,
      throughput: input.availability.download ? this.calcThroughputScore(input.downloadMbps) : null,
      packetLoss: input.availability.packetLoss ? this.calcPacketLossScore(input.packetLossPercent) : null,
      jitter: input.availability.jitter ? this.calcJitterScore(input.jitterMs) : null
    };
    const weights = { latency: 0.25, throughput: 0.30, packetLoss: 0.20, jitter: 0.10 } as const;
    let numerator = 0;
    let denominator = 0;
    for (const key of Object.keys(weights) as Array<keyof typeof weights>) {
      const score = scores[key];
      if (score !== null) { numerator += weights[key] * score; denominator += weights[key]; }
    }
    const raw = denominator > 0 ? numerator / denominator : 0;
    return { nqs: Math.min(100, Math.max(0, Math.round(raw))), raw, scores };
  }

  public getNqsStatus(nqs: number): NetworkStatus {
    if (nqs >= 80) return 'EXCELLENT';
    if (nqs >= 60) return 'GOOD';
    if (nqs >= 40) return 'MODERATE';
    return 'POOR';
  }

  public getNqsColor(nqs: number, status?: NetworkStatus): string {
    if (status === 'NO_CONNECTIVITY') return '#60788C';
    if (nqs >= 80) return '#00E676';
    if (nqs >= 60) return '#A3E635';
    if (nqs >= 40) return '#FF9100';
    return '#FF1744';
  }
}

export const networkMeasurer = new NetworkMeasurerService();
