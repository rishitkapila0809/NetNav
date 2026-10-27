import type { LiveMeasurement, MeasurementMethodVersion, NetworkStatus, TelecomOperator } from '../types';

export const MEASUREMENT_METHOD_VERSION: MeasurementMethodVersion = 'quality-v2';
/** Require at least 70% of the formula's original weight to be backed by valid metrics. */
export const MIN_NQS_AVAILABLE_WEIGHT = 0.70;

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
export function resolveMeasurementServerUrl(configured: string | undefined, isProduction: boolean, hostname?: string): string {
  if (configured?.trim()) {
    const base = configured.trim().replace(/\/$/, '');
    if (!isProduction) return base;
    try {
      const parsed = new URL(base);
      if (parsed.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return base;
    } catch { /* invalid production URLs fail closed */ }
    return '';
  }
  if (isProduction) return '';
  if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') return `http://${hostname}:3001`;
  return 'http://localhost:3001';
}

function getDefaultServerUrl(): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) return resolveMeasurementServerUrl(
      import.meta.env.VITE_MEASUREMENT_SERVER_URL, import.meta.env.PROD,
      typeof window !== 'undefined' ? window.location.hostname : undefined
    );
  } catch {
    // Environment lookup fallback
  }
  return resolveMeasurementServerUrl(undefined, false, typeof window !== 'undefined' ? window.location.hostname : undefined);
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
  private lastDownloadMeasuredAt: string | undefined;
  private lastUploadMeasuredAt: string | undefined;
  private isFirstSampleInSession = true;
  private isThroughputTestRunning = false;
  private hasDownloadMeasurement = false;
  private hasUploadMeasurement = false;
  private activeOperator: TelecomOperator | null = null;

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
    this.lastDownloadMeasuredAt = undefined;
    this.lastUploadMeasuredAt = undefined;
    this.isFirstSampleInSession = true;
    this.isThroughputTestRunning = false;
    this.hasDownloadMeasurement = false;
    this.hasUploadMeasurement = false;
    this.activeOperator = null;
  }

  /**
   * Measure single HTTP RTT probe to the measurement server /probe endpoint
   */
  public async measureProbe(signal?: AbortSignal): Promise<{ latencyMs: number; isSuccess: boolean }> {
    if (!this.config.serverUrl) throw new Error('Measurement server URL is not configured. Set VITE_MEASUREMENT_SERVER_URL and rebuild the frontend.');
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
      const bodyText = await response.text();
      const endTime = performance.now();
      let body: { ok?: unknown } | null = null;
      try { body = JSON.parse(bodyText) as { ok?: unknown }; } catch { /* classified as an invalid probe response */ }
      if (body?.ok !== true) {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener('abort', onAbort);
        console.warn('[NETNAV] GET /probe returned an invalid response body');
        return { latencyMs: 0, isSuccess: false };
      }
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      const latencyMs = Math.max(0.1, Math.round((endTime - startTime) * 10) / 10);
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
  public async measureDownloadThroughput(bytes: number, signal?: AbortSignal): Promise<number | null> {
    this.hasDownloadMeasurement = false;
    this.lastDownloadMeasuredAt = undefined;
    if (!this.config.serverUrl) throw new Error('Measurement server URL is not configured. Set VITE_MEASUREMENT_SERVER_URL and rebuild the frontend.');
    if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > 10 * 1024 * 1024) return null;
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
      if (buffer.byteLength !== bytes || (Number.isFinite(expectedBytes) && expectedBytes > 0 && expectedBytes !== buffer.byteLength)) {
        throw new Error(`Download response size mismatch (${buffer.byteLength}/${bytes} requested bytes)`);
      }
      const endTime = performance.now();
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      const durationSec = (endTime - startTime) / 1000;
      if (durationSec > 0) {
        this.hasDownloadMeasurement = true;
        this.lastDownloadMeasuredAt = new Date().toISOString();
        // (bytes * 8 bits) / (seconds * 1,000,000) = Mbps
        const mbps = (buffer.byteLength * 8) / (durationSec * 1_000_000);
        return Math.round(mbps * 10) / 10;
      }
      this.hasDownloadMeasurement = false;
      return null;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (signal?.aborted) {
        throw new DOMException('Measurement aborted', 'AbortError');
      }
      console.warn('[NETNAV] Download throughput test failed:', err);
      this.hasDownloadMeasurement = false;
      return null;
    }
  }

  /**
   * Upload a bounded binary payload and calculate genuine uplink throughput in Mbps
   */
  public async measureUploadThroughput(bytes: number, signal?: AbortSignal): Promise<number | null> {
    this.hasUploadMeasurement = false;
    this.lastUploadMeasuredAt = undefined;
    if (!this.config.serverUrl) throw new Error('Measurement server URL is not configured. Set VITE_MEASUREMENT_SERVER_URL and rebuild the frontend.');
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 10 * 1024 * 1024) return null;
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
        this.lastUploadMeasuredAt = new Date().toISOString();
        // (bytes * 8 bits) / (seconds * 1,000,000) = Mbps
        const mbps = (bytes * 8) / (durationSec * 1_000_000);
        return Math.round(mbps * 10) / 10;
      }
      this.hasUploadMeasurement = false;
      return null;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (signal?.aborted) {
        throw new DOMException('Measurement aborted', 'AbortError');
      }
      console.warn('[NETNAV] Upload throughput test failed:', err);
      this.hasUploadMeasurement = false;
      return null;
    }
  }

  /**
   * Main sequential measurement cycle.
   * - Probes browser HTTP response time to the configured measurement server every call (~1s).
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

    if (this.activeOperator !== null && this.activeOperator !== operator) {
      // Operator is a user-selected attribution label. Do not carry metric state from one label
      // into another when it changes during an active session.
      this.resetSession();
    }
    this.activeOperator = operator;

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
    const probeFailurePercent = Math.round((failedPings / this.pingHistory.length) * 100);

    // If 3 consecutive probe failures occur, classify as NO_CONNECTIVITY
    if (this.consecutiveFailures >= 3) {
      return this.createOfflineMeasurement(latitude, longitude, accuracy, operator, heading, speed, probeFailurePercent);
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

    let throughputTestPerformed = false;
    if (shouldRunThroughput) {
      throughputTestPerformed = true;
      this.isThroughputTestRunning = true;
      // A failed refresh must not leave a previous rate marked as current.
      this.hasDownloadMeasurement = false;
      this.hasUploadMeasurement = false;
      this.lastDownloadMbps = 0;
      this.lastUploadMbps = 0;
      const downloadBytes = this.isFirstSampleInSession
        ? this.config.initialDownloadBytes
        : this.config.downloadBytes;
      const uploadBytes = this.isFirstSampleInSession
        ? this.config.initialUploadBytes
        : this.config.uploadBytes;

      try {
        const measuredDownload = await this.measureDownloadThroughput(downloadBytes, signal);
        if (measuredDownload !== null) {
          this.lastDownloadMbps = measuredDownload;
          this.hasDownloadMeasurement = true;
        }

        if (signal?.aborted) {
          throw new DOMException('Measurement aborted', 'AbortError');
        }

        const measuredUpload = await this.measureUploadThroughput(uploadBytes, signal);
        if (measuredUpload !== null) {
          this.lastUploadMbps = measuredUpload;
          this.hasUploadMeasurement = true;
        }

        this.isFirstSampleInSession = false;
      } finally {
        this.lastThroughputTime = Date.now();
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
      // Wait for a complete rolling window so startup percentages are not based on one or two
      // probes and don't jump in misleading 50%/100% increments.
      probeFailure: this.pingHistory.length >= this.config.maxProbeHistory,
      signal: false
    };
    const scoreResult = this.calculateNqs({
      latencyMs, downloadMbps, probeFailurePercent, jitterMs, availability
    });
    const { nqs, raw: rawNqs, scores } = scoreResult;
    const status = this.getNqsStatus(scoreResult.available ? nqs : null);

    if (typeof import.meta.env !== 'undefined' && import.meta.env.DEV && (!scoreResult.available || nqs === 100)) {
      console.debug('[NETNAV NQS] current sample calculation', {
        timestamp: new Date().toISOString(), operator,
        raw: {
          latencyMs: availability.latency ? latencyMs : null,
          downloadMbps: availability.download ? downloadMbps : null,
          uploadMbps: availability.upload ? uploadMbps : null,
          httpProbeFailurePercent: availability.probeFailure ? probeFailurePercent : null,
          jitterMs: availability.jitter ? jitterMs : null,
          signalDbm: null
        },
        available: { ...availability },
        normalizedScores: scores,
        availableWeight: scoreResult.availableWeight,
        formulaValue: rawNqs,
        displayedNqs: scoreResult.available ? nqs : null
      });
    }

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
      probeFailurePercent,
      downloadMbps,
      uploadMbps,
      downloadMeasuredAt: this.lastDownloadMeasuredAt,
      uploadMeasuredAt: this.lastUploadMeasuredAt,
      signalDbm,
      signalStatus: 'UNAVAILABLE',
      nqs,
      status,
      operator,
      measurementMethodVersion: MEASUREMENT_METHOD_VERSION,
      throughputTestPerformed,
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
    , probeFailurePercent = 100
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
      probeFailurePercent,
      downloadMbps: 0,
      uploadMbps: 0,
      signalDbm: undefined,
      signalStatus: 'UNAVAILABLE',
      nqs: 0,
      status: 'NO_CONNECTIVITY',
      operator,
      isOffline: true,
      offlineReason: 'MEASUREMENT_SERVER_UNREACHABLE',
      metricAvailability: { latency: false, download: false, upload: false, jitter: false, probeFailure: this.pingHistory.length >= this.config.maxProbeHistory, signal: false },
      measurementMethodVersion: MEASUREMENT_METHOD_VERSION,
      throughputTestPerformed: false
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

  public calcProbeFailureScore(lossPercent: number): number {
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
    probeFailurePercent: number;
    jitterMs: number;
    availability: { latency: boolean; download: boolean; probeFailure: boolean; jitter: boolean };
  }): { nqs: number; raw: number | null; available: boolean; availableWeight: number; scores: { latency: number | null; throughput: number | null; probeFailure: number | null; jitter: number | null } } {
    const scores = {
      latency: input.availability.latency && Number.isFinite(input.latencyMs) && input.latencyMs >= 0 && input.latencyMs <= 600000 ? this.calcLatencyScore(input.latencyMs) : null,
      throughput: input.availability.download && Number.isFinite(input.downloadMbps) && input.downloadMbps >= 0 && input.downloadMbps <= 100000 ? this.calcThroughputScore(input.downloadMbps) : null,
      probeFailure: input.availability.probeFailure && Number.isFinite(input.probeFailurePercent) && input.probeFailurePercent >= 0 && input.probeFailurePercent <= 100 ? this.calcProbeFailureScore(input.probeFailurePercent) : null,
      jitter: input.availability.jitter && Number.isFinite(input.jitterMs) && input.jitterMs >= 0 && input.jitterMs <= 600000 ? this.calcJitterScore(input.jitterMs) : null
    };
    const weights = { latency: 0.25, throughput: 0.30, probeFailure: 0.20, jitter: 0.10 } as const;
    let numerator = 0;
    let denominator = 0;
    for (const key of Object.keys(weights) as Array<keyof typeof weights>) {
      const score = scores[key];
      if (score !== null) { numerator += weights[key] * score; denominator += weights[key]; }
    }
    const raw = denominator > 0 ? numerator / denominator : null;
    const available = raw !== null && denominator >= MIN_NQS_AVAILABLE_WEIGHT;
    return { nqs: !available ? 0 : Math.min(100, Math.max(0, Math.round(raw!))), raw: available ? raw : null, available, availableWeight: denominator, scores };
  }

  public getNqsStatus(nqs: number | null): NetworkStatus {
    if (nqs === null || !Number.isFinite(nqs)) return 'UNAVAILABLE';
    if (nqs >= 80) return 'EXCELLENT';
    if (nqs >= 60) return 'GOOD';
    if (nqs >= 40) return 'MODERATE';
    return 'POOR';
  }

  public getNqsColor(nqs: number, status?: NetworkStatus): string {
    if (status === 'NO_CONNECTIVITY' || status === 'UNAVAILABLE') return '#60788C';
    if (nqs >= 80) return '#00E676';
    if (nqs >= 60) return '#A3E635';
    if (nqs >= 40) return '#FF9100';
    return '#FF1744';
  }
}

export const networkMeasurer = new NetworkMeasurerService();
