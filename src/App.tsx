import { useState, useRef, useEffect, useCallback } from 'react';
import type { TelecomOperator, LiveMeasurement, MeasurementSessionSummary } from './types';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { MapVisualization } from './components/MapVisualization';
import { BestSpotCard } from './components/BestSpotCard';
import { MetricsCard } from './components/MetricsCard';
import { LiveMeasurementCard } from './components/LiveMeasurementCard';
import { SecondaryFeatures } from './components/SecondaryFeatures';
import { Footer } from './components/Footer';
import { AccessibleDialog } from './components/AccessibleDialog';
import { OPERATORS } from './data/mockData';
import { networkMeasurer } from './services/networkMeasurer';
import { loadMeasurements, loadLatestMeasurementForOperator, saveMeasurement } from './services/measurementApi';
import { loadAllMeasurementsForOperator } from './services/measurementApi';
import { Info, X } from 'lucide-react';
import type { HistoryStatus, OperatorFilter } from './services/historicalMeasurements';
import { refreshAndSearchAfterSave, searchPersistedBestSpot, type PersistedBestSpotSearchResult } from './services/bestSpot';
import { importLibrary } from '@googlemaps/js-api-loader';
import { requestWalkingRoutesWith, type WalkingRouteOption, type RouteCoordinate, type ComputeRoutes } from './services/walkingRoutes';
import { isValidCurrentRouteOrigin } from './services/walkingRoutes';
import { buildRouteNetworkOverlay, type RouteNetworkOverlay } from './services/routeNetworkOverlay';
import { calculateRouteRankings } from './services/routeRanking';
import { advanceOffRouteFixCount, calculateRouteProgress, canRequestReroute, endNavigationSession, isGpsJump, startNavigationSession, validateNavigationFix, type NavigationGpsFix, type RouteProgress } from './services/liveNavigation';
import { findNearbyMeasurements, type MapSearchResult } from './services/mapLocationSearch';
import { selectTelemetryMeasurement } from './services/measurementTelemetry';
import { measurementGpsAccuracyWarning, measurementGpsMessage, validateMeasurementGps, validateMeasurementStart } from './services/measurementValidation';
import { confirmMeasurementSave, getMeasurementStorageEligibility } from './services/measurementPersistence';
import type { LocationTrackerStatus } from './services/locationTracker';
import { getLocationPromptForAction } from './services/locationAccess';
import { SequentialMeasurementLoop } from './services/measurementLoop';
import type { RoutePickMode } from './components/RoutePlannerPanel';

// Helper function to calculate geographic distance in meters between 2 coordinates (Haversine formula)
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function App() {
  const [selectedOperator, setSelectedOperator] = useState<TelecomOperator>('Jio');
  const [activeTab, setActiveTab] = useState<string>('find');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Live Measurement Prototype State
  const [isMeasuring, setIsMeasuring] = useState<boolean>(false);
  const [liveMeasurements, setLiveMeasurements] = useState<LiveMeasurement[]>([]);
  const [historicalMeasurements, setHistoricalMeasurements] = useState<LiveMeasurement[]>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('loading');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyOperator, setHistoryOperator] = useState<OperatorFilter>('All');
  const [findBestSpotState, setFindBestSpotState] = useState<PersistedBestSpotSearchResult | { status: 'idle' | 'history-loading' }>({ status: 'idle' });
  const [measurementDialogOpen, setMeasurementDialogOpen] = useState(false);
  const [findOperatorDialogOpen, setFindOperatorDialogOpen] = useState(false);
  const [activeLocationPrompt, setActiveLocationPrompt] = useState<'measure' | 'best-spot' | null>(null);
  const [locationPromptError, setLocationPromptError] = useState<string | null>(null);
  const [hasExplicitOperatorSelection, setHasExplicitOperatorSelection] = useState(false);
  const [measurementOperatorChoice, setMeasurementOperatorChoice] = useState<TelecomOperator>('Jio');
  const [measurementStartError, setMeasurementStartError] = useState<string | null>(null);
  const [firstMeasurePromptOpen, setFirstMeasurePromptOpen] = useState(false);
  const [navigationActive, setNavigationActive] = useState(false);
  const [liveNavigationActive, setLiveNavigationActive] = useState(false);
  const [navigationProgress, setNavigationProgress] = useState<RouteProgress | null>(null);
  const [navigationGpsMessage, setNavigationGpsMessage] = useState('');
  const [navigationOffRoute, setNavigationOffRoute] = useState(false);
  const [locationStatus, setLocationStatus] = useState<{ status: LocationTrackerStatus; message: string | null }>({ status: 'idle', message: null });
  const [rerouteState, setRerouteState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [rerouteError, setRerouteError] = useState<string | null>(null);
  const [rerouteRoutes, setRerouteRoutes] = useState<WalkingRouteOption[]>([]);
  const [mapsReady, setMapsReady] = useState<boolean | null>(null);
  const [mapsLoadError, setMapsLoadError] = useState<string | null>(null);
  const [routeOrigin, setRouteOrigin] = useState<RouteCoordinate | null>(null);
  const [routeDestination, setRouteDestination] = useState<RouteCoordinate | null>(null);
  const [routePickMode, setRoutePickMode] = useState<RoutePickMode>(null);
  const [walkingRoutes, setWalkingRoutes] = useState<WalkingRouteOption[]>([]);
  const [selectedWalkingRouteIndex, setSelectedWalkingRouteIndex] = useState(0);
  const [routeState, setRouteState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeOverlay, setRouteOverlay] = useState<RouteNetworkOverlay | null>(null);
  const [routeOverlays, setRouteOverlays] = useState<Map<string, RouteNetworkOverlay>>(new Map());
  const [overlayState, setOverlayState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [overlayTruncated, setOverlayTruncated] = useState(false);
  const [gpsFix, setGpsFix] = useState<{ lat: number; lng: number; accuracy: number; timestamp: number } | null>(null);
  const [gpsFreshnessClock, setGpsFreshnessClock] = useState(Date.now());
  const [currentMeasurement, setCurrentMeasurement] = useState<LiveMeasurement | null>(null);
  const [currentMeasurementStorage, setCurrentMeasurementStorage] = useState<{ measurementId: string; status: 'score-ineligible' | 'persistence-ineligible' | 'pending' | 'saved' | 'failed' | 'unknown'; error?: string } | null>(null);
  const [persistedTelemetry, setPersistedTelemetry] = useState<{ status: HistoryStatus; error: string | null; measurement: LiveMeasurement | null }>({ status: 'loading', error: null, measurement: null });
  const [mapSearchSelection, setMapSearchSelection] = useState<MapSearchResult | null>(null);
  const [nearbySearchMeasurements, setNearbySearchMeasurements] = useState<Array<{ measurement: LiveMeasurement; distanceMeters: number }>>([]);
  const [nearbySearchStatus, setNearbySearchStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [nearbySearchError, setNearbySearchError] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<MeasurementSessionSummary | null>(null);

  // Refs for persistent GPS tracking & measurement calculations
  const isMeasuringRef = useRef<boolean>(false);
  const selectedOperatorRef = useRef<TelecomOperator>('Jio');
  const userGpsRef = useRef<{
    lat: number;
    lng: number;
    accuracy: number;
    speed: number | null;
    heading: number | null;
    timestamp: number;
  } | null>(null);

  const sessionDistanceRef = useRef<number>(0);
  const lastAcceptedGpsRef = useRef<{ lat: number; lng: number } | null>(null);
  const sessionStartTimeRef = useRef<number>(0);
  const measurementLoopRef = useRef<SequentialMeasurementLoop | null>(null);
  const gpsPauseReasonRef = useRef<string | null>(null);
  const measurementCycleFailureCountRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const storageIssueShownRef = useRef(false);
  const locationRetryRef = useRef<() => void>(() => undefined);
  const routeHistoryCacheRef = useRef(new Map<TelecomOperator, { measurements: LiveMeasurement[]; truncated: boolean }>());
  const routeOverlayRequestRef = useRef(0);
  const walkingRouteRequestRef = useRef(0);
  const navigationRouteRef = useRef<WalkingRouteOption | null>(null);
  const liveNavigationActiveRef = useRef(false);
  const navigationProgressRef = useRef<RouteProgress | null>(null);
  const navigationFixRef = useRef<NavigationGpsFix | null>(null);
  const offRouteCountRef = useRef(0);
  const rerouteInFlightRef = useRef(false);
  const lastRerouteAtRef = useRef(0);
  const telemetryRequestRef = useRef(0);
  const nearbySearchRequestRef = useRef(0);
  const bestSpotRequestRef = useRef(0);
  const bestSpotRequestedOperatorRef = useRef<TelecomOperator | null>(null);
  const rerunBestSpotRef = useRef<((showFirstMeasurePrompt?: boolean) => Promise<PersistedBestSpotSearchResult | null>) | null>(null);
  const searchAfterSaveRef = useRef(false);

  useEffect(() => {
    selectedOperatorRef.current = selectedOperator;
  }, [selectedOperator]);

  useEffect(() => {
    if (findBestSpotState.status === 'success' && findBestSpotState.candidate.operator !== selectedOperator) {
      setFindBestSpotState({ status: 'idle' });
    }
  }, [findBestSpotState, selectedOperator]);

  const previousOperatorRef = useRef(selectedOperator);
  useEffect(() => {
    if (previousOperatorRef.current === selectedOperator) return;
    previousOperatorRef.current = selectedOperator;
    if (bestSpotRequestedOperatorRef.current !== selectedOperator) {
      bestSpotRequestRef.current++;
      setFirstMeasurePromptOpen(false);
      setFindBestSpotState({ status: 'idle' });
    }
  }, [selectedOperator]);

  const refreshHistoricalMeasurements = useCallback(async (): Promise<LiveMeasurement[] | null> => {
    setHistoryStatus('loading');
    setHistoryError(null);
    try {
      const rows = await loadMeasurements();
      setHistoricalMeasurements(rows);
      setHistoryStatus('loaded');
      return rows;
    } catch (error) {
      console.warn('[NETNAV] Historical measurements unavailable:', error);
      setHistoryError(error instanceof Error ? error.message : 'History request failed');
      setHistoryStatus('error');
      return null;
    }
  }, []);

  useEffect(() => { void refreshHistoricalMeasurements(); }, [refreshHistoricalMeasurements]);

  useEffect(() => {
    const requestId = ++telemetryRequestRef.current;
    setPersistedTelemetry({ status: 'loading', error: null, measurement: null });
    void loadLatestMeasurementForOperator(selectedOperator).then((measurement) => {
      if (requestId === telemetryRequestRef.current) setPersistedTelemetry({ status: 'loaded', error: null, measurement });
    }).catch((error: unknown) => {
      if (requestId === telemetryRequestRef.current) setPersistedTelemetry({ status: 'error', error: error instanceof Error ? error.message : 'Saved measurement request failed.', measurement: null });
    });
    return () => { telemetryRequestRef.current++; };
  }, [selectedOperator]);

  useEffect(() => {
    if (!mapSearchSelection) return;
    const requestId = ++nearbySearchRequestRef.current;
    const operator = selectedOperator;
    setNearbySearchStatus('loading'); setNearbySearchError(null); setNearbySearchMeasurements([]);
    void (async () => {
      try {
        let history = routeHistoryCacheRef.current.get(operator);
        if (!history) {
          history = await loadAllMeasurementsForOperator(operator, 20_000);
          routeHistoryCacheRef.current.set(operator, history);
        }
        if (requestId !== nearbySearchRequestRef.current) return;
        setNearbySearchMeasurements(findNearbyMeasurements(history.measurements, operator, mapSearchSelection.position));
        setNearbySearchStatus('loaded');
        if (history.truncated) setNearbySearchError('Search used the newest 20,000 saved records; older locations may be missing.');
      } catch (error) {
        if (requestId !== nearbySearchRequestRef.current) return;
        setNearbySearchStatus('error');
        setNearbySearchError(error instanceof Error ? error.message : 'Could not load saved measurements.');
      }
    })();
    return () => { nearbySearchRequestRef.current++; };
  }, [mapSearchSelection, selectedOperator]);

  const telemetryLiveRows = currentMeasurement ? [...liveMeasurements, currentMeasurement] : liveMeasurements;
  const telemetrySelection = selectTelemetryMeasurement(telemetryLiveRows, persistedTelemetry.measurement, selectedOperator);

  // Stable callback when GPS position updates from CampusMap
  const handleUserLocationChange = useCallback((coords: {
    lat: number;
    lng: number;
    accuracy: number;
    speed: number | null;
    heading: number | null;
    timestamp?: number;
  }) => {
    const timestamp = Number.isFinite(coords.timestamp) ? coords.timestamp! : Date.now();
    userGpsRef.current = { ...coords, timestamp };
    setGpsFix({ lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy, timestamp });

    if (liveNavigationActiveRef.current && navigationRouteRef.current) {
      const fix: NavigationGpsFix = { lat: coords.lat, lng: coords.lng, accuracy: coords.accuracy, timestamp };
      const fixStatus = validateNavigationFix(fix, Date.now());
      if (fixStatus !== 'ready') {
        offRouteCountRef.current = 0;
        setNavigationOffRoute(false);
        setNavigationGpsMessage(fixStatus === 'inaccurate' ? `GPS accuracy ±${Math.round(coords.accuracy)} m is too wide for navigation progress.` : 'Waiting for a fresh GPS location.');
      } else if (isGpsJump(navigationFixRef.current, fix)) {
        offRouteCountRef.current = 0;
        setNavigationOffRoute(false);
        setNavigationGpsMessage('A sudden GPS jump was ignored; waiting for the next reliable fix.');
      } else {
        navigationFixRef.current = fix;
        const progress = calculateRouteProgress(navigationRouteRef.current, fix);
        const prior = navigationProgressRef.current;
        const along = prior ? Math.max(prior.distanceAlongMeters, progress.distanceAlongMeters) : progress.distanceAlongMeters;
        const total = progress.remainingMeters + progress.distanceAlongMeters;
        const monotonicProgress = total ? (along / total) * 100 : 0;
        const stableProgress = { ...progress, distanceAlongMeters: along, remainingMeters: Math.max(0, total - along),
          progressPercent: Math.min(100, monotonicProgress), remainingSeconds: Math.max(0, navigationRouteRef.current.durationSeconds * (1 - monotonicProgress / 100)) };
        navigationProgressRef.current = stableProgress;
        setNavigationProgress(stableProgress);
        const offRoute = advanceOffRouteFixCount(progress.distanceFromRouteMeters, coords.accuracy, offRouteCountRef.current);
        offRouteCountRef.current = offRoute.count;
        setNavigationOffRoute(offRoute.offRoute);
        setNavigationGpsMessage(`GPS active · accuracy ±${Math.round(coords.accuracy)} m · ${Math.round(progress.distanceFromRouteMeters)} m from route.`);
      }
    }

    // Accumulate distance during active measurement session
    if (isMeasuringRef.current) {
      if (lastAcceptedGpsRef.current) {
        const dist = haversineMeters(
          lastAcceptedGpsRef.current.lat,
          lastAcceptedGpsRef.current.lng,
          coords.lat,
          coords.lng
        );
        // Ignore minor GPS noise (<2m) and obvious impossible jumps (>200m)
        if (dist >= 2 && dist <= 200) {
          sessionDistanceRef.current += dist;
          lastAcceptedGpsRef.current = { lat: coords.lat, lng: coords.lng };
        }
      } else {
        lastAcceptedGpsRef.current = { lat: coords.lat, lng: coords.lng };
      }
    }
  }, []);

  const registerLocationRetry = useCallback((retry: () => void) => {
    locationRetryRef.current = retry;
  }, []);

  const handleMapsReady = useCallback((ready: boolean, error?: string) => {
    setMapsReady(ready);
    setMapsLoadError(error ?? null);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setGpsFreshnessClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const locationGateStatus = validateMeasurementGps(gpsFix, gpsFreshnessClock);
  // A fresh, valid fix is usable independently of permission state and reported confidence.
  // Permission/watch errors affect the status banner, never overall app access.
  const locationIsUsable = locationGateStatus === 'ready';
  const locationAccuracyWarning = measurementGpsAccuracyWarning(gpsFix);
  const locationStatusLabel = locationStatus.status === 'denied'
    ? `Location permission denied. Enable it in browser site settings.${locationIsUsable ? ` Last fix remains fresh (±${Math.round(gpsFix!.accuracy)} m).` : ''}`
    : locationStatus.status === 'unavailable' || locationStatus.status === 'timeout'
      ? `Location temporarily unavailable.${locationIsUsable ? ` Last fix remains fresh (±${Math.round(gpsFix!.accuracy)} m).` : ' Check device location services or retry.'}`
    : locationIsUsable
      ? locationAccuracyWarning ? locationAccuracyWarning : `Location ready · GPS accuracy ±${Math.round(gpsFix!.accuracy)} m.`
    : locationIsUsable
      ? locationAccuracyWarning ? locationAccuracyWarning : `Location ready · GPS accuracy ±${Math.round(gpsFix!.accuracy)} m.`
      : locationGateStatus === 'stale'
        ? 'Location is stale. Waiting for a fresh position.'
        : locationGateStatus === 'invalid'
          ? 'Location unavailable: the latest coordinates or accuracy are invalid.'
          : locationStatus.status === 'unsupported'
            ? 'This browser does not support location access.'
            : locationStatus.status === 'error'
              ? locationStatus.message ?? 'Location could not be read. Retry when needed.'
              : 'Locating…';

  const currentGpsReady = isValidCurrentRouteOrigin(gpsFix, gpsFreshnessClock);
  const currentGpsMessage = !gpsFix ? 'No GPS fix has been reported.' : !isValidCurrentRouteOrigin(gpsFix)
    ? gpsFix.accuracy > 50 ? 'GPS accuracy must be 50 metres or better.' : 'No fresh GPS fix. Location permission may be denied; use map points or enable location access.'
    : 'Use the current GPS location as origin.';
  const navigationDisplayMessage = !liveNavigationActive ? (() => {
    if (['denied', 'error', 'unsupported', 'unavailable', 'timeout'].includes(locationStatus.status)) return locationStatus.message ?? 'Location is unavailable.';
    if (['locating', 'requesting', 'idle'].includes(locationStatus.status)) return 'Waiting for GPS location.';
    const gpsStatus = validateNavigationFix(gpsFix, gpsFreshnessClock);
    return gpsStatus === 'ready' ? `GPS available · accuracy ±${Math.round(gpsFix!.accuracy)} m.` : gpsStatus === 'invalid' ? 'The browser returned invalid GPS data. Retry location access.' : gpsStatus === 'missing' ? 'Waiting for a GPS fix.' : 'GPS location is stale. Waiting for a fresh fix.';
  })() : (() => {
    const gpsStatus = validateNavigationFix(gpsFix, gpsFreshnessClock);
    if (gpsStatus === 'ready') return navigationGpsMessage || `GPS active · accuracy ±${Math.round(gpsFix!.accuracy)} m.`;
    if (gpsStatus === 'invalid') return 'The browser returned invalid GPS data. Retry location access.';
    if (gpsStatus === 'inaccurate') return `GPS accuracy ±${Math.round(gpsFix!.accuracy)} m is too wide for navigation progress.`;
    if (['denied', 'error', 'unsupported', 'unavailable', 'timeout'].includes(locationStatus.status)) return locationStatus.message ?? 'Location is unavailable. Check browser location settings.';
    return gpsStatus === 'missing' ? 'Waiting for a GPS fix. Allow location access in browser settings.' : 'GPS location is stale. Waiting for a fresh fix.';
  })();

  const handleLocationStatusChange = useCallback((status: LocationTrackerStatus, message: string | null) => {
    setLocationStatus({ status, message });
  }, []);

  const loadRouteOverlay = useCallback(async (route: WalkingRouteOption, operator: TelecomOperator) => {
    const requestId = ++routeOverlayRequestRef.current;
    setOverlayState('loading');
    setOverlayError(null);
    setRouteOverlay(null);
    try {
      let history = routeHistoryCacheRef.current.get(operator);
      if (!history) {
        history = await loadAllMeasurementsForOperator(operator, 20_000);
        routeHistoryCacheRef.current.set(operator, history);
      }
      if (requestId !== routeOverlayRequestRef.current) return;
      const overlay = buildRouteNetworkOverlay(route.path, history.measurements, operator);
      const allOverlays = new Map<string, RouteNetworkOverlay>();
      for (const candidate of walkingRoutes) allOverlays.set(candidate.id, buildRouteNetworkOverlay(candidate.path, history.measurements, operator));
      if (!allOverlays.has(route.id)) allOverlays.set(route.id, overlay);
      setRouteOverlays(allOverlays);
      setRouteOverlay(overlay);
      setOverlayTruncated(history.truncated);
      setOverlayState('ready');
    } catch (error) {
      if (requestId !== routeOverlayRequestRef.current) return;
      console.warn(`[NETNAV ROUTE] Could not load ${operator} route measurements:`, error);
      setOverlayError(error instanceof Error ? error.message : 'Measurement history request failed.');
      setOverlayState('error');
    }
  }, [walkingRoutes]);

  const selectedWalkingRoute = walkingRoutes[selectedWalkingRouteIndex] ?? null;
  const routeRankings = calculateRouteRankings(walkingRoutes, new Map(
    [...routeOverlays].filter(([, overlay]) => overlay.operator === selectedOperator),
  ), undefined, !overlayTruncated);
  useEffect(() => {
    if (navigationActive && routeState === 'ready' && selectedWalkingRoute) void loadRouteOverlay(selectedWalkingRoute, selectedOperator);
  }, [navigationActive, routeState, selectedWalkingRoute, selectedOperator, loadRouteOverlay]);

  const requestWalkingRoutes = async () => {
    const requestId = ++walkingRouteRequestRef.current;
    routeOverlayRequestRef.current++;
    if (!routeOrigin || !routeDestination) {
      setRouteState('error');
      setRouteError('Choose both an origin and destination on the map.');
      return;
    }
    if (mapsReady !== true) {
      setRouteState('error');
      setRouteError(mapsLoadError ?? 'Google Maps is not ready. Check the Maps JavaScript API configuration and retry.');
      return;
    }
    setRouteState('loading');
    setRouteError(null);
    setWalkingRoutes([]);
    setRouteOverlay(null);
    setRouteOverlays(new Map());
    setOverlayState('idle');
    try {
      const library = await importLibrary('routes') as unknown as { Route: { computeRoutes: ComputeRoutes } };
      const routes = await requestWalkingRoutesWith((request) => library.Route.computeRoutes(request), routeOrigin, routeDestination);
      if (requestId !== walkingRouteRequestRef.current) return;
      setWalkingRoutes(routes);
      setSelectedWalkingRouteIndex(0);
      setRouteState('ready');
    } catch (error) {
      if (requestId !== walkingRouteRequestRef.current) return;
      console.warn('[NETNAV ROUTE] Walking route request failed:', error);
      setRouteState('error');
      setRouteError(error instanceof Error ? error.message : 'Walking routes could not be loaded.');
    }
  };

  const clearWalkingRoute = () => {
    routeOverlayRequestRef.current++;
    walkingRouteRequestRef.current++;
    setRouteOrigin(null);
    setRouteDestination(null);
    setRoutePickMode(null);
    setWalkingRoutes([]);
    setSelectedWalkingRouteIndex(0);
    setRouteState('idle');
    setRouteError(null);
    setRouteOverlay(null);
    setRouteOverlays(new Map());
    setOverlayState('idle');
    setOverlayError(null);
    setOverlayTruncated(false);
  };

  const setRoutePick = (point: RouteCoordinate) => {
    walkingRouteRequestRef.current++;
    routeOverlayRequestRef.current++;
    if (routePickMode === 'origin') setRouteOrigin(point);
    else if (routePickMode === 'destination') setRouteDestination(point);
    else return;
    setRoutePickMode(null);
    setWalkingRoutes([]);
    setRouteOverlay(null);
    setRouteState('idle');
    setOverlayState('idle');
    setRouteError(null);
  };

  const useGpsAsRouteOrigin = () => {
    if (!gpsFix || !isValidCurrentRouteOrigin(gpsFix, Date.now())) {
      setRouteError(currentGpsMessage);
      return;
    }
    walkingRouteRequestRef.current++;
    routeOverlayRequestRef.current++;
    setRouteOrigin({ lat: gpsFix.lat, lng: gpsFix.lng });
    setWalkingRoutes([]);
    setRouteOverlay(null);
    setRouteState('idle');
    setOverlayState('idle');
    setRouteError(null);
  };

  const swapRouteEndpoints = () => {
    walkingRouteRequestRef.current++;
    routeOverlayRequestRef.current++;
    setRouteOrigin(routeDestination);
    setRouteDestination(routeOrigin);
    setWalkingRoutes([]);
    setRouteOverlay(null);
    setRouteState('idle');
    setOverlayState('idle');
    setRouteError(null);
  };

  const selectWalkingRoute = (index: number) => {
    setSelectedWalkingRouteIndex(index);
  };

  const startLiveNavigation = () => {
    const route = startNavigationSession(walkingRoutes[selectedWalkingRouteIndex] ?? null, routeState, gpsFix, Date.now());
    if (!route) {
      const gpsStatus = validateNavigationFix(gpsFix, Date.now());
      showToast(gpsStatus !== 'ready' ? gpsStatus === 'inaccurate' ? 'Navigation needs GPS accuracy of 50 metres or better.' : locationStatus.status === 'denied' ? 'Location is denied. Enable it in browser site settings.' : 'Navigation needs a fresh GPS location. Wait for a fix or retry location access.' : 'Choose a calculated walking route before starting navigation.');
      return;
    }
    navigationRouteRef.current = route;
    navigationFixRef.current = gpsFix;
    lastRerouteAtRef.current = 0;
    navigationProgressRef.current = null;
    offRouteCountRef.current = 0;
    liveNavigationActiveRef.current = true;
    setLiveNavigationActive(true);
    setNavigationProgress(null);
    setNavigationOffRoute(false);
    setNavigationGpsMessage('Navigation started. Waiting for the next reliable GPS update.');
    setRerouteState('idle');
    setRerouteError(null);
    setRerouteRoutes([]);
  };

  const endLiveNavigation = () => {
    if (liveNavigationActiveRef.current && !window.confirm('End this live navigation session?')) return;
    liveNavigationActiveRef.current = false;
    navigationRouteRef.current = endNavigationSession();
    navigationFixRef.current = null;
    navigationProgressRef.current = null;
    offRouteCountRef.current = 0;
    rerouteInFlightRef.current = false;
    setLiveNavigationActive(false);
    setNavigationProgress(null);
    setNavigationOffRoute(false);
    setNavigationGpsMessage('');
    setRerouteState('idle');
    setRerouteError(null);
    setRerouteRoutes([]);
  };

  const requestReroute = async () => {
    const now = Date.now();
    const gpsStatus = validateNavigationFix(gpsFix, now);
    if (!liveNavigationActiveRef.current || !routeDestination || gpsStatus !== 'ready') {
      setRerouteState('error');
      setRerouteError(gpsStatus === 'inaccurate' ? 'A precise GPS fix is needed before requesting a replacement route.' : locationStatus.message ?? 'A fresh GPS fix and an active destination are required to reroute.');
      return;
    }
    if (!canRequestReroute(lastRerouteAtRef.current, now, rerouteInFlightRef.current)) {
      setRerouteState('error');
      setRerouteError('Please wait before requesting another route.');
      return;
    }
    rerouteInFlightRef.current = true;
    lastRerouteAtRef.current = now;
    const requestId = ++walkingRouteRequestRef.current;
    setRerouteState('loading');
    setRerouteError(null);
    setRerouteRoutes([]);
    try {
      if (mapsReady !== true) throw new Error(mapsLoadError ?? 'Google Maps is not ready. Check Maps/Routes API access and retry.');
      const library = await importLibrary('routes') as unknown as { Route: { computeRoutes: ComputeRoutes } };
      const options = await requestWalkingRoutesWith((request) => library.Route.computeRoutes(request), { lat: gpsFix!.lat, lng: gpsFix!.lng }, routeDestination);
      if (requestId !== walkingRouteRequestRef.current || !liveNavigationActiveRef.current) return;
      setRerouteRoutes(options);
      setRerouteState('ready');
    } catch (error) {
      if (requestId !== walkingRouteRequestRef.current) return;
      setRerouteState('error');
      setRerouteError(error instanceof Error ? error.message : 'Could not calculate a replacement route. Your current navigation route is unchanged.');
    } finally {
      rerouteInFlightRef.current = false;
    }
  };

  const applyReroute = (index: number) => {
    const replacement = rerouteRoutes[index];
    if (!replacement) return;
    const route = { ...replacement, id: `reroute-${Date.now()}-${index}` };
    navigationRouteRef.current = route;
    navigationFixRef.current = gpsFix;
    navigationProgressRef.current = null;
    offRouteCountRef.current = 0;
    setSelectedWalkingRouteIndex(walkingRoutes.length);
    setWalkingRoutes((routes) => [...routes, route]);
    setRouteOrigin({ lat: gpsFix!.lat, lng: gpsFix!.lng });
    setRouteState('ready');
    setRouteOverlay(null);
    setRouteOverlays(new Map());
    setOverlayState('loading');
    setNavigationProgress(null);
    setNavigationOffRoute(false);
    setNavigationGpsMessage('Replacement route selected. Tracking progress on the new route.');
    setRerouteRoutes([]);
    setRerouteState('idle');
  };

  const activateRoutePlanner = () => {
    setActiveTab('nav');
    setNavigationActive(true);
    const element = document.getElementById('map-section');
    element?.scrollIntoView({ behavior: 'smooth' });
  };

  // Start Live Measurement Session
  const beginMeasurementSession = (operator: TelecomOperator) => {
    if (isMeasuringRef.current) return;
    if (!networkMeasurer.getConfig().serverUrl) {
      showToast('Measurement server is not configured. Set VITE_MEASUREMENT_SERVER_URL to the HTTPS Render URL and rebuild the frontend.');
      return;
    }
    const gps = userGpsRef.current;
    const gpsStatus = validateMeasurementGps(gps);
    if (gpsStatus !== 'ready') {
      showToast(`${measurementGpsMessage(gpsStatus)} Allow location access or use the map’s retry control.`);
      return;
    }
    selectedOperatorRef.current = operator;
    setSelectedOperator(operator);

    // A completed prior run cannot leave a scheduled cycle behind.
    measurementLoopRef.current?.stop();
    measurementLoopRef.current = null;
    if (abortControllerRef.current !== null) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Begin fresh measurement session
    isMeasuringRef.current = true;
    setIsMeasuring(true);
    setLiveMeasurements([]);
    setCurrentMeasurement(null);
    setCurrentMeasurementStorage(null);
    setSessionSummary(null);
    gpsPauseReasonRef.current = null;
    measurementCycleFailureCountRef.current = 0;

    networkMeasurer.resetSession();
    sessionDistanceRef.current = 0;
    sessionStartTimeRef.current = Date.now();
    lastAcceptedGpsRef.current = userGpsRef.current ? { lat: userGpsRef.current.lat, lng: userGpsRef.current.lng } : null;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    showToast('🚀 LIVE MEASUREMENT SESSION STARTED! Sampling network quality every ~1 second...');

    // Scroll cleanly to live measurement section
    const elem = document.getElementById('live-measurement-section');
    if (elem) {
      elem.scrollIntoView({ behavior: 'smooth' });
    }

    // Each cycle settles before the next timer is armed. Rerenders do not own this loop.
    const loop = new SequentialMeasurementLoop({
      intervalMs: 1000,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer as number),
      runCycle: async (cycleNumber) => {
        if (!isMeasuringRef.current || controller.signal.aborted) return 'skipped';
        const currentGps = userGpsRef.current;
        const gpsStatus = validateMeasurementGps(currentGps);
        if (gpsStatus !== 'ready' || !currentGps) {
          if (gpsPauseReasonRef.current !== gpsStatus) {
            gpsPauseReasonRef.current = gpsStatus;
            showToast(`${measurementGpsMessage(gpsStatus)} Measurement is paused until a fresh, valid location returns.`);
          }
          if (import.meta.env.DEV) console.debug(`[NETNAV MEASURE] cycle ${cycleNumber} skipped; waiting for valid GPS (${gpsStatus})`);
          return 'skipped';
        }
        gpsPauseReasonRef.current = null;

        const { lat, lng, accuracy, speed, heading } = currentGps;
        const sample = await networkMeasurer.measureSample(lat, lng, accuracy, selectedOperatorRef.current, heading, speed, controller.signal);

        // A slow cycle can outlive the GPS fix. Discard it, but keep the session alive for a new fix.
        const measurementFixStatus = validateMeasurementGps(currentGps);
        const completionGpsStatus = validateMeasurementGps(userGpsRef.current);
        if (measurementFixStatus !== 'ready' || completionGpsStatus !== 'ready') {
          const invalidStatus = measurementFixStatus !== 'ready' ? measurementFixStatus : completionGpsStatus;
          if (gpsPauseReasonRef.current !== invalidStatus) {
            gpsPauseReasonRef.current = invalidStatus;
            showToast('The GPS fix associated with this sample became stale or invalid. This sample was discarded; measuring will resume with a fresh fix.');
          }
          if (import.meta.env.DEV) console.debug(`[NETNAV MEASURE] cycle ${cycleNumber} discarded; measurement-start or current GPS is invalid (${invalidStatus})`);
          return 'skipped';
        }
        if (!isMeasuringRef.current || controller.signal.aborted) return 'skipped';

        const storageEligibility = getMeasurementStorageEligibility(sample);
        const eligibleForStorage = storageEligibility === 'pending';
        setCurrentMeasurement(sample);
        setCurrentMeasurementStorage({ measurementId: sample.id, status: storageEligibility });
        setLiveMeasurements((prev) => [...prev, sample]);
        if (eligibleForStorage) {
          const saveResult = await confirmMeasurementSave(() => saveMeasurement(sample, controller.signal));
          if (saveResult.status === 'failed') {
            if (controller.signal.aborted) {
              setCurrentMeasurementStorage((current) => current?.measurementId === sample.id ? { measurementId: sample.id, status: 'unknown', error: 'Request was cancelled; verify history before retrying.' } : current);
              return 'skipped';
            }
            const message = saveResult.error;
            setCurrentMeasurementStorage((current) => current?.measurementId === sample.id ? { measurementId: sample.id, status: 'failed', error: message } : current);
            console.warn('[NETNAV STORAGE] Sample was measured, but saving it to history failed. Network measurement remains valid:', message);
            if (!storageIssueShownRef.current) {
              showToast(`Measurement collected but not saved: ${message}`);
              storageIssueShownRef.current = true;
            }
            return;
          }
          setCurrentMeasurementStorage((current) => current?.measurementId === sample.id ? { measurementId: sample.id, status: 'saved' } : current);
          routeHistoryCacheRef.current.delete(sample.operator);
          storageIssueShownRef.current = false;
          if (searchAfterSaveRef.current) {
            searchAfterSaveRef.current = false;
            try {
              const refreshedResult = await refreshAndSearchAfterSave(
                async () => { await refreshHistoricalMeasurements(); },
                () => routeHistoryCacheRef.current.delete(sample.operator),
                async () => await rerunBestSpotRef.current?.(false) ?? null
              );
              if (refreshedResult?.status !== 'success') {
                showToast('The saved sample is not yet eligible as a verified nearby spot. Keep measuring or retry the search after another sample.');
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'History refresh failed';
              console.warn('[NETNAV STORAGE] Measurement save was confirmed, but the follow-up history/search refresh failed:', message);
              showToast(`Measurement saved, but history could not be refreshed: ${message}`);
            }
          }
        } else if (searchAfterSaveRef.current && sample.throughputTestPerformed) {
          showToast('This cycle did not produce an eligible scored record. The area search will retry after the next valid saved measurement.');
        }
        return;
      },
      onCycleError: (error, cycleNumber) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        measurementCycleFailureCountRef.current++;
        if (import.meta.env.DEV && (measurementCycleFailureCountRef.current === 1 || measurementCycleFailureCountRef.current % 10 === 0)) {
          console.warn(`[NETNAV MEASURE] cycle ${cycleNumber} failed (${measurementCycleFailureCountRef.current} consecutive failure(s)); loop will retry`, error instanceof Error ? error.message : String(error));
        }
      },
      onCycleSettled: (outcome, cycleNumber) => {
        if (outcome !== 'failed') measurementCycleFailureCountRef.current = 0;
        if (import.meta.env.DEV) console.debug(`[NETNAV MEASURE] cycle ${cycleNumber} ${outcome}`);
      }
    });
    measurementLoopRef.current = loop;
    loop.start();
  };

  const openMeasurementSelection = () => {
    const prompt = getLocationPromptForAction('measure', locationIsUsable);
    if (prompt) {
      setLocationPromptError(null);
      setActiveLocationPrompt(prompt);
      return;
    }
    setLocationPromptError(null);
    setActiveLocationPrompt(null);
    setMeasurementOperatorChoice(selectedOperatorRef.current);
    setMeasurementStartError(null);
    setMeasurementDialogOpen(true);
  };

  const handleStartMeasuring = () => {
    if (isMeasuringRef.current || measurementDialogOpen) return;
    const prompt = getLocationPromptForAction('measure', locationIsUsable);
    if (prompt) {
      setLocationPromptError(null);
      setActiveLocationPrompt(prompt);
      return;
    }
    openMeasurementSelection();
  };

  const confirmMeasurementStart = () => {
    const gpsStatus = validateMeasurementStart(measurementOperatorChoice, userGpsRef.current, gpsFreshnessClock);
    if (gpsStatus === 'operator-required') {
      setMeasurementStartError('Select Jio, Airtel, Vi, or BSNL before measuring.');
      return;
    }
    if (gpsStatus !== 'ready' || !locationIsUsable) {
      setMeasurementDialogOpen(false);
      setLocationPromptError(gpsStatus !== 'ready' ? measurementGpsMessage(gpsStatus) : 'Waiting for a current location fix.');
      setActiveLocationPrompt('measure');
      return;
    }
    if (!networkMeasurer.getConfig().serverUrl) {
      setMeasurementStartError('Measurement server is not configured. Set VITE_MEASUREMENT_SERVER_URL to the HTTPS Render URL and rebuild.');
      return;
    }
    const operator = measurementOperatorChoice;
    setSelectedOperator(operator);
    selectedOperatorRef.current = operator;
    bestSpotRequestedOperatorRef.current = null;
    setHistoryOperator(operator);
    setHasExplicitOperatorSelection(true);
    setMeasurementDialogOpen(false);
    beginMeasurementSession(operator);
  };

  const handleOperatorSelected = (operator: TelecomOperator) => {
    if (isMeasuringRef.current) {
      showToast('Stop the current measurement session before changing its network label.');
      return;
    }
    selectedOperatorRef.current = operator;
    bestSpotRequestedOperatorRef.current = null;
    setSelectedOperator(operator);
    setHistoryOperator(operator);
    setHasExplicitOperatorSelection(true);
    showToast(`Selected network label changed to ${operator}. The browser does not verify the serving SIM.`);
  };

  // Stop Live Measurement Session
  const handleStopMeasuring = () => {
    if (!isMeasuringRef.current) return;

    isMeasuringRef.current = false;
    setIsMeasuring(false);
    const stoppedLoop = measurementLoopRef.current;
    stoppedLoop?.stop();
    measurementLoopRef.current = null;
    if (import.meta.env.DEV) console.info(`[NETNAV MEASURE] session stopped explicitly after ${stoppedLoop?.cycleCount ?? 0} cycle(s)`);

    // Abort in-flight requests immediately
    if (abortControllerRef.current !== null) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Finalize session calculations
    setLiveMeasurements((all) => {
      const durationSeconds = Math.max(1, Math.round((Date.now() - sessionStartTimeRef.current) / 1000));
      const distanceMeters = Math.round(sessionDistanceRef.current);

      if (all.length > 0) {
        // Exclude NO_CONNECTIVITY/offline observations from Best/Worst spot calculations
        const validSamples = all.filter((m) => m.status !== 'NO_CONNECTIVITY' && m.status !== 'UNAVAILABLE' && !m.isOffline && m.measurementMethodVersion !== 'legacy-v1');

        const bestSpot = validSamples.length > 0
          ? validSamples.reduce((max, cur) => (cur.nqs > max.nqs ? cur : max), validSamples[0])
          : null;

        const worstSpot = validSamples.length > 0
          ? validSamples.reduce((min, cur) => (cur.nqs < min.nqs ? cur : min), validSamples[0])
          : null;

        const avgNqs = validSamples.length > 0
          ? Math.round(validSamples.reduce((sum, item) => sum + item.nqs, 0) / validSamples.length)
          : 0;

        const offlineCount = all.filter((m) => m.status === 'NO_CONNECTIVITY' || m.isOffline).length;

        setSessionSummary({
          totalMeasurements: all.length,
          distanceMeters,
          durationSeconds,
          bestSpot,
          worstSpot,
          startTime: all[0].timestamp,
          endTime: all[all.length - 1].timestamp,
          avgNqs,
          offlineCount
        });

        showToast(
          `⏹️ MEASUREMENT STOPPED. ${all.length} samples over ${distanceMeters}m. ${
            bestSpot ? `Best NQS: ${bestSpot.nqs} (${bestSpot.status})` : 'No valid network samples'
          }`
        );
      }
      return all; // Keep collected session measurements plotted on map!
    });
  };

  // Cleanup timers and abort controllers on unmount
  useEffect(() => {
    return () => {
      if (isMeasuringRef.current && import.meta.env.DEV) console.info('[NETNAV MEASURE] session ended because the application component unmounted; active requests were aborted');
      isMeasuringRef.current = false;
      measurementLoopRef.current?.stop();
      measurementLoopRef.current = null;
      if (abortControllerRef.current !== null) {
        abortControllerRef.current.abort();
      }
      liveNavigationActiveRef.current = false;
      navigationRouteRef.current = endNavigationSession();
      rerouteInFlightRef.current = false;
      walkingRouteRequestRef.current++;
      routeOverlayRequestRef.current++;
    };
  }, []);

  const runBestSpotSearch = async (showFirstMeasurePrompt = true, operatorOverride?: TelecomOperator): Promise<PersistedBestSpotSearchResult | null> => {
    const requestId = ++bestSpotRequestRef.current;
    const operator = operatorOverride ?? selectedOperator;
    bestSpotRequestedOperatorRef.current = operator;
    setFindBestSpotState({ status: 'history-loading' });
    setFirstMeasurePromptOpen(false);
    const result = await searchPersistedBestSpot(async () => {
      let history = routeHistoryCacheRef.current.get(operator);
      if (!history) {
        history = await loadAllMeasurementsForOperator(operator, 20_000);
        routeHistoryCacheRef.current.set(operator, history);
      }
      return history;
    }, operator, userGpsRef.current, gpsFreshnessClock);
    if (requestId !== bestSpotRequestRef.current || selectedOperatorRef.current !== operator) return null;
    if (result.status === 'gps-unavailable' || result.status === 'gps-stale' || result.status === 'gps-invalid') {
      setFindBestSpotState(result);
      setFirstMeasurePromptOpen(false);
      return result;
    }
    if (result.status === 'history-error') console.warn(`[NETNAV BEST SPOT] ${operator} history request failed:`, result.message);
    setFindBestSpotState(result);
    if (result.status === 'no-data' && showFirstMeasurePrompt) setFirstMeasurePromptOpen(true);
    return result;
  };
  rerunBestSpotRef.current = runBestSpotSearch;

  const startFindBestSpotFlow = () => {
    if (!hasExplicitOperatorSelection) {
      setMeasurementOperatorChoice(selectedOperator);
      setFindOperatorDialogOpen(true);
      return;
    }
    void runBestSpotSearch();
    const element = document.getElementById('results-section');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleFindBestSpot = () => {
    const prompt = getLocationPromptForAction('best-spot', locationIsUsable);
    if (prompt) {
      setLocationPromptError(null);
      setActiveLocationPrompt(prompt);
      return;
    }
    startFindBestSpotFlow();
  };

  const retryLocationFromPrompt = () => {
    setLocationPromptError(null);
    locationRetryRef.current();
  };

  const dismissLocationPrompt = () => {
    if (activeLocationPrompt === 'measure') searchAfterSaveRef.current = false;
    setActiveLocationPrompt(null);
    setLocationPromptError(null);
  };

  const continueLocationAction = () => {
    const action = activeLocationPrompt;
    if (!locationIsUsable || !action) {
      setLocationPromptError('A fresh, valid GPS fix is not available yet. Retry or cancel.');
      return;
    }
    setActiveLocationPrompt(null);
    setLocationPromptError(null);
    if (action === 'measure') openMeasurementSelection();
    else startFindBestSpotFlow();
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 6000);
  };

  return (
    <div style={styles.appWrapper} className="app-shell">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab === 'nav') {
            activateRoutePlanner();
          } else {
            setActiveTab(tab);
            if (!liveNavigationActiveRef.current) setNavigationActive(false);
          }
          if (tab === 'measure') {
            if (!isMeasuring) {
              handleStartMeasuring();
            } else {
              handleStopMeasuring();
            }
          }
        }}
      />

      <div role="status" aria-live="polite" style={dialogStyles.locationStatus}>
        <span>{locationIsUsable && locationAccuracyWarning ? locationAccuracyWarning : locationStatusLabel}</span>
        {(!locationIsUsable || ['denied', 'unavailable', 'timeout', 'error'].includes(locationStatus.status)) && <button type="button" style={dialogStyles.locationRetry} onClick={() => locationRetryRef.current()} disabled={locationStatus.status === 'requesting'}>
          {locationStatus.status === 'requesting' ? 'Requesting…' : 'Enable / retry location'}
        </button>}
      </div>

      {/* Main Content Layout */}
      <main style={styles.mainContent} className="main-content">
        {/* HERO AREA: Primary Feature (FIND BEST SPOT) */}
        <HeroSection
          selectedOperator={selectedOperator}
          onSelectOperator={handleOperatorSelected}
          onFindBestSpotClick={handleFindBestSpot}
        />

        {/* MAP VISUALIZATION AREA */}
        <section id="map-section" style={styles.sectionContainer}>
          <MapVisualization
            selectedOperator={selectedOperator}
            historicalMeasurements={historicalMeasurements}
            historyOperator={historyOperator}
            onHistoryOperatorChange={setHistoryOperator}
            historyStatus={historyStatus}
            historyError={historyError}
            onRetryHistory={() => { void refreshHistoricalMeasurements(); }}
            bestSpotCandidate={findBestSpotState.status === 'success' ? findBestSpotState.candidate : null}
            onLocationRetryReady={registerLocationRetry}
            navigationActive={navigationActive}
            onCloseNavigation={() => {
              if (liveNavigationActiveRef.current) {
                endLiveNavigation();
                if (liveNavigationActiveRef.current) return;
              }
              setNavigationActive(false);
              setRoutePickMode(null);
              walkingRouteRequestRef.current++;
              routeOverlayRequestRef.current++;
            }}
            routeOrigin={routeOrigin}
            routeDestination={routeDestination}
            routePickMode={routePickMode}
            onPickRouteEndpoint={setRoutePick}
            onMapsReady={handleMapsReady}
            onLocationStatusChange={handleLocationStatusChange}
            walkingRoutes={walkingRoutes}
            selectedWalkingRouteIndex={selectedWalkingRouteIndex}
            onSelectWalkingRoute={selectWalkingRoute}
            routeState={routeState}
            routeError={routeError}
            onRequestWalkingRoutes={() => { void requestWalkingRoutes(); }}
            onRetryWalkingRoutes={() => { void requestWalkingRoutes(); }}
            currentGpsReady={currentGpsReady}
            currentGpsMessage={currentGpsMessage}
            onUseGpsOrigin={useGpsAsRouteOrigin}
            onSetRoutePickMode={(mode) => { setRouteError(null); setRoutePickMode(mode); }}
            onSwapRouteEndpoints={swapRouteEndpoints}
            onClearRoute={clearWalkingRoute}
            routeOverlay={routeOverlay}
            overlayState={overlayState}
            overlayError={overlayError}
            overlayTruncated={overlayTruncated}
            routeRankings={routeRankings}
            mapSearchSelection={mapSearchSelection}
            nearbySearchMeasurements={nearbySearchMeasurements}
            nearbySearchStatus={nearbySearchStatus}
            nearbySearchError={nearbySearchError}
            onSelectMapSearchLocation={setMapSearchSelection}
            onMeasureSearchedArea={handleStartMeasuring}
            onRetryNearbySearch={() => {
              routeHistoryCacheRef.current.delete(selectedOperator);
              setMapSearchSelection((current) => current ? { ...current } : null);
            }}
            liveNavigationActive={liveNavigationActive}
            navigationProgress={navigationProgress}
            navigationGpsMessage={navigationDisplayMessage}
            navigationOffRoute={navigationOffRoute}
            rerouteState={rerouteState}
            rerouteError={rerouteError}
            rerouteRoutes={rerouteRoutes}
            onStartLiveNavigation={startLiveNavigation}
            onEndLiveNavigation={endLiveNavigation}
            onRequestReroute={() => { void requestReroute(); }}
            onApplyReroute={applyReroute}
            onRetryLocation={() => locationRetryRef.current()}
            onRetryOverlay={() => {
              if (selectedWalkingRoute) {
                routeHistoryCacheRef.current.delete(selectedOperator);
                void loadRouteOverlay(selectedWalkingRoute, selectedOperator);
              }
            }}
            liveMeasurements={liveMeasurements}
            isMeasuring={isMeasuring}
            locationFresh={locationIsUsable}
            locationHasFix={gpsFix !== null}
            sessionSummary={sessionSummary}
            onUserLocationChange={handleUserLocationChange}
          />
        </section>

        {/* LIVE MEASUREMENT PROTOTYPE CARD SECTION */}
        <section id="live-measurement-section" style={styles.resultsGridSection}>
          <LiveMeasurementCard
            isMeasuring={isMeasuring}
            currentMeasurement={currentMeasurement}
            storageState={currentMeasurementStorage?.measurementId === currentMeasurement?.id ? currentMeasurementStorage : null}
            measurementCount={liveMeasurements.length}
            sessionSummary={sessionSummary}
            onStartMeasuring={handleStartMeasuring}
            onStopMeasuring={handleStopMeasuring}
          />
        </section>

        {/* HISTORICAL RESULTS & METRICS ROW */}
        <section id="results-section" style={styles.resultsGridSection}>
            <div style={styles.resultsGrid} className="results-grid">
            {/* Primary Feature Output: Best Spot Card */}
            <BestSpotCard
              selectedOperator={selectedOperator}
              state={findBestSpotState}
              onMeasureLiveClick={handleStartMeasuring}
              onRetrySearch={() => { void runBestSpotSearch(); }}
              onRetryLocation={() => locationRetryRef.current()}
              onRetryHistory={() => {
                routeHistoryCacheRef.current.delete(selectedOperator);
                void runBestSpotSearch();
              }}
            />

            {/* Network Telemetry Metrics Card */}
            <MetricsCard
              measurement={telemetrySelection.measurement}
              source={telemetrySelection.source}
              historyStatus={persistedTelemetry.status}
              historyError={persistedTelemetry.error}
              operatorName={`${selectedOperator}`}
            />
          </div>
        </section>

        {/* SECONDARY FEATURE CARDS (Start Navigation & Start Measuring) */}
        <SecondaryFeatures
          onNavigationClick={() => {
            activateRoutePlanner();
          }}
          onMeasuringClick={() => {
            if (!isMeasuring) {
              handleStartMeasuring();
            } else {
              handleStopMeasuring();
            }
          }}
        />
      </main>
      {activeLocationPrompt && <AccessibleDialog title={activeLocationPrompt === 'measure' ? 'Location needed to measure' : 'Location needed to find a spot'} onClose={dismissLocationPrompt}>
        <p style={dialogStyles.body}>{activeLocationPrompt === 'measure' ? 'A fresh browser location is needed to attach coordinates and reported GPS accuracy to a measurement.' : 'A fresh browser location is needed to search saved measurements around your GPS estimate.'}</p>
        <p role="status" style={dialogStyles.notice}>{locationStatusLabel}</p>
        {locationStatus.status === 'denied' && <p style={dialogStyles.caption}>Enable location for this site in browser settings. Device location services must also be enabled by you; this website cannot switch them on.</p>}
        {!window.isSecureContext && <p style={dialogStyles.caption}>Geolocation may require HTTPS or localhost in this browser. NetNav cannot bypass browser security.</p>}
        {locationPromptError && <p role="alert" style={dialogStyles.error}>{locationPromptError}</p>}
        <div style={dialogStyles.actions}>
          <button type="button" style={dialogStyles.primary} onClick={retryLocationFromPrompt} disabled={locationStatus.status === 'requesting'}>Retry Location</button>
          {locationIsUsable && <button type="button" style={dialogStyles.primary} onClick={continueLocationAction}>Continue</button>}
          <button type="button" style={dialogStyles.secondary} onClick={dismissLocationPrompt}>Cancel</button>
        </div>
      </AccessibleDialog>}

      {findOperatorDialogOpen && <AccessibleDialog title="Choose a network for Find Best Spot" onClose={() => setFindOperatorDialogOpen(false)}>
        <p style={dialogStyles.body}>Find Best Spot searches only saved measurements tagged with this selected network. NetNav does not detect the serving SIM.</p>
        <fieldset style={dialogStyles.operatorList}>
          <legend style={dialogStyles.caption}>Target network</legend>
          {OPERATORS.map((operator) => <label key={operator.id} style={dialogStyles.operatorOption}>
            <input type="radio" name="find-operator" value={operator.id} checked={measurementOperatorChoice === operator.id}
              onChange={() => setMeasurementOperatorChoice(operator.id)} />
            <span>{operator.name}</span>
          </label>)}
        </fieldset>
        <p style={dialogStyles.caption}>The nominal search radius is 10 metres from the GPS estimate. The browser’s reported uncertainty may be larger than this radius.</p>
        <div style={dialogStyles.actions}>
          <button type="button" style={dialogStyles.primary} onClick={() => {
            if (!locationIsUsable) {
              setFindOperatorDialogOpen(false);
              setActiveLocationPrompt('best-spot');
              setLocationPromptError(null);
              return;
            }
            const operator = measurementOperatorChoice;
            selectedOperatorRef.current = operator;
            setSelectedOperator(operator);
            setHistoryOperator(operator);
            setHasExplicitOperatorSelection(true);
            setFindOperatorDialogOpen(false);
            void runBestSpotSearch(true, operator);
          }}>Search Nearby</button>
          <button type="button" style={dialogStyles.secondary} onClick={() => setFindOperatorDialogOpen(false)}>Cancel</button>
        </div>
      </AccessibleDialog>}

      {measurementDialogOpen && <AccessibleDialog title="Choose the network label to measure" onClose={() => {
        setMeasurementDialogOpen(false); searchAfterSaveRef.current = false;
      }}>
        <p style={dialogStyles.body}>Select the network you want to associate with this measurement. NetNav does not independently detect which SIM or network carried the request.</p>
        <fieldset style={dialogStyles.operatorList}>
          <legend style={dialogStyles.caption}>Network</legend>
          {OPERATORS.map((operator) => <label key={operator.id} style={dialogStyles.operatorOption}>
            <input type="radio" name="measurement-operator" value={operator.id} checked={measurementOperatorChoice === operator.id}
              onChange={() => { setMeasurementOperatorChoice(operator.id); setMeasurementStartError(null); }} />
            <span>{operator.name}</span>
          </label>)}
        </fieldset>
        <p style={dialogStyles.notice}>{locationIsUsable ? `Current GPS accuracy estimate: ±${Math.round(gpsFix!.accuracy)} m.` : locationStatusLabel}</p>
        {measurementStartError && <p role="alert" style={dialogStyles.error}>{measurementStartError}</p>}
        <div style={dialogStyles.actions}>
          <button type="button" style={dialogStyles.primary} onClick={confirmMeasurementStart} disabled={isMeasuring}>Start Measuring</button>
          <button type="button" style={dialogStyles.secondary} onClick={() => {
            setMeasurementDialogOpen(false); searchAfterSaveRef.current = false;
          }}>Cancel</button>
        </div>
      </AccessibleDialog>}

      {firstMeasurePromptOpen && findBestSpotState.status === 'no-data' && <AccessibleDialog title="No verified measurement nearby" onClose={() => setFirstMeasurePromptOpen(false)}>
        <p style={dialogStyles.body}>No verified measurement was found within the nominal 10-metre radius of your GPS estimate for {selectedOperator}. Be the first to measure this area?</p>
        <p style={dialogStyles.caption}>Your current GPS uncertainty is approximately ±{Math.round(gpsFix?.accuracy ?? 0)} m, so the actual position may be outside that radius. Only saved quality-v2 records with a matching NQS calculation are considered.</p>
        <div style={dialogStyles.actions}>
          <button type="button" style={dialogStyles.primary} onClick={() => {
            searchAfterSaveRef.current = true;
            setFirstMeasurePromptOpen(false);
            setMeasurementOperatorChoice(selectedOperator);
            setMeasurementStartError(null);
            openMeasurementSelection();
          }} disabled={isMeasuring}>Start Measuring Here</button>
          <button type="button" style={dialogStyles.secondary} onClick={() => setFirstMeasurePromptOpen(false)}>Cancel</button>
        </div>
      </AccessibleDialog>}

      {/* Futuristic UI Toast Notification */}
      {toastMessage && (
      <div style={styles.toastNotice} className="glass-panel app-toast">
          <div style={styles.toastContent}>
            <Info size={18} color="#00D9FF" />
            <span style={styles.toastText}>{toastMessage}</span>
          </div>
          <button
            type="button"
            style={styles.toastCloseBtn}
            onClick={() => setToastMessage(null)}
          >
            <X size={14} color="#9DB4C8" />
          </button>
        </div>
      )}

      {/* Footer */}
      <Footer />
    </div>
  );
}

export default App;

const dialogStyles: Record<string, React.CSSProperties> = {
  body: { color: '#CBD8E3', fontSize: '.92rem', lineHeight: 1.55 },
  notice: { color: '#35F4FF', fontSize: '.84rem', lineHeight: 1.5, padding: 12, borderRadius: 8, border: '1px solid rgba(0,217,255,.25)', background: 'rgba(0,217,255,.06)' },
  error: { color: '#FF9A9A', fontSize: '.82rem' },
  caption: { color: '#9DB4C8', fontSize: '.76rem', lineHeight: 1.5 },
  accuracyWarning: { position: 'sticky', top: 0, zIndex: 100, padding: '9px 16px', background: 'rgba(70,48,8,.96)', borderBottom: '1px solid rgba(255,211,106,.45)', color: '#FFE3A3', fontSize: '.82rem', lineHeight: 1.45, textAlign: 'center' },
  locationStatus: { display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 10, padding: '7px 12px', background: 'rgba(8,22,39,.92)', borderBottom: '1px solid rgba(0,217,255,.18)', color: '#AFC4D5', fontSize: '.76rem', lineHeight: 1.4, textAlign: 'center' },
  locationRetry: { minHeight: 30, padding: '3px 9px', border: '1px solid rgba(53,244,255,.45)', borderRadius: 6, background: 'rgba(0,217,255,.08)', color: '#35F4FF', fontSize: '.72rem', cursor: 'pointer' },
  operatorList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10, padding: 12, margin: '14px 0', border: '1px solid rgba(0,217,255,.2)', borderRadius: 8 },
  operatorOption: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, color: '#F5FAFF', cursor: 'pointer' },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 18 },
  primary: { minHeight: 42, padding: '0 16px', border: '1px solid #35F4FF', borderRadius: 7, background: 'rgba(0,217,255,.12)', color: '#35F4FF', fontWeight: 700, cursor: 'pointer' },
  secondary: { minHeight: 42, padding: '0 16px', border: '1px solid rgba(157,180,200,.45)', borderRadius: 7, background: 'transparent', color: '#CBD8E3', cursor: 'pointer' }
};

const styles: Record<string, React.CSSProperties> = {
  appWrapper: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative'
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    width: '100%'
  },
  sectionContainer: {
    width: '100%',
    padding: '0 24px'
  },
  resultsGridSection: {
    width: '100%',
    maxWidth: '1400px',
    margin: '0 auto 36px',
    padding: '0 24px'
  },
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 1fr',
    gap: '24px',
    alignItems: 'stretch'
  },
  toastNotice: {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    maxWidth: '460px',
    padding: '14px 18px',
    borderRadius: '12px',
    border: '1px solid rgba(0, 217, 255, 0.4)',
    backgroundColor: 'rgba(8, 20, 38, 0.95)',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.8), 0 0 15px rgba(0, 217, 255, 0.2)',
    zIndex: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    animation: 'pulseGlow 3s infinite'
  },
  toastContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  toastText: {
    fontFamily: 'var(--font-sans)',
    fontSize: '0.82rem',
    color: '#F5FAFF',
    lineHeight: '1.4'
  },
  toastCloseBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
};
