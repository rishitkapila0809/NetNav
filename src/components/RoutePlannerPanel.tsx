import React from 'react';
import { AlertTriangle, Crosshair, RefreshCw, Route as RouteIcon, X } from 'lucide-react';
import type { TelecomOperator } from '../types';
import type { RouteNetworkOverlay } from '../services/routeNetworkOverlay';
import type { RouteCoordinate } from '../services/walkingRoutes';
import type { WalkingRouteOption } from '../services/walkingRoutes';
import type { RankedWalkingRoute } from '../services/routeRanking';

export type RoutePickMode = 'origin' | 'destination' | null;
interface RoutePlannerPanelProps {
  origin: RouteCoordinate | null; destination: RouteCoordinate | null; pickMode: RoutePickMode;
  currentGpsReady: boolean; currentGpsMessage: string; operator: TelecomOperator;
  routeState: 'idle' | 'loading' | 'ready' | 'error'; routeError: string | null;
  routes: WalkingRouteOption[]; selectedRouteIndex: number; overlay: RouteNetworkOverlay | null;
  routeRankings: RankedWalkingRoute[];
  navigationProgress: { remainingMeters: number; progressPercent: number; remainingSeconds: number; distanceFromRouteMeters: number } | null | undefined;
  navigationGpsMessage: string; liveNavigationActive: boolean; navigationOffRoute: boolean;
  rerouteState: 'idle' | 'loading' | 'error' | 'ready'; rerouteError: string | null; rerouteRoutes: WalkingRouteOption[];
  overlayState: 'idle' | 'loading' | 'ready' | 'error'; overlayError: string | null; overlayTruncated: boolean;
  onPickMode: (mode: Exclude<RoutePickMode, null>) => void; onUseGpsOrigin: () => void;
  onSwap: () => void; onClear: () => void; onRequestRoutes: () => void;
  onSelectRoute: (index: number) => void; onRetryRoutes: () => void; onRetryOverlay: () => void;
  onStartLiveNavigation?: () => void; onEndLiveNavigation?: () => void; onRequestReroute?: () => void; onApplyReroute?: (index: number) => void;
  onRetryLocation?: () => void;
  onClose: () => void;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}
function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}
function formatPoint(point: RouteCoordinate | null): string {
  return point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'Select a point on the map';
}

export const RoutePlannerPanel: React.FC<RoutePlannerPanelProps> = (props) => (
  <section style={styles.panel} aria-label="Walking route planner">
    <div style={styles.heading}>
      <div style={styles.title}><RouteIcon size={17} color="#00D9FF" /><strong>WALKING ROUTE PLANNER</strong></div>
      <button type="button" style={styles.iconButton} onClick={props.onClose} aria-label="Close route planner"><X size={16} /></button>
    </div>
    <p style={styles.warning}><AlertTriangle size={15} /> Walking routes may lack clear sidewalks or pedestrian paths. Follow local signs and use your judgment.</p>
    <div style={styles.endpoints}>
      <div><span style={styles.label}>ORIGIN</span><div style={styles.point}>{formatPoint(props.origin)}</div></div>
      <button type="button" style={styles.button} onClick={() => props.onPickMode('origin')} aria-pressed={props.pickMode === 'origin'}>Set origin on map</button>
      <button type="button" style={styles.button} onClick={props.onUseGpsOrigin} disabled={!props.currentGpsReady} title={props.currentGpsMessage}><Crosshair size={14} /> Use current GPS</button>
    </div>
    <div style={styles.endpoints}>
      <div><span style={styles.label}>DESTINATION</span><div style={styles.point}>{formatPoint(props.destination)}</div></div>
      <button type="button" style={styles.button} onClick={() => props.onPickMode('destination')} aria-pressed={props.pickMode === 'destination'}>Set destination on map</button>
      <button type="button" style={styles.button} onClick={props.onSwap} disabled={!props.origin || !props.destination}>Swap</button>
      <button type="button" style={styles.iconButton} onClick={props.onClear} aria-label="Clear route"><X size={15} /> Clear</button>
    </div>
    {props.pickMode && <p role="status" style={styles.pickMessage}>Click the map to set the {props.pickMode}.</p>}
    <div style={styles.actions}>
      <button type="button" style={styles.primaryButton} onClick={props.onRequestRoutes} disabled={!props.origin || !props.destination || props.routeState === 'loading'}>
        {props.routeState === 'loading' ? 'Finding walking routes…' : 'Find walking routes'}
      </button>
      {props.routeState === 'error' && <button type="button" style={styles.button} onClick={props.onRetryRoutes}><RefreshCw size={14} /> Retry</button>}
      <span style={styles.operator}>Overlay operator: <b>{props.operator}</b></span>
    </div>
    {props.routeError && <p role="alert" style={styles.error}>{props.routeError}</p>}
    <div style={styles.navigationBox}>
      <div><b>LIVE GPS NAVIGATION</b><span style={styles.navStatus}>{props.navigationGpsMessage || 'Waiting for location status.'}</span></div>
      {!props.liveNavigationActive
        ? <button type="button" style={styles.primaryButton} onClick={props.onStartLiveNavigation} disabled={!props.currentGpsReady || props.routeState !== 'ready' || !props.routes[props.selectedRouteIndex]}>Start Navigation</button>
        : <>
          <div style={styles.progressTrack} aria-label={`Route progress ${Math.round(props.navigationProgress?.progressPercent ?? 0)} percent`}><div style={{ ...styles.progressFill, width: `${Math.round(props.navigationProgress?.progressPercent ?? 0)}%` }} /></div>
          <span>{props.navigationProgress ? `${Math.round(props.navigationProgress.progressPercent)}% · ${formatDistance(props.navigationProgress.remainingMeters)} remaining · ${formatDuration(props.navigationProgress.remainingSeconds)}` : 'Waiting for a reliable GPS fix to calculate progress.'}</span>
          {props.navigationOffRoute && <div role="alert" style={styles.offRoute}>You appear to be off the selected route. GPS can be noisy; request a route from your current location to review alternatives.</div>}
          <div style={styles.recommendations}><button type="button" style={styles.button} onClick={props.onRequestReroute} disabled={!props.currentGpsReady || props.rerouteState === 'loading'}>{props.rerouteState === 'loading' ? 'Finding new routes…' : 'Request route from current location'}</button><button type="button" style={styles.button} onClick={props.onEndLiveNavigation}>End Navigation</button></div>
          {props.navigationGpsMessage && <small style={styles.note}>{props.navigationGpsMessage}</small>}
          {!props.currentGpsReady && <button type="button" style={styles.button} onClick={props.onRetryLocation}>Retry location access</button>}
          {props.rerouteError && <p role="alert" style={styles.error}>{props.rerouteError}</p>}
          {props.rerouteRoutes.length > 0 && <div style={styles.reroutes}><b>Review replacement routes to the same destination</b>{props.rerouteRoutes.map((route, index) => <div key={`reroute-${route.id}`} style={styles.rerouteRow}><span>{index + 1}: {formatDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}</span><button type="button" style={styles.button} onClick={() => props.onApplyReroute?.(index)}>Switch to this route</button></div>)}</div>}
        </>}
    </div>
    {props.routes.length > 0 && <div style={styles.routes}>
      <span style={styles.label}>AVAILABLE ROUTES</span>
      <div style={styles.recommendations}>
        {!props.liveNavigationActive && props.routeRankings.find((item) => item.fastest) && <button type="button" style={styles.button} onClick={() => props.onSelectRoute(props.routeRankings.findIndex((item) => item.fastest))}>Choose Fastest Route</button>}
        {!props.liveNavigationActive && props.routeRankings.some((item) => item.bestNetwork) && <button type="button" style={styles.button} onClick={() => props.onSelectRoute(props.routeRankings.findIndex((item) => item.bestNetwork))}>Choose Best Network Route</button>}
        <span style={styles.note}>Cost: 70% normalized walking time + 30% network risk; lower is better.</span>
      </div>
      {props.routes.map((option, index) => {
        const ranking = props.routeRankings[index];
        return <label key={option.id} style={{ ...styles.routeOption, borderColor: props.selectedRouteIndex === index ? '#00D9FF' : 'rgba(157,180,200,.2)' }}>
        <input type="radio" name="netnav-route" checked={props.selectedRouteIndex === index} disabled={props.liveNavigationActive} onChange={() => props.onSelectRoute(index)} />
        <span style={styles.routeContent}>
          <b>{ranking?.fastest ? 'Fastest Route' : index === 0 ? 'Route 1' : `Alternative ${index}`}{ranking?.bestNetwork ? ' · Best Network Route' : ''}</b>
          <span>{formatDistance(option.distanceMeters)} · {formatDuration(option.durationSeconds)} · Coverage {ranking?.overlay?.coveragePercent ?? 0}%</span>
          <span>Network: {ranking?.overlay ? `Good ${formatDistance(ranking.overlay.goodMeters)} · Moderate ${formatDistance(ranking.overlay.moderateMeters)} · Poor ${formatDistance(ranking.overlay.poorMeters)} · Unknown ${formatDistance(ranking.overlay.unknownMeters)}` : 'Loading / unavailable'}</span>
          <span>Freshness: {ranking?.overlay?.newestMeasurement ? new Date(ranking.overlay.newestMeasurement).toLocaleString() : 'No matched measurements'} · Final cost: {ranking?.finalCost === null || ranking?.finalCost === undefined ? 'N/A' : `${(ranking.finalCost * 100).toFixed(1)}/100`}</span>
          {ranking?.explanation && <small>{ranking.explanation}</small>}
          {ranking && !ranking.confidentNetworkEvidence && <b style={{ color: '#FFD36A' }}>Insufficient network data</b>}
        </span>
      </label>;
      })}
    </div>}
    {props.routes.length > 0 && <div style={styles.overlay}>
      <div style={styles.overlayHeader}><b>HISTORICAL NETWORK QUALITY · {props.operator}</b><span>Good · Moderate · Poor · Unknown</span></div>
      {props.overlayState === 'loading' && <span role="status">Loading operator history and matching route sections…</span>}
      {props.overlayState === 'error' && <div role="alert" style={styles.error}>{props.overlayError || 'Could not load route measurements.'} <button type="button" style={styles.button} onClick={props.onRetryOverlay}>Retry overlay</button></div>}
      {props.overlayState === 'ready' && props.overlay && <>
        <div style={styles.coverage}>Coverage: <b>{props.overlay.coveragePercent}%</b> · Newest matched data: <b>{props.overlay.newestMeasurement ? new Date(props.overlay.newestMeasurement).toLocaleString() : 'None'}</b></div>
        <div style={styles.legend}>
          <span><i style={{ background: '#00E676' }} />Good {formatDistance(props.overlay.goodMeters)}</span>
          <span><i style={{ background: '#FFB300' }} />Moderate {formatDistance(props.overlay.moderateMeters)}</span>
          <span><i style={{ background: '#FF1744' }} />Poor {formatDistance(props.overlay.poorMeters)}</span>
          <span><i style={{ background: '#78899A' }} />Unknown {formatDistance(props.overlay.unknownMeters)}</span>
        </div>
        {props.overlayTruncated && <p style={styles.warning}>Overlay data reached the 20,000-record safety limit. Coverage may be incomplete.</p>}
        <small style={styles.note}>Unknown sections have insufficient nearby measurements; they do not indicate poor coverage. Samples are assigned to one nearest 20 m route bin, with no interpolation across gaps.</small>
      </>}
    </div>}
  </section>
);

const styles: Record<string, React.CSSProperties> = {
  panel: { position: 'absolute', zIndex: 8, top: 12, right: 12, width: 'min(560px, calc(100% - 24px))', maxHeight: 'calc(100% - 24px)', overflowY: 'auto', padding: 14, borderRadius: 10, background: 'rgba(5,11,22,.95)', border: '1px solid rgba(0,217,255,.35)', color: '#F5FAFF', boxShadow: '0 8px 28px rgba(0,0,0,.55)', fontFamily: 'var(--font-sans)' },
  heading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: '.78rem' },
  warning: { display: 'flex', alignItems: 'flex-start', gap: 7, margin: '10px 0', color: '#FFD36A', fontSize: '.72rem', lineHeight: 1.4 },
  endpoints: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, borderTop: '1px solid rgba(157,180,200,.15)', padding: '8px 0' },
  label: { display: 'block', width: '100%', color: '#7890A4', fontFamily: 'var(--font-mono)', fontSize: '.61rem', fontWeight: 700 },
  point: { color: '#D7E4EF', fontSize: '.72rem', minWidth: 190 },
  button: { display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid rgba(0,217,255,.35)', borderRadius: 5, background: 'rgba(0,217,255,.06)', color: '#BDEEFF', padding: '6px 8px', cursor: 'pointer', fontSize: '.69rem' },
  iconButton: { display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: '#9DB4C8', padding: 6, cursor: 'pointer', fontSize: '.68rem' },
  pickMessage: { margin: '4px 0', color: '#00D9FF', fontSize: '.72rem' },
  actions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingTop: 7 },
  primaryButton: { border: '1px solid #00D9FF', borderRadius: 5, background: 'rgba(0,217,255,.16)', color: '#E9FBFF', padding: '8px 12px', cursor: 'pointer', fontWeight: 700, fontSize: '.72rem' },
  operator: { marginLeft: 'auto', color: '#9DB4C8', fontSize: '.7rem' },
  navigationBox: { display: 'grid', gap: 7, borderTop: '1px solid rgba(0,217,255,.2)', marginTop: 8, paddingTop: 9, color: '#DDEAF4', fontSize: '.7rem' },
  navStatus: { display: 'block', color: '#9DB4C8', marginTop: 3 },
  progressTrack: { height: 6, borderRadius: 4, background: 'rgba(157,180,200,.2)', overflow: 'hidden' },
  progressFill: { height: '100%', background: '#00D9FF', transition: 'width .25s ease' },
  offRoute: { padding: 8, border: '1px solid rgba(255,179,0,.45)', borderRadius: 5, background: 'rgba(255,179,0,.1)', color: '#FFD36A', lineHeight: 1.4 },
  reroutes: { display: 'grid', gap: 6, padding: 8, border: '1px solid rgba(0,217,255,.2)', borderRadius: 5 },
  rerouteRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  error: { color: '#FF8C98', fontSize: '.72rem', margin: '8px 0' },
  routes: { display: 'grid', gap: 5, marginTop: 10 },
  routeOption: { display: 'flex', alignItems: 'center', gap: 8, border: '1px solid', borderRadius: 5, padding: '7px 9px', color: '#E6F1F8', fontSize: '.72rem', cursor: 'pointer' },
  routeContent: { display: 'grid', gap: 3 },
  recommendations: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  overlay: { marginTop: 10, borderTop: '1px solid rgba(0,217,255,.18)', paddingTop: 9, display: 'grid', gap: 7, fontSize: '.7rem' },
  overlayHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, fontFamily: 'var(--font-mono)', fontSize: '.64rem' },
  coverage: { color: '#D1DFEA' },
  legend: { display: 'flex', flexWrap: 'wrap', gap: '6px 12px', color: '#D1DFEA' },
  note: { color: '#91A5B7', lineHeight: 1.4 }
};
