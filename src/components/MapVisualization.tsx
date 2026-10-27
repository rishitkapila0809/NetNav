import React from 'react';
import type { LiveMeasurement, TelecomOperator, MeasurementSessionSummary } from '../types';
import { CampusMap } from './CampusMap';
import { Layers } from 'lucide-react';
import { filterHistoricalMeasurements, type HistoryStatus, type OperatorFilter } from '../services/historicalMeasurements';
import type { BestSpotCandidate } from '../services/bestSpot';
import { RoutePlannerPanel, type RoutePickMode } from './RoutePlannerPanel';
import type { RouteNetworkOverlay } from '../services/routeNetworkOverlay';
import type { RouteCoordinate, WalkingRouteOption } from '../services/walkingRoutes';
import type { RankedWalkingRoute } from '../services/routeRanking';
import { MapLocationSearch } from './MapLocationSearch';
import type { MapSearchResult } from '../services/mapLocationSearch';
import type { LocationTrackerStatus } from '../services/locationTracker';

interface MapVisualizationProps {
  selectedOperator: TelecomOperator;
  liveMeasurements?: LiveMeasurement[];
  historicalMeasurements?: LiveMeasurement[];
  historyOperator?: OperatorFilter;
  onHistoryOperatorChange?: (operator: OperatorFilter) => void;
  historyStatus?: HistoryStatus;
  historyError?: string | null;
  onRetryHistory?: () => void;
  bestSpotCandidate?: BestSpotCandidate | null;
  onLocationRetryReady?: (retry: () => void) => void;
  navigationActive?: boolean;
  onCloseNavigation?: () => void;
  routeOrigin?: RouteCoordinate | null;
  routeDestination?: RouteCoordinate | null;
  routePickMode?: RoutePickMode;
  onPickRouteEndpoint?: (point: RouteCoordinate) => void;
  onMapsReady?: (ready: boolean, error?: string) => void;
  walkingRoutes?: WalkingRouteOption[];
  routeRankings?: RankedWalkingRoute[];
  selectedWalkingRouteIndex?: number;
  onSelectWalkingRoute?: (index: number) => void;
  routeState?: 'idle' | 'loading' | 'ready' | 'error';
  routeError?: string | null;
  onRequestWalkingRoutes?: () => void;
  onRetryWalkingRoutes?: () => void;
  currentGpsReady?: boolean;
  currentGpsMessage?: string;
  onUseGpsOrigin?: () => void;
  onSetRoutePickMode?: (mode: Exclude<RoutePickMode, null>) => void;
  onSwapRouteEndpoints?: () => void;
  onClearRoute?: () => void;
  routeOverlay?: RouteNetworkOverlay | null;
  overlayState?: 'idle' | 'loading' | 'ready' | 'error';
  overlayError?: string | null;
  overlayTruncated?: boolean;
  onRetryOverlay?: () => void;
  isMeasuring?: boolean;
  locationFresh?: boolean;
  locationHasFix?: boolean;
  sessionSummary?: MeasurementSessionSummary | null;
  onUserLocationChange?: (coords: { lat: number; lng: number; accuracy: number; speed: number | null; heading: number | null; timestamp?: number }) => void;
  onLocationStatusChange?: (status: LocationTrackerStatus, message: string | null) => void;
  navigationProgress?: { remainingMeters: number; progressPercent: number; remainingSeconds: number; distanceFromRouteMeters: number } | null;
  navigationGpsMessage?: string;
  liveNavigationActive?: boolean;
  navigationOffRoute?: boolean;
  rerouteState?: 'idle' | 'loading' | 'error' | 'ready';
  rerouteError?: string | null;
  rerouteRoutes?: WalkingRouteOption[];
  onStartLiveNavigation?: () => void;
  onEndLiveNavigation?: () => void;
  onRequestReroute?: () => void;
  onApplyReroute?: (index: number) => void;
  onRetryLocation?: () => void;
  mapSearchSelection?: MapSearchResult | null;
  nearbySearchMeasurements?: Array<{ measurement: LiveMeasurement; distanceMeters: number }>;
  nearbySearchStatus?: 'idle' | 'loading' | 'loaded' | 'error';
  nearbySearchError?: string | null;
  onSelectMapSearchLocation?: (location: MapSearchResult) => void;
  onMeasureSearchedArea?: () => void;
  onRetryNearbySearch?: () => void;
}

export const MapVisualization: React.FC<MapVisualizationProps> = ({
  selectedOperator,
  liveMeasurements = [],
  historicalMeasurements = [],
  historyOperator = 'All',
  onHistoryOperatorChange,
  historyStatus = 'loaded',
  historyError,
  onRetryHistory,
  bestSpotCandidate = null,
  onLocationRetryReady,
  navigationActive = false,
  onCloseNavigation,
  routeOrigin = null,
  routeDestination = null,
  routePickMode = null,
  onPickRouteEndpoint,
  onMapsReady,
  walkingRoutes = [],
  routeRankings = [],
  selectedWalkingRouteIndex = 0,
  onSelectWalkingRoute,
  routeState = 'idle',
  routeError = null,
  onRequestWalkingRoutes,
  onRetryWalkingRoutes,
  currentGpsReady = false,
  currentGpsMessage = 'No fresh GPS fix is available.',
  onUseGpsOrigin,
  onSetRoutePickMode,
  onSwapRouteEndpoints,
  onClearRoute,
  routeOverlay = null,
  overlayState = 'idle',
  overlayError = null,
  overlayTruncated = false,
  onRetryOverlay,
  isMeasuring = false,
  locationFresh,
  locationHasFix,
  sessionSummary = null,
  onUserLocationChange,
  onLocationStatusChange,
  navigationProgress,
  navigationGpsMessage = '',
  liveNavigationActive = false,
  navigationOffRoute = false,
  rerouteState = 'idle', rerouteError = null, rerouteRoutes = [], onStartLiveNavigation, onEndLiveNavigation, onRequestReroute, onApplyReroute, onRetryLocation,
  mapSearchSelection = null, nearbySearchMeasurements = [], nearbySearchStatus = 'idle', nearbySearchError = null, onSelectMapSearchLocation, onMeasureSearchedArea, onRetryNearbySearch
}) => {
  const visibleHistoricalCount = filterHistoricalMeasurements(historicalMeasurements, historyOperator).length;
  return (
    <div style={styles.container} className="glass-panel map-panel">
      {/* Map Header HUD Bar */}
      <div style={styles.hudHeader} className="map-hud-header">
        <div style={styles.hudTitleGroup} className="map-title-group">
          <Layers size={16} color="#00D9FF" />
          <span style={styles.hudTitle}>CAMPUS NETWORK INTELLIGENCE MAP</span>
          <span style={styles.hudGridTag}>GRID: 12.9692° N, 79.1559° E</span>
        </div>

        {/* Legend */}
        <div style={styles.legendGroup} className="map-legend">
          <div style={styles.legendItem}>
            <span style={{ ...styles.legendDot, backgroundColor: '#00E676' }} />
            <span>NQS 80-100</span>
          </div>
          <div style={styles.legendItem}>
            <span style={{ ...styles.legendDot, backgroundColor: '#A3E635' }} />
            <span>NQS 60-79</span>
          </div>
          <div style={styles.legendItem}>
            <span style={{ ...styles.legendDot, backgroundColor: '#FF9100' }} />
            <span>NQS 40-59</span>
          </div>
          <div style={styles.legendItem}>
            <span style={{ ...styles.legendDot, backgroundColor: '#FF1744' }} />
            <span>NQS 0-39</span>
          </div>
          <label style={styles.filterLabel}>History
            <select aria-label="Filter historical measurements by operator" value={historyOperator}
              onChange={(event) => onHistoryOperatorChange?.(event.target.value as OperatorFilter)} style={styles.filterSelect}>
              {['All', 'Jio', 'Airtel', 'Vi', 'BSNL'].map((operator) => <option key={operator} value={operator}>{operator === 'All' ? 'All Operators' : operator}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Real Interactive Google Maps Viewport */}
      <div style={styles.mapCanvas} className="map-canvas">
        <MapLocationSearch operator={selectedOperator} selected={mapSearchSelection} nearby={nearbySearchMeasurements}
          nearbyStatus={nearbySearchStatus} nearbyError={nearbySearchError} onSelect={(location) => onSelectMapSearchLocation?.(location)}
          onMeasureArea={onMeasureSearchedArea ?? (() => undefined)} onRetryNearby={onRetryNearbySearch ?? (() => undefined)} />
        <CampusMap
          center={{ lat: 12.9692, lng: 79.1559 }}
          zoom={16}
          className="netnav-map"
          liveMeasurements={liveMeasurements}
          historicalMeasurements={[...new Map([...filterHistoricalMeasurements(historicalMeasurements, historyOperator), ...nearbySearchMeasurements.map((row) => row.measurement)].map((row) => [row.id, row])).values()]}
          bestSpotCandidate={bestSpotCandidate}
          onLocationRetryReady={onLocationRetryReady}
          navigationActive={navigationActive}
          routeOrigin={routeOrigin}
          routeDestination={routeDestination}
          routePickMode={routePickMode}
          onNavigationMapPick={onPickRouteEndpoint}
          onMapsReady={onMapsReady}
          walkingRoutes={walkingRoutes}
          selectedWalkingRouteIndex={selectedWalkingRouteIndex}
          routeOverlay={routeOverlay}
          searchPosition={mapSearchSelection?.position ?? null}
          searchLabel={mapSearchSelection?.name ?? null}
          isMeasuring={isMeasuring}
          locationFresh={locationFresh}
          locationHasFix={locationHasFix}
          sessionSummary={sessionSummary}
          onUserLocationChange={onUserLocationChange}
          onLocationStatusChange={onLocationStatusChange}
        />
        {navigationActive && <RoutePlannerPanel
          origin={routeOrigin} destination={routeDestination} pickMode={routePickMode}
          currentGpsReady={currentGpsReady} currentGpsMessage={currentGpsMessage} operator={selectedOperator}
          routeState={routeState} routeError={routeError} routes={walkingRoutes} selectedRouteIndex={selectedWalkingRouteIndex}
          overlay={routeOverlay} overlayState={overlayState} overlayError={overlayError} overlayTruncated={overlayTruncated}
          routeRankings={routeRankings}
          navigationProgress={navigationProgress ?? null} navigationGpsMessage={navigationGpsMessage}
          liveNavigationActive={liveNavigationActive} navigationOffRoute={navigationOffRoute}
          rerouteState={rerouteState} rerouteError={rerouteError} rerouteRoutes={rerouteRoutes}
          onStartLiveNavigation={onStartLiveNavigation} onEndLiveNavigation={onEndLiveNavigation}
          onRequestReroute={onRequestReroute} onApplyReroute={onApplyReroute}
          onRetryLocation={onRetryLocation}
          onPickMode={(mode) => onSetRoutePickMode?.(mode)} onUseGpsOrigin={onUseGpsOrigin ?? (() => undefined)}
          onSwap={onSwapRouteEndpoints ?? (() => undefined)} onClear={onClearRoute ?? (() => undefined)}
          onRequestRoutes={onRequestWalkingRoutes ?? (() => undefined)} onSelectRoute={(index) => onSelectWalkingRoute?.(index)}
          onRetryRoutes={onRetryWalkingRoutes ?? (() => undefined)} onRetryOverlay={onRetryOverlay ?? (() => undefined)}
          onClose={onCloseNavigation ?? (() => undefined)}
        />}
        {historyStatus !== 'loaded' || historicalMeasurements.length === 0 ? (
          <div role={historyStatus === 'error' ? 'alert' : 'status'} style={styles.historyState}>
            <span>{historyStatus === 'loading' ? 'Loading saved measurements…' : historyStatus === 'error' ? `Could not load saved measurements${historyError ? `: ${historyError}` : '.'}` : 'No saved historical measurements yet.'}</span>
            {historyStatus === 'error' && <button type="button" onClick={onRetryHistory} style={styles.retryHistory}>Retry</button>}
          </div>
        ) : null}
      </div>

      {/* Map Footer Intelligence HUD Bar */}
      <div style={styles.hudFooter} className="map-hud-footer">
        <div style={styles.hudFooterStat}>
          <span>Live samples: <strong>{liveMeasurements.length}</strong></span>
        </div>
        <div style={styles.hudFooterStat}>
          <span>Operator tag: <strong>{selectedOperator} (manual)</strong></span>
        </div>
        <div style={styles.hudFooterStat}>
          <span>Saved records in filter: <strong>{historyStatus === 'loaded' ? visibleHistoricalCount : '—'}</strong></span>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    maxWidth: '1400px',
    margin: '0 auto 32px',
    borderRadius: '20px',
    border: '1px solid rgba(0, 217, 255, 0.25)',
    backgroundColor: 'rgba(8, 20, 38, 0.85)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  hudHeader: {
    padding: '14px 24px',
    backgroundColor: 'rgba(11, 26, 45, 0.9)',
    borderBottom: '1px solid rgba(0, 217, 255, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '12px'
  },
  hudTitleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  hudTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    color: '#F5FAFF'
  },
  hudGridTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    color: '#60788C',
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
    padding: '2px 8px',
    borderRadius: '4px'
  },
  legendGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    fontSize: '0.75rem',
    color: '#9DB4C8',
    fontFamily: 'var(--font-mono)'
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  legendDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  },
  filterLabel: { display: 'flex', alignItems: 'center', gap: '6px' },
  filterSelect: { color: '#F5FAFF', background: '#0B1A2D', border: '1px solid rgba(0,217,255,.35)', borderRadius: '5px', padding: '5px' },
  historyState: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 6, display: 'flex', alignItems: 'center', gap: '10px', maxWidth: '80%', padding: '10px 14px', borderRadius: '8px', background: 'rgba(5,11,22,.88)', color: '#F5FAFF', font: '12px var(--font-mono)', pointerEvents: 'none' },
  retryHistory: { color: '#00D9FF', background: 'transparent', border: '1px solid #00D9FF', borderRadius: '4px', padding: '5px 9px', cursor: 'pointer', pointerEvents: 'auto' },
  mapCanvas: {
    position: 'relative',
    width: '100%',
    height: '480px',
    backgroundColor: '#050B16',
    overflow: 'hidden'
  },
  hudFooter: {
    padding: '12px 24px',
    backgroundColor: 'rgba(11, 26, 45, 0.9)',
    borderTop: '1px solid rgba(0, 217, 255, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '0.78rem',
    color: '#9DB4C8',
    flexWrap: 'wrap',
    gap: '12px'
  },
  hudFooterStat: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  }
};
