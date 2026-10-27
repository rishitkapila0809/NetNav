import { MAX_VALID_GPS_ACCURACY_METERS, PREFERRED_GPS_ACCURACY_METERS } from './measurementValidation.ts';

export type LocationTrackerStatus = 'idle' | 'requesting' | 'locating' | 'ready' | 'low-confidence' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'error';

export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export interface GeolocationPositionLike {
  coords: { latitude: number; longitude: number; accuracy: number; heading: number | null; speed: number | null };
  timestamp: number;
}

export interface GeolocationErrorLike { code: number; message?: string }
export interface GeolocationPort {
  getCurrentPosition(success: (position: GeolocationPositionLike) => void, error: (error: GeolocationErrorLike) => void, options: PositionOptions): void;
  watchPosition(success: (position: GeolocationPositionLike) => void, error: (error: GeolocationErrorLike) => void, options: PositionOptions): number;
  clearWatch(id: number): void;
}

export const REQUIRED_LOCATION_ACCURACY_METERS = PREFERRED_GPS_ACCURACY_METERS;
const LOCATION_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 };
const GPS_FRESHNESS_LIMIT_MS = 10_000;
const STALE_REFRESH_INTERVAL_MS = 5_000;
const STALE_REFRESH_THROTTLE_MS = 15_000;
type InitialResult = { position: GeolocationPositionLike } | { error: GeolocationErrorLike };
const pendingInitialRequests = new WeakMap<GeolocationPort, Promise<InitialResult>>();

function requestInitialPosition(geolocation: GeolocationPort): Promise<InitialResult> {
  const existing = pendingInitialRequests.get(geolocation);
  if (existing) return existing;
  const request = new Promise<InitialResult>((resolve) => {
    try {
      geolocation.getCurrentPosition((position) => resolve({ position }), (error) => resolve({ error }), LOCATION_OPTIONS);
    } catch (error) {
      resolve({ error: { code: 2, message: error instanceof Error ? error.message : 'The browser rejected the location request.' } });
    }
  });
  pendingInitialRequests.set(geolocation, request);
  void request.then(() => { if (pendingInitialRequests.get(geolocation) === request) pendingInitialRequests.delete(geolocation); });
  return request;
}

export class BrowserLocationTracker {
  private watchId: number | null = null;
  private requestInFlight = false;
  private started = false;
  private disposed = false;
  private permissionDenied = false;
  private latestFixTimestamp: number | null = null;
  private lastStaleRefreshAt = 0;
  private staleRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly geolocation: GeolocationPort;
  private readonly onStatus: (status: LocationTrackerStatus, message: string | null) => void;
  private readonly onPosition: (fix: LocationFix) => void;

  constructor(
    geolocation: GeolocationPort,
    onStatus: (status: LocationTrackerStatus, message: string | null) => void,
    onPosition: (fix: LocationFix) => void
  ) {
    this.geolocation = geolocation;
    this.onStatus = onStatus;
    this.onPosition = onPosition;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.requestInitialFix();
  }

  retry(): void {
    if (this.disposed || this.requestInFlight) return;
    this.permissionDenied = false;
    this.requestInitialFix();
  }

  /** Refresh a stale/missing fix without creating another watch or prompting on every render. */
  refreshIfStale(now = Date.now()): void {
    if (this.disposed || this.permissionDenied || this.requestInFlight) return;
    const stale = this.latestFixTimestamp === null || now - this.latestFixTimestamp > GPS_FRESHNESS_LIMIT_MS;
    if (!stale || now - this.lastStaleRefreshAt < STALE_REFRESH_THROTTLE_MS) return;
    this.lastStaleRefreshAt = now;
    this.requestInFlight = true;
    try {
      this.geolocation.getCurrentPosition((position) => {
        this.requestInFlight = false;
        if (!this.disposed) this.accept(position);
      }, (error) => {
        this.requestInFlight = false;
        if (!this.disposed) this.handleError(error, false);
      }, LOCATION_OPTIONS);
    } catch (error) {
      this.requestInFlight = false;
      if (!this.disposed) this.handleError({ code: 2, message: error instanceof Error ? error.message : 'The browser rejected the location request.' }, false);
    }
  }

  stop(): void {
    this.disposed = true;
    if (this.watchId !== null) this.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    if (this.staleRefreshTimer !== null) clearInterval(this.staleRefreshTimer);
    this.staleRefreshTimer = null;
  }

  private requestInitialFix(): void {
    if (this.requestInFlight || this.disposed) return;
    this.requestInFlight = true;
    this.onStatus('requesting', 'Requesting browser location permission and an initial GPS fix…');
    void requestInitialPosition(this.geolocation).then((result) => {
        this.requestInFlight = false;
        if (this.disposed) return;
        if ('position' in result) {
          this.accept(result.position);
          this.startWatcher();
        } else this.handleError(result.error, true);
      });
  }

  private startWatcher(): void {
    if (this.watchId !== null || this.disposed) return;
    try {
      this.watchId = this.geolocation.watchPosition(
        (position) => { if (!this.disposed) this.accept(position); },
        (error) => { if (!this.disposed) this.handleError(error, false); },
        LOCATION_OPTIONS
      );
      this.staleRefreshTimer = setInterval(() => this.refreshIfStale(), STALE_REFRESH_INTERVAL_MS);
      if (this.staleRefreshTimer && typeof (this.staleRefreshTimer as unknown as { unref?: () => void }).unref === 'function') {
        (this.staleRefreshTimer as unknown as { unref: () => void }).unref();
      }
    } catch (error) {
      this.onStatus('error', error instanceof Error ? error.message : 'The browser could not start location updates.');
    }
  }

  private accept(position: GeolocationPositionLike): void {
    const { latitude, longitude, accuracy, heading, speed } = position.coords;
    const timestamp = Number.isFinite(position.timestamp) && position.timestamp > 0 ? position.timestamp : Date.now();
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_VALID_GPS_ACCURACY_METERS || timestamp > Date.now()) {
      this.onStatus('error', 'The browser returned invalid location coordinates or accuracy. Retry location access.');
      return;
    }
    this.onPosition({ latitude, longitude, accuracy, heading, speed, timestamp });
    this.latestFixTimestamp = timestamp;
    if (accuracy > REQUIRED_LOCATION_ACCURACY_METERS) {
      this.onStatus('low-confidence', `GPS accuracy is approximately ±${Math.round(accuracy)} m. Results may be less precise. We’re still trying to improve your location.`);
    } else {
      this.onStatus('ready', `Location ready · browser-reported accuracy ±${Math.round(accuracy)} m.`);
    }
  }

  private handleError(error: GeolocationErrorLike, initial: boolean): void {
    if (error.code === 1) {
      this.permissionDenied = true;
      if (this.watchId !== null) this.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      if (this.staleRefreshTimer !== null) clearInterval(this.staleRefreshTimer);
      this.staleRefreshTimer = null;
      this.onStatus('denied', 'Location permission is denied. Enable location for this site in browser settings and make sure device location services are on. The browser controls whether it shows another prompt.');
      return;
    }
    if (error.code === 2) {
      this.onStatus('unavailable', 'The device/browser cannot determine your location. Check device location services and try again.');
    } else if (error.code === 3) {
      this.onStatus('timeout', 'The location request timed out. Keep location services on and retry in a clearer-signal area.');
    } else {
      this.onStatus('error', error.message || 'The browser could not retrieve your location.');
    }
    // A watcher can recover from a temporary timeout or unavailable provider. A permission denial never starts one.
    if (initial) this.startWatcher();
  }
}
