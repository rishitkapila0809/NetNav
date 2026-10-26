/// <reference types="google.maps" />

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { AlertTriangle, Loader2, Crosshair, Compass } from 'lucide-react';
import type { LiveMeasurement, MeasurementSessionSummary } from '../types';
import { networkMeasurer } from '../services/networkMeasurer';
import { getLivePathSegments, groupExactLocations, historicalDetailHtml, historicalMarkerSpec } from '../services/historicalMeasurements';
import type { BestSpotCandidate } from '../services/bestSpot';
import type { RouteNetworkOverlay } from '../services/routeNetworkOverlay';
import type { RouteCoordinate, WalkingRouteOption } from '../services/walkingRoutes';
import type { RoutePickMode } from './RoutePlannerPanel';

export interface CampusMapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  liveMeasurements?: LiveMeasurement[];
  historicalMeasurements?: LiveMeasurement[];
  bestSpotCandidate?: BestSpotCandidate | null;
  sessionSummary?: MeasurementSessionSummary | null;
  isMeasuring?: boolean;
  onUserLocationChange?: (coords: { lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null; timestamp?: number }) => void;
  onLocationStatusChange?: (status: 'idle' | 'locating' | 'active' | 'denied' | 'error', message: string | null) => void;
  onLocationRetryReady?: (retry: () => void) => void;
  navigationActive?: boolean;
  routeOrigin?: RouteCoordinate | null;
  routeDestination?: RouteCoordinate | null;
  routePickMode?: RoutePickMode;
  onNavigationMapPick?: (point: RouteCoordinate) => void;
  onMapsReady?: (ready: boolean, error?: string) => void;
  walkingRoutes?: WalkingRouteOption[];
  selectedWalkingRouteIndex?: number;
  routeOverlay?: RouteNetworkOverlay | null;
  searchPosition?: RouteCoordinate | null;
  searchLabel?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

const VIT_VELLORE_CENTER = { lat: 12.9692, lng: 79.1559 };

const NETNAV_DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#081426' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#050b16' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9db4c8' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#00d9ff' }]
  },
  {
    featureType: 'poi',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#008fd1' }]
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#071d36' }]
  },
  {
    featureType: 'poi.park',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#00e676' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#0f2747' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#0066a6' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#0066a6' }]
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#00d9ff' }]
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#030810' }]
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#008fd1' }]
  }
];

// Generates SVG Icon with Directional Cone Beam rotated by heading angle
const createNavigationIcon = (heading: number | null) => {
  const angle = heading !== null && !isNaN(heading) ? heading : 0;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <g transform="rotate(${angle}, 32, 32)">
        <!-- Directional Beam Cone -->
        <path d="M 32,32 L 14,4 A 32,32 0 0,1 50,4 Z" fill="rgba(0, 217, 255, 0.38)" stroke="rgba(53, 244, 255, 0.75)" stroke-width="1.5"/>
        <!-- Pulse Outer Ring -->
        <circle cx="32" cy="32" r="14" fill="none" stroke="rgba(0, 217, 255, 0.6)" stroke-width="2"/>
        <!-- Core Dot -->
        <circle cx="32" cy="32" r="8.5" fill="#00D9FF" stroke="#FFFFFF" stroke-width="2.5"/>
        <!-- Heading Arrow -->
        <path d="M 32,25 L 36,34 L 32,32 L 28,34 Z" fill="#FFFFFF"/>
      </g>
    </svg>
  `;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(64, 64),
    anchor: new google.maps.Point(32, 32)
  };
};

export const CampusMap: React.FC<CampusMapProps> = ({
  center = VIT_VELLORE_CENTER,
  zoom = 16,
  liveMeasurements = [],
  historicalMeasurements = [],
  bestSpotCandidate = null,
  sessionSummary = null,
  isMeasuring: _isMeasuring = false,
  onUserLocationChange,
  onLocationStatusChange,
  onLocationRetryReady,
  navigationActive = false,
  routeOrigin = null,
  routeDestination = null,
  routePickMode = null,
  onNavigationMapPick,
  onMapsReady,
  walkingRoutes = [],
  selectedWalkingRouteIndex = 0,
  routeOverlay = null,
  searchPosition = null,
  searchLabel = null,
  className = '',
  style = {}
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const isMapInitializedRef = useRef<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Live Geolocation & Orientation State
  const [geoStatus, setGeoStatus] = useState<'idle' | 'locating' | 'active' | 'denied' | 'error'>('idle');
  const [geoErrorMessage, setGeoErrorMessage] = useState<string | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number; heading: number | null } | null>(null);

  const onUserLocationChangeRef = useRef(onUserLocationChange);
  const onLocationStatusChangeRef = useRef(onLocationStatusChange);
  useEffect(() => {
    onUserLocationChangeRef.current = onUserLocationChange;
    onLocationStatusChangeRef.current = onLocationStatusChange;
  });
  useEffect(() => { onLocationStatusChangeRef.current?.(geoStatus, geoErrorMessage); }, [geoStatus, geoErrorMessage]);
  const navigationActiveRef = useRef(navigationActive);
  const routePickModeRef = useRef(routePickMode);
  const onNavigationMapPickRef = useRef(onNavigationMapPick);
  const onMapsReadyRef = useRef(onMapsReady);
  useEffect(() => {
    navigationActiveRef.current = navigationActive;
    routePickModeRef.current = routePickMode;
    onNavigationMapPickRef.current = onNavigationMapPick;
    onMapsReadyRef.current = onMapsReady;
  });

  // Geolocation & Marker Refs
  const watchIdRef = useRef<number | null>(null);
  const startWatchRef = useRef<(() => void) | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const userCircleRef = useRef<google.maps.Circle | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const hasInitialCenteredRef = useRef<boolean>(false);

  // Headings priority refs
  const deviceHeadingRef = useRef<number | null>(null);
  const gpsHeadingRef = useRef<number | null>(null);
  const lastKnownHeadingRef = useRef<number>(0);

  // Route & Segment Polylines Refs
  const polylineSegmentsRef = useRef<google.maps.Polyline[]>([]);
  const historicalMarkersRef = useRef<google.maps.Marker[]>([]);
  const findBestMarkerRef = useRef<google.maps.Marker | null>(null);
  const walkingRouteLinesRef = useRef<google.maps.Polyline[]>([]);
  const networkOverlayLinesRef = useRef<google.maps.Polyline[]>([]);
  const routeEndpointMarkersRef = useRef<google.maps.Marker[]>([]);
  const searchLocationMarkerRef = useRef<google.maps.Marker | null>(null);

  // Best & Worst Spot Markers Refs
  const bestSpotMarkerRef = useRef<google.maps.Marker | null>(null);
  const worstSpotMarkerRef = useRef<google.maps.Marker | null>(null);

  // Compute effective heading (Priority: 1. GPS heading -> 2. Device Orientation -> 3. Last Known)
  const getEffectiveHeading = useCallback((): number => {
    if (gpsHeadingRef.current !== null && !isNaN(gpsHeadingRef.current)) {
      lastKnownHeadingRef.current = gpsHeadingRef.current;
      return gpsHeadingRef.current;
    }
    if (deviceHeadingRef.current !== null && !isNaN(deviceHeadingRef.current)) {
      lastKnownHeadingRef.current = deviceHeadingRef.current;
      return deviceHeadingRef.current;
    }
    return lastKnownHeadingRef.current;
  }, []);

  // Request Mobile Device Orientation Permission (iOS Safari)
  const requestOrientationPermission = async () => {
    if (typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function') {
      try {
        const response = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
        if (response === 'granted') {
          console.log('[NETNAV ORIENTATION] Permission granted');
        }
      } catch (err) {
        console.warn('Orientation permission error:', err);
      }
    }
  };

  // Device Orientation Event Listener
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      let headingDeg: number | null = null;
      if (typeof (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading === 'number') {
        headingDeg = (e as unknown as { webkitCompassHeading: number }).webkitCompassHeading;
      } else if (e.alpha !== null) {
        headingDeg = (360 - e.alpha) % 360;
      }

      if (headingDeg !== null && !isNaN(headingDeg)) {
        deviceHeadingRef.current = headingDeg;
        if (userMarkerRef.current) {
          userMarkerRef.current.setIcon(createNavigationIcon(getEffectiveHeading()));
        }
      }
    };

    window.addEventListener('deviceorientation', handleOrientation, true);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, [getEffectiveHeading]);

  // Center map on user location
  const centerOnUser = () => {
    if (userCoords && googleMapRef.current) {
      googleMapRef.current.panTo({ lat: userCoords.lat, lng: userCoords.lng });
      googleMapRef.current.setZoom(17);
    }
  };

  const retryLocation = async () => {
    if (!window.isSecureContext) {
      setGeoStatus('error');
      setGeoErrorMessage('Location requires a secure connection. Open this site using HTTPS or localhost.');
      return;
    }
    if (!navigator.geolocation) {
      setGeoStatus('error');
      setGeoErrorMessage('This browser does not support location access.');
      return;
    }
    try {
      const permissions = navigator.permissions;
      if (permissions?.query) {
        const permission = await permissions.query({ name: 'geolocation' });
        if (permission.state === 'denied') {
          setGeoStatus('denied');
          setGeoErrorMessage('Location is blocked. Enable location for this site in your browser or device settings, then reload the page.');
          return;
        }
      }
      setGeoStatus('locating');
      setGeoErrorMessage(null);
      if (watchIdRef.current === null) startWatchRef.current?.();
      else setGeoErrorMessage('Waiting for a fresh GPS fix from the active location watcher…');
    } catch {
      // Permissions API is optional; the Geolocation API remains the fallback.
      setGeoStatus('locating');
      setGeoErrorMessage(null);
      if (watchIdRef.current === null) startWatchRef.current?.();
    }
  };

  const retryLocationRef = useRef(retryLocation);
  retryLocationRef.current = retryLocation;
  useEffect(() => {
    const retry = () => { void retryLocationRef.current(); };
    onLocationRetryReady?.(retry);
    return () => onLocationRetryReady?.(() => undefined);
  }, [onLocationRetryReady]);

  // 1. Single Google Maps Instance Initialization
  useEffect(() => {
    if (isMapInitializedRef.current) return;

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError('VITE_GOOGLE_MAPS_API_KEY environment variable is missing.');
      setLoading(false);
      onMapsReadyRef.current?.(false, 'Google Maps API key configuration is missing.');
      return;
    }

    setOptions({
      key: apiKey,
      v: 'weekly'
    });

    importLibrary('maps')
      .then(({ Map }) => {
        if (!mapRef.current || isMapInitializedRef.current) return;

        const mapInstance = new Map(mapRef.current, {
          center,
          zoom,
          styles: NETNAV_DARK_MAP_STYLES,
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          gestureHandling: 'greedy'
        });

        googleMapRef.current = mapInstance;
        isMapInitializedRef.current = true;
        setLoading(false);
        onMapsReadyRef.current?.(true);

        // Start the one persistent GPS watcher as soon as the map is ready.
        // A LAN HTTP origin is not a secure context on most mobile browsers.
        if (!window.isSecureContext) {
          setGeoStatus('error');
          setGeoErrorMessage('Location requires HTTPS or localhost. This HTTP LAN address is not a secure context on most mobile browsers.');
          return;
        }
        if (!navigator.geolocation) {
          setGeoStatus('error');
          setGeoErrorMessage('Geolocation is not supported by this browser.');
          return;
        }

        const startWatching = () => {
          if (watchIdRef.current !== null) return;
          setGeoStatus('locating');
          setGeoErrorMessage(null);
          watchIdRef.current = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude, accuracy, heading, speed } = position.coords;

            // GPS Outlier Filter: Ignore invalid coordinates with extreme inaccuracy (> 150m)
            if (accuracy > 150) {
              console.warn('[NETNAV GPS FILTERED OUTLIER]', accuracy, latitude, longitude);
              setGeoStatus('error');
              setGeoErrorMessage(`GPS accuracy is currently ±${Math.round(accuracy)} m. Waiting for a more accurate fix.`);
              return;
            }

            console.log('[NETNAV GPS]', latitude, longitude, accuracy, 'Heading:', heading, 'Speed:', speed);

            if (heading !== null && !isNaN(heading)) {
              gpsHeadingRef.current = heading;
            }

            const effectiveHeading = getEffectiveHeading();
            const newPos = { lat: latitude, lng: longitude };

            setUserCoords({ lat: latitude, lng: longitude, accuracy, heading: effectiveHeading });
            setGeoStatus('active');

            if (onUserLocationChangeRef.current) {
              onUserLocationChangeRef.current({
                lat: latitude,
                lng: longitude,
                accuracy,
                speed: speed ?? null,
                heading: effectiveHeading,
                timestamp: Number.isFinite(position.timestamp) && position.timestamp > 0 ? position.timestamp : Date.now()
              });
            }

            const map = googleMapRef.current;
            if (!map) return;

            // Create or Update Directional Navigation Marker
            if (!userMarkerRef.current) {
              const marker = new google.maps.Marker({
                position: newPos,
                map,
                title: 'You are here',
                icon: createNavigationIcon(effectiveHeading),
                zIndex: 2000 // Always top layer
              });

              const infoWindow = new google.maps.InfoWindow({
                content: `
                  <div style="color: #050B16; font-family: system-ui, sans-serif; padding: 4px; font-weight: 700; font-size: 12px;">
                    📍 YOU ARE HERE
                    <div style="font-size: 10px; font-weight: 500; color: #555; margin-top: 3px; font-family: monospace;">
                      Lat: ${latitude.toFixed(5)}<br/>
                      Lng: ${longitude.toFixed(5)}<br/>
                      GPS Accuracy: ±${Math.round(accuracy)}m
                    </div>
                  </div>
                `
              });
              infoWindowRef.current = infoWindow;

              marker.addListener('click', () => {
                infoWindow.open(map, marker);
              });

              userMarkerRef.current = marker;
            } else {
              userMarkerRef.current.setPosition(newPos);
              userMarkerRef.current.setIcon(createNavigationIcon(effectiveHeading));
              if (infoWindowRef.current) {
                infoWindowRef.current.setContent(`
                  <div style="color: #050B16; font-family: system-ui, sans-serif; padding: 4px; font-weight: 700; font-size: 12px;">
                    📍 YOU ARE HERE
                    <div style="font-size: 10px; font-weight: 500; color: #555; margin-top: 3px; font-family: monospace;">
                      Lat: ${latitude.toFixed(5)}<br/>
                      Lng: ${longitude.toFixed(5)}<br/>
                      GPS Accuracy: ±${Math.round(accuracy)}m
                    </div>
                  </div>
                `);
              }
            }

            // Accuracy Circle
            if (!userCircleRef.current) {
              userCircleRef.current = new google.maps.Circle({
                map,
                center: newPos,
                radius: accuracy,
                fillColor: '#00D9FF',
                fillOpacity: 0.12,
                strokeColor: '#35F4FF',
                strokeOpacity: 0.4,
                strokeWeight: 1.5,
                clickable: false,
                zIndex: 100
              });
            } else {
              userCircleRef.current.setCenter(newPos);
              userCircleRef.current.setRadius(accuracy);
            }

            // Center map once upon first GPS fix
            if (!hasInitialCenteredRef.current) {
              map.panTo(newPos);
              map.setZoom(17);
              hasInitialCenteredRef.current = true;
            }
          },
          (err) => {
            console.warn('Geolocation error:', err);
            if (err.code === err.PERMISSION_DENIED) {
              if (watchIdRef.current !== null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
              }
              setGeoStatus('denied');
              setGeoErrorMessage('Location is blocked. Enable location for this site in your browser or device settings. The browser may not show another prompt until you change this setting.');
            } else if (err.code === err.POSITION_UNAVAILABLE) {
              setGeoStatus('error');
              setGeoErrorMessage('Your location is unavailable. Check device location services and try again.');
            } else if (err.code === err.TIMEOUT) {
              setGeoStatus('error');
              setGeoErrorMessage('Location request timed out. Retry when you have a clearer GPS signal.');
            } else {
              setGeoStatus('error');
              setGeoErrorMessage(err.message || 'The browser could not retrieve your location.');
            }
          },
          {
            enableHighAccuracy: true,
            timeout: 3000,
            maximumAge: 0
          }
          );
        };
        startWatchRef.current = startWatching;

        const requestLocation = async () => {
          if (navigator.permissions?.query) {
            try {
              const permission = await navigator.permissions.query({ name: 'geolocation' });
              if (permission.state === 'denied') {
                setGeoStatus('denied');
                setGeoErrorMessage('Location is blocked. Enable location for this site in your browser or device settings.');
                return;
              }
              // Both granted and prompt states use the same single watcher.
            } catch {
              // Safari and some embedded browsers do not implement this query.
            }
          }
          startWatching();
        };
        void requestLocation();
      })
      .catch((err: unknown) => {
        console.error('Error loading Google Maps API:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        setError(`Failed to load Google Maps API: ${errMsg}`);
        setLoading(false);
        onMapsReadyRef.current?.(false, 'Google Maps failed to load. Check its API configuration and retry.');
      });
  }, [center, zoom, getEffectiveHeading]);

  useEffect(() => {
    const map = googleMapRef.current;
    if (!map) return;
    const listener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (!navigationActiveRef.current || !routePickModeRef.current || !event.latLng) return;
      onNavigationMapPickRef.current?.({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    });
    return () => google.maps.event.removeListener(listener);
  }, [loading]);

  // Walking routes and their data overlay are rendered in refs independent from live-session paths.
  useEffect(() => {
    const map = googleMapRef.current;
    walkingRouteLinesRef.current.forEach((line) => line.setMap(null));
    networkOverlayLinesRef.current.forEach((line) => line.setMap(null));
    routeEndpointMarkersRef.current.forEach((marker) => marker.setMap(null));
    walkingRouteLinesRef.current = [];
    networkOverlayLinesRef.current = [];
    routeEndpointMarkersRef.current = [];
    if (!map || loading) return;

    walkingRoutes.forEach((route, index) => {
      const selected = index === selectedWalkingRouteIndex;
      if (selected) {
        walkingRouteLinesRef.current.push(new google.maps.Polyline({ map, path: route.path, geodesic: true,
          strokeColor: '#FFFFFF', strokeOpacity: 0.92, strokeWeight: 10, zIndex: 20 }));
      }
      walkingRouteLinesRef.current.push(new google.maps.Polyline({ map, path: route.path, geodesic: true,
        strokeColor: selected ? '#00AEEF' : '#93A5B5', strokeOpacity: selected ? 0.96 : 0.42,
        strokeWeight: selected ? 6 : 4, zIndex: selected ? 21 : 10 }));
    });
    const chosenPath = walkingRoutes[selectedWalkingRouteIndex]?.path;
    if (chosenPath?.length) {
      const bounds = new google.maps.LatLngBounds();
      chosenPath.forEach((point) => bounds.extend(point));
      map.fitBounds(bounds, 56);
    }

    if (routeOverlay && walkingRoutes[selectedWalkingRouteIndex]) {
      for (const bin of routeOverlay.bins) {
        const colors = { good: '#00E676', moderate: '#FFB300', poor: '#FF1744', unknown: '#78899A' } as const;
        const unknown = bin.classification === 'unknown';
        networkOverlayLinesRef.current.push(new google.maps.Polyline({ map, path: [bin.start, bin.end], geodesic: true,
          strokeColor: colors[bin.classification], strokeOpacity: unknown ? 0 : 1, strokeWeight: 5, zIndex: 30,
          ...(unknown ? { icons: [{ icon: { path: 'M 0,-1 0,1', strokeColor: colors.unknown, strokeOpacity: 1, scale: 2 }, offset: '0', repeat: '10px' }] } : {}) }));
      }
    }

    for (const [position, label, color] of [[routeOrigin, 'ORIGIN', '#00D9FF'], [routeDestination, 'DEST', '#FFB300']] as const) {
      if (!navigationActive || !position) continue;
      routeEndpointMarkersRef.current.push(new google.maps.Marker({ map, position, title: `${label}: ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`,
        icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 2, scale: 8 },
        label: { text: label, color: '#FFFFFF', fontWeight: '700', fontSize: '9px' }, zIndex: 1500 }));
    }
  }, [walkingRoutes, selectedWalkingRouteIndex, routeOverlay, routeOrigin, routeDestination, navigationActive, loading]);

  useEffect(() => {
    const map = googleMapRef.current;
    searchLocationMarkerRef.current?.setMap(null);
    searchLocationMarkerRef.current = null;
    if (!map || loading || !searchPosition) return;
    map.panTo(searchPosition);
    map.setZoom(18);
    searchLocationMarkerRef.current = new google.maps.Marker({ map, position: searchPosition, title: searchLabel || 'Searched map location', zIndex: 1800,
      icon: { path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, fillColor: '#B388FF', fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 1.5, scale: 7 } });
  }, [searchPosition, searchLabel, loading]);

  // Historical records are independent pins. Exact coordinate duplicates share a count pin,
  // and the click details retain every database record in that group.
  useEffect(() => {
    const map = googleMapRef.current;
    if (!map || loading) return;
    historicalMarkersRef.current.forEach((marker) => marker.setMap(null));
    historicalMarkersRef.current = [];
    const groups = groupExactLocations(historicalMeasurements);
    for (const group of groups) {
      const row = group[0];
      const spec = historicalMarkerSpec(group);
      const marker = new google.maps.Marker({
        map,
        position: spec.position,
        title: `${row.operator} · NQS ${spec.nqs ?? 'N/A'} · ${group.length} saved sample${group.length === 1 ? '' : 's'}`,
        icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: spec.color, fillOpacity: 0.95, strokeColor: '#FFFFFF', strokeWeight: 1.5, scale: group.length > 1 ? 9 : 7 },
        label: { text: spec.nqs === null ? 'N/A' : String(spec.nqs), color: spec.nqs === null ? '#FFFFFF' : '#07111D', fontWeight: '700', fontSize: '9px' },
        zIndex: 500 + (spec.nqs ?? 0)
      });
      const info = new google.maps.InfoWindow({ content: historicalDetailHtml(group) });
      marker.addListener('click', () => info.open({ map, anchor: marker }));
      historicalMarkersRef.current.push(marker);
    }
  }, [historicalMeasurements, loading]);

  useEffect(() => {
    const map = googleMapRef.current;
    findBestMarkerRef.current?.setMap(null);
    findBestMarkerRef.current = null;
    if (!map || loading || !bestSpotCandidate) return;
    findBestMarkerRef.current = new google.maps.Marker({
      map,
      position: { lat: bestSpotCandidate.latitude, lng: bestSpotCandidate.longitude },
      title: `Selected ${bestSpotCandidate.operator} best spot · NQS ${bestSpotCandidate.nqs} · ${bestSpotCandidate.sampleCount} samples`,
      icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: '#00D9FF', fillOpacity: 0.4, strokeColor: '#FFFFFF', strokeWeight: 3, scale: 17 },
      label: { text: 'BEST', color: '#FFFFFF', fontWeight: '900', fontSize: '10px' },
      zIndex: 2000
    });
  }, [bestSpotCandidate, loading]);

  // Only draw ordered, geographically continuous current-session samples. History is never passed here.
  useEffect(() => {
    const map = googleMapRef.current;
    if (!map || loading) return;
    polylineSegmentsRef.current.forEach((segment) => segment.setMap(null));
    polylineSegmentsRef.current = [];
    for (const [previous, current] of getLivePathSegments(liveMeasurements)) {
      polylineSegmentsRef.current.push(new google.maps.Polyline({
        map,
        path: [{ lat: previous.latitude, lng: previous.longitude }, { lat: current.latitude, lng: current.longitude }],
        geodesic: true,
        strokeColor: networkMeasurer.getNqsColor(current.nqs, current.status),
        strokeOpacity: 0.9,
        strokeWeight: 5
      }));
    }
  }, [liveMeasurements, loading]);

  // 3. Highlight BEST & WORST Spots when session is completed
  useEffect(() => {
    const map = googleMapRef.current;
    if (!map || loading || !sessionSummary) return;

    // BEST Spot Marker
    if (sessionSummary.bestSpot) {
      const best = sessionSummary.bestSpot;
      const bestColor = networkMeasurer.getNqsColor(best.nqs, best.status);

      if (!bestSpotMarkerRef.current) {
        bestSpotMarkerRef.current = new google.maps.Marker({
          position: { lat: best.latitude, lng: best.longitude },
          map,
          title: `BEST SPOT: NQS ${best.nqs} (${best.status})`,
          icon: {
            path: 'M 0,0 m -16,0 a 16,16 0 1,0 32,0 a 16,16 0 1,0 -32,0',
            fillColor: '#00E676',
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 3,
            scale: 1,
            labelOrigin: new google.maps.Point(0, 0)
          },
          label: {
            text: 'BEST',
            color: '#050B16',
            fontWeight: '900',
            fontSize: '10px',
            fontFamily: 'monospace'
          },
          zIndex: 1500
        });

        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="color: #050B16; font-family: system-ui, sans-serif; padding: 6px;">
              <div style="font-weight: 900; font-size: 14px; color: ${bestColor};">
                🏆 BEST NETWORK SPOT: NQS ${best.nqs}
              </div>
              <div style="font-size: 11px; font-family: monospace; color: #333; margin-top: 4px;">
                Status: ${best.status}<br/>
                Latency: ${best.latencyMs} ms | Throughput: ${best.downloadMbps} Mbps<br/>
                GPS: ${best.latitude.toFixed(5)}°, ${best.longitude.toFixed(5)}°
              </div>
            </div>
          `
        });

        bestSpotMarkerRef.current.addListener('click', () => infoWindow.open(map, bestSpotMarkerRef.current));
      }
    }

    // WORST Spot Marker
    if (sessionSummary.worstSpot) {
      const worst = sessionSummary.worstSpot;
      const worstColor = networkMeasurer.getNqsColor(worst.nqs, worst.status);

      if (!worstSpotMarkerRef.current) {
        worstSpotMarkerRef.current = new google.maps.Marker({
          position: { lat: worst.latitude, lng: worst.longitude },
          map,
          title: `WORST SPOT: NQS ${worst.nqs} (${worst.status})`,
          icon: {
            path: 'M 0,0 m -16,0 a 16,16 0 1,0 32,0 a 16,16 0 1,0 -32,0',
            fillColor: '#FF1744',
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 3,
            scale: 1,
            labelOrigin: new google.maps.Point(0, 0)
          },
          label: {
            text: 'WORST',
            color: '#FFFFFF',
            fontWeight: '900',
            fontSize: '9px',
            fontFamily: 'monospace'
          },
          zIndex: 1400
        });

        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="color: #050B16; font-family: system-ui, sans-serif; padding: 6px;">
              <div style="font-weight: 900; font-size: 14px; color: ${worstColor};">
                ⚠️ WORST NETWORK SPOT: NQS ${worst.nqs}
              </div>
              <div style="font-size: 11px; font-family: monospace; color: #333; margin-top: 4px;">
                Status: ${worst.status}<br/>
                Latency: ${worst.latencyMs} ms | Throughput: ${worst.downloadMbps} Mbps<br/>
                GPS: ${worst.latitude.toFixed(5)}°, ${worst.longitude.toFixed(5)}°
              </div>
            </div>
          `
        });

        worstSpotMarkerRef.current.addListener('click', () => infoWindow.open(map, worstSpotMarkerRef.current));
      }
    }
  }, [sessionSummary, loading]);

  // Clean up Geolocation Watch & Map Overlays ONLY on Component Unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
      }
      if (userCircleRef.current) {
        userCircleRef.current.setMap(null);
        userCircleRef.current = null;
      }
      polylineSegmentsRef.current.forEach((p) => p.setMap(null));
      polylineSegmentsRef.current = [];
      historicalMarkersRef.current.forEach((marker) => marker.setMap(null));
      historicalMarkersRef.current = [];
      findBestMarkerRef.current?.setMap(null);
      findBestMarkerRef.current = null;
      walkingRouteLinesRef.current.forEach((line) => line.setMap(null));
      networkOverlayLinesRef.current.forEach((line) => line.setMap(null));
      routeEndpointMarkersRef.current.forEach((marker) => marker.setMap(null));
      searchLocationMarkerRef.current?.setMap(null);
      searchLocationMarkerRef.current = null;
      if (bestSpotMarkerRef.current) {
        bestSpotMarkerRef.current.setMap(null);
      }
      if (worstSpotMarkerRef.current) {
        worstSpotMarkerRef.current.setMap(null);
      }
      isMapInitializedRef.current = false;
    };
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '480px',
        backgroundColor: '#050B16',
        borderRadius: '0px',
        overflow: 'hidden',
        ...style
      }}
      className={className}
      onClick={requestOrientationPermission}
    >
      {/* Map Container Element */}
      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          inset: 0
        }}
      />

      {/* Live Geolocation Status & GPS Accuracy Indicator Overlay */}
      {!loading && !error && (
        <div style={styles.geoStatusPill} className="map-gps-pill">
          {geoStatus === 'active' && (
            <>
              <span style={{ ...styles.pulseDot, backgroundColor: '#00E676', boxShadow: '0 0 8px #00E676' }} />
              <span style={{ color: '#F5FAFF' }}>
                LIVE GPS ACTIVE
                {userCoords && (
                  <span style={styles.coordsText}>
                    GPS ±{Math.round(userCoords.accuracy)}m ({userCoords.lat.toFixed(4)}°, {userCoords.lng.toFixed(4)}°)
                  </span>
                )}
              </span>
            </>
          )}

          {geoStatus === 'locating' && (
            <>
              <Loader2 size={12} color="#00D9FF" style={{ animation: 'radarScan 1.5s linear infinite' }} />
              <span style={{ color: '#00D9FF' }}>LOCATING MOBILE GPS...</span>
            </>
          )}

          {(geoStatus === 'denied' || geoStatus === 'error') && (
            <>
              <span style={{ ...styles.pulseDot, backgroundColor: '#FF1744' }} />
              <span style={{ color: '#FF1744' }}>{geoErrorMessage || 'GPS UNAVAILABLE'}</span>
              {geoStatus === 'error' && window.isSecureContext && (
                <button type="button" style={styles.retryBtn} onClick={retryLocation}>RETRY LOCATION</button>
              )}
            </>
          )}
        </div>
      )}

      {/* Live Plotted Measurements Counter Tag */}
      {liveMeasurements.length > 0 && (
        <div style={styles.measCounterTag} className="map-counter-pill">
          <span style={styles.measCounterNum}>{liveMeasurements.length}</span>
          <span>SAMPLES RECORDED</span>
        </div>
      )}

      {/* Heading Angle Indicator Tag */}
      {userCoords && userCoords.heading !== null && (
        <div style={styles.headingPill} className="map-heading-pill">
          <Compass size={13} color="#00D9FF" />
          <span>HEADING: {Math.round(userCoords.heading)}°</span>
        </div>
      )}

      {/* "Locate Me / Center GPS" Map Button */}
      {!loading && !error && (
        <button
          type="button"
          style={styles.locateBtn}
          className="map-locate-button"
          title="Center on My Location"
          onClick={centerOnUser}
        >
          <Crosshair size={18} color="#00D9FF" />
          <span style={styles.locateBtnText}>MY LOCATION</span>
        </button>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div style={styles.stateOverlay}>
          <Loader2 size={32} color="#00D9FF" style={{ animation: 'radarScan 1.5s linear infinite' }} />
          <span style={styles.stateText}>INITIALIZING GOOGLE MAPS TEL-ENGINE...</span>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div style={{ ...styles.stateOverlay, backgroundColor: 'rgba(5, 11, 22, 0.95)' }}>
          <AlertTriangle size={32} color="#FF1744" />
          <span style={{ ...styles.stateText, color: '#FF1744' }}>{error}</span>
          <span style={styles.subErrorText}>Please check VITE_GOOGLE_MAPS_API_KEY configuration.</span>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  stateOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(5, 11, 22, 0.85)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    zIndex: 10
  },
  stateText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85rem',
    fontWeight: 700,
    color: '#00D9FF',
    letterSpacing: '0.06em'
  },
  subErrorText: {
    fontFamily: 'var(--font-sans)',
    fontSize: '0.75rem',
    color: '#9DB4C8'
  },
  geoStatusPill: {
    position: 'absolute',
    top: '14px',
    left: '14px',
    backgroundColor: 'rgba(8, 20, 38, 0.88)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(0, 217, 255, 0.25)',
    borderRadius: '8px',
    padding: '6px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    fontWeight: 600,
    zIndex: 5,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)'
  },
  measCounterTag: {
    position: 'absolute',
    top: '14px',
    right: '60px',
    backgroundColor: 'rgba(11, 26, 45, 0.9)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(0, 230, 118, 0.3)',
    borderRadius: '8px',
    padding: '6px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    fontWeight: 700,
    color: '#00E676',
    zIndex: 5,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)'
  },
  measCounterNum: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    padding: '1px 6px',
    borderRadius: '4px'
  },
  headingPill: {
    position: 'absolute',
    top: '52px',
    left: '14px',
    backgroundColor: 'rgba(8, 20, 38, 0.85)',
    border: '1px solid rgba(0, 217, 255, 0.2)',
    borderRadius: '6px',
    padding: '4px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.68rem',
    color: '#00D9FF',
    zIndex: 5
  },
  pulseDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    display: 'inline-block'
  },
  coordsText: {
    color: '#9DB4C8',
    marginLeft: '6px',
    fontSize: '0.68rem',
    fontWeight: 400
  },
  locateBtn: {
    position: 'absolute',
    bottom: '24px',
    left: '14px',
    backgroundColor: 'rgba(8, 20, 38, 0.9)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(0, 217, 255, 0.35)',
    borderRadius: '8px',
    padding: '8px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    color: '#F5FAFF',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    fontWeight: 700,
    zIndex: 5,
    boxShadow: '0 4px 18px rgba(0, 0, 0, 0.7)',
    transition: 'all 0.2s ease'
  },
  locateBtnText: {
    letterSpacing: '0.05em',
    color: '#00D9FF'
  },
  retryBtn: {
    marginLeft: '6px',
    padding: '3px 7px',
    minHeight: '30px',
    border: '1px solid rgba(0, 217, 255, 0.4)',
    borderRadius: '5px',
    background: 'rgba(0, 217, 255, 0.08)',
    color: '#00D9FF',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.62rem',
    cursor: 'pointer',
    flexShrink: 0
  }
};
