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
import { networkMeasurer } from './services/networkMeasurer';
import { loadMeasurements, loadLatestMeasurementForOperator, saveMeasurement } from './services/measurementApi';
import { loadAllMeasurementsForOperator } from './services/measurementApi';
import { Info, X } from 'lucide-react';
import type { HistoryStatus, OperatorFilter } from './services/historicalMeasurements';
import { findBestSpot, type BestSpotResult } from './services/bestSpot';
import { importLibrary } from '@googlemaps/js-api-loader';
import { requestWalkingRoutesWith, type WalkingRouteOption, type RouteCoordinate, type ComputeRoutes } from './services/walkingRoutes';
import { isValidCurrentRouteOrigin } from './services/walkingRoutes';
import { buildRouteNetworkOverlay, type RouteNetworkOverlay } from './services/routeNetworkOverlay';
import { calculateRouteRankings } from './services/routeRanking';
import { advanceOffRouteFixCount, calculateRouteProgress, canRequestReroute, endNavigationSession, isGpsJump, startNavigationSession, validateNavigationFix, type NavigationGpsFix, type RouteProgress } from './services/liveNavigation';
import { findNearbyMeasurements, type MapSearchResult } from './services/mapLocationSearch';
import { selectTelemetryMeasurement } from './services/measurementTelemetry';
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
  const [findBestSpotState, setFindBestSpotState] = useState<BestSpotResult | { status: 'idle' | 'history-loading' | 'history-error' }>({ status: 'idle' });
  const [navigationActive, setNavigationActive] = useState(false);
  const [liveNavigationActive, setLiveNavigationActive] = useState(false);
  const [navigationProgress, setNavigationProgress] = useState<RouteProgress | null>(null);
  const [navigationGpsMessage, setNavigationGpsMessage] = useState('');
  const [navigationOffRoute, setNavigationOffRoute] = useState(false);
  const [locationStatus, setLocationStatus] = useState<{ status: 'idle' | 'locating' | 'active' | 'denied' | 'error'; message: string | null }>({ status: 'idle', message: null });
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
  const measurementTimerRef = useRef<number | null>(null);
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

  useEffect(() => {
    selectedOperatorRef.current = selectedOperator;
  }, [selectedOperator]);

  useEffect(() => {
    if (findBestSpotState.status === 'success' && findBestSpotState.candidate.operator !== selectedOperator) {
      setFindBestSpotState({ status: 'idle' });
    }
  }, [findBestSpotState, selectedOperator]);

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
    if (!navigationActive) return;
    const timer = window.setInterval(() => setGpsFreshnessClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [navigationActive]);

  const currentGpsReady = isValidCurrentRouteOrigin(gpsFix, gpsFreshnessClock);
  const currentGpsMessage = !gpsFix ? 'No GPS fix has been reported.' : !isValidCurrentRouteOrigin(gpsFix)
    ? gpsFix.accuracy > 50 ? 'GPS accuracy must be 50 metres or better.' : 'No fresh GPS fix. Location permission may be denied; use map points or enable location access.'
    : 'Use the current GPS location as origin.';
  const navigationDisplayMessage = !liveNavigationActive ? (() => {
    if (locationStatus.status === 'denied' || locationStatus.status === 'error') return locationStatus.message ?? 'Location is unavailable.';
    if (locationStatus.status === 'locating' || locationStatus.status === 'idle') return 'Waiting for GPS location.';
    const gpsStatus = validateNavigationFix(gpsFix, gpsFreshnessClock);
    return gpsStatus === 'ready' ? `GPS available · accuracy ±${Math.round(gpsFix!.accuracy)} m.` : gpsStatus === 'inaccurate' ? `GPS accuracy ±${Math.round(gpsFix!.accuracy)} m is not precise enough.` : 'GPS location is stale. Waiting for a fresh fix.';
  })() : (() => {
    const gpsStatus = validateNavigationFix(gpsFix, gpsFreshnessClock);
    if (gpsStatus === 'ready') return navigationGpsMessage || `GPS active · accuracy ±${Math.round(gpsFix!.accuracy)} m.`;
    if (gpsStatus === 'inaccurate') return `GPS accuracy ±${Math.round(gpsFix!.accuracy)} m is too wide for navigation progress.`;
    if (locationStatus.status === 'denied' || locationStatus.status === 'error') return locationStatus.message ?? 'Location is unavailable. Check browser location settings.';
    return gpsStatus === 'missing' ? 'Waiting for a GPS fix. Allow location access in browser settings.' : 'GPS location is stale. Waiting for a fresh fix.';
  })();

  const handleLocationStatusChange = useCallback((status: 'idle' | 'locating' | 'active' | 'denied' | 'error', message: string | null) => {
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
  const handleStartMeasuring = () => {
    if (isMeasuring) return;
    const gps = userGpsRef.current;
    if (!gps || Date.now() - gps.timestamp > 30_000) {
      showToast('Waiting for a current GPS fix. Allow location access or use the map’s retry control before measuring.');
      return;
    }

    // Cancel any previous timers and abort pending requests
    if (measurementTimerRef.current !== null) {
      clearTimeout(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    if (abortControllerRef.current !== null) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Begin fresh measurement session
    isMeasuringRef.current = true;
    setIsMeasuring(true);
    setLiveMeasurements([]);
    setCurrentMeasurement(null);
    setSessionSummary(null);

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

    // Sequential async measurement loop (prevents overlapping requests)
    const executeStep = async () => {
      if (!isMeasuringRef.current || controller.signal.aborted) return;

      try {
        const currentGps = userGpsRef.current;
        if (!currentGps || Date.now() - currentGps.timestamp > 30_000) {
          showToast('GPS fix expired. Measurement paused until a fresh location is available.');
          handleStopMeasuring();
          return;
        }
        const { lat, lng, accuracy, speed, heading } = currentGps;

        const sample = await networkMeasurer.measureSample(
          lat,
          lng,
          accuracy,
          selectedOperatorRef.current,
          heading,
          speed,
          controller.signal
        );

        // Discard sample if user clicked Stop while awaiting measurement
        if (!isMeasuringRef.current || controller.signal.aborted) {
          return;
        }

        setCurrentMeasurement(sample);
        setLiveMeasurements((prev) => [...prev, sample]);
        if (!sample.isOffline) {
          try {
            await saveMeasurement(sample);
            routeHistoryCacheRef.current.delete(sample.operator);
            storageIssueShownRef.current = false;
          } catch (error) {
            console.warn('[NETNAV STORAGE] Sample was measured, but saving it to history failed. Network measurement remains valid:', error);
            if (!storageIssueShownRef.current) {
              showToast('Measurement collected, but saving to Neon failed. See the console and local API server output for details.');
              storageIssueShownRef.current = true;
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return; // Normal session cancellation
        }
        console.warn('[NETNAV] Measurement error:', err);
      }

      // Schedule next tick only if still measuring and not aborted
      if (isMeasuringRef.current && !controller.signal.aborted) {
        measurementTimerRef.current = window.setTimeout(executeStep, 1000);
      }
    };

    // Execute first sample
    executeStep();
  };

  // Stop Live Measurement Session
  const handleStopMeasuring = () => {
    if (!isMeasuringRef.current) return;

    isMeasuringRef.current = false;
    setIsMeasuring(false);

    // Cancel scheduled timer
    if (measurementTimerRef.current !== null) {
      clearTimeout(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }

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
        const validSamples = all.filter((m) => m.status !== 'NO_CONNECTIVITY' && !m.isOffline);

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
      if (measurementTimerRef.current !== null) {
        clearTimeout(measurementTimerRef.current);
      }
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

  const runBestSpotSearch = (records = historicalMeasurements) => {
    if (historyStatus === 'loading') {
      setFindBestSpotState({ status: 'history-loading' });
      return;
    }
    if (historyStatus === 'error') {
      setFindBestSpotState({ status: 'history-error' });
      return;
    }
    setFindBestSpotState(findBestSpot(records, selectedOperator, userGpsRef.current));
  };

  const handleFindBestSpot = () => {
    runBestSpotSearch();
    const element = document.getElementById('results-section');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
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

      {/* Main Content Layout */}
      <main style={styles.mainContent} className="main-content">
        {/* HERO AREA: Primary Feature (FIND BEST SPOT) */}
        <HeroSection
          selectedOperator={selectedOperator}
          onSelectOperator={(op) => {
            setSelectedOperator(op);
            showToast(`Selected Network Operator changed to ${op}.`);
          }}
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
            sessionSummary={sessionSummary}
            onUserLocationChange={handleUserLocationChange}
          />
        </section>

        {/* LIVE MEASUREMENT PROTOTYPE CARD SECTION */}
        <section id="live-measurement-section" style={styles.resultsGridSection}>
          <LiveMeasurementCard
            isMeasuring={isMeasuring}
            currentMeasurement={currentMeasurement}
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
              onRetrySearch={() => runBestSpotSearch()}
              onRetryLocation={() => locationRetryRef.current()}
              onRetryHistory={async () => {
                setFindBestSpotState({ status: 'history-loading' });
                const rows = await refreshHistoricalMeasurements();
                if (rows) setFindBestSpotState(findBestSpot(rows, selectedOperator, userGpsRef.current));
                else setFindBestSpotState({ status: 'history-error' });
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
