import React, { useState } from 'react';
import { MapPin, Search } from 'lucide-react';
import type { TelecomOperator } from '../types';
import { locationSearchStateMessage, MAP_SEARCH_MEASUREMENT_RADIUS_METERS, searchMapLocations, type MapSearchResult } from '../services/mapLocationSearch';

interface NearbyRow { measurement: { id: string; nqs: number; timestamp: string }; distanceMeters: number }
interface Props {
  operator: TelecomOperator;
  selected: MapSearchResult | null;
  nearby: NearbyRow[];
  nearbyStatus: 'idle' | 'loading' | 'loaded' | 'error';
  nearbyError: string | null;
  onSelect: (location: MapSearchResult) => void;
  onMeasureArea: () => void;
  onRetryNearby: () => void;
}

export const MapLocationSearch: React.FC<Props> = ({ operator, selected, nearby, nearbyStatus, nearbyError, onSelect, onMeasureArea, onRetryNearby }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MapSearchResult[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [searchError, setSearchError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSearchState('loading'); setSearchError(null); setResults([]);
    try { setResults(await searchMapLocations(query)); setSearchState('idle'); }
    catch (error) { setSearchState('error'); setSearchError(error instanceof Error ? error.message : 'Location search failed.'); }
  };

  return <section style={styles.panel} aria-label="Map location search">
    <form onSubmit={(event) => { void submit(event); }} style={styles.form}>
      <MapPin size={15} color="#B388FF" />
      <input aria-label="Search a building, landmark, or address" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search building, landmark, or address" style={styles.input} />
      <button type="submit" style={styles.searchButton} disabled={searchState === 'loading' || !query.trim()} aria-label="Search map locations"><Search size={15} />{searchState === 'loading' ? 'Searching…' : 'Search'}</button>
    </form>
    {searchError && <p role="alert" style={styles.error}>{searchError}</p>}
    {results.length > 0 && <div style={styles.results} aria-label="Location search results">{results.map((result) =>
      <button key={result.id} type="button" style={styles.result} onClick={() => onSelect(result)}><b>{result.name}</b><small>{result.address}</small></button>
    )}</div>}
    {selected && <div style={styles.nearby}>
      <b>Saved {operator} measurements within {MAP_SEARCH_MEASUREMENT_RADIUS_METERS} m</b>
      {nearbyStatus === 'loading' && <span role="status">{locationSearchStateMessage('loading', 0)}</span>}
      {nearbyStatus === 'error' && <div role="alert" style={styles.error}>{nearbyError || locationSearchStateMessage('error', 0)} <button type="button" style={styles.retryButton} onClick={onRetryNearby}>Retry</button></div>}
      {nearbyStatus === 'loaded' && nearbyError && <small style={styles.warning}>{nearbyError}</small>}
      {nearbyStatus === 'loaded' && nearby.length === 0 && <span role="status">{locationSearchStateMessage('loaded', 0)}</span>}
      {nearby.map(({ measurement, distanceMeters }) => <span key={measurement.id} style={styles.row}>{measurement.nqs}/100 NQS · {Math.round(distanceMeters)} m · {new Date(measurement.timestamp).toLocaleString()}</span>)}
      <button type="button" style={styles.measureButton} onClick={onMeasureArea}>Start Live Measurement Here</button>
      <small>Measurements use your current GPS position; be at the searched location for a nearby sample.</small>
    </div>}
  </section>;
};

const styles: Record<string, React.CSSProperties> = {
  panel: { position: 'absolute', zIndex: 7, left: 12, bottom: 12, width: 'min(420px, calc(100% - 24px))', maxHeight: '48%', overflow: 'auto', padding: 10, borderRadius: 8, color: '#F5FAFF', background: 'rgba(5,11,22,.95)', border: '1px solid rgba(179,136,255,.4)', boxShadow: '0 5px 20px rgba(0,0,0,.4)', fontFamily: 'var(--font-sans)', fontSize: '.69rem' },
  form: { display: 'flex', alignItems: 'center', gap: 6 }, input: { minWidth: 0, flex: 1, color: '#F5FAFF', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(157,180,200,.25)', borderRadius: 5, padding: '8px 7px', fontSize: '.7rem' },
  searchButton: { display: 'inline-flex', alignItems: 'center', gap: 4, color: '#F5FAFF', background: 'rgba(179,136,255,.15)', border: '1px solid rgba(179,136,255,.5)', borderRadius: 5, padding: '7px 8px', cursor: 'pointer', fontSize: '.68rem' },
  results: { display: 'grid', gap: 4, marginTop: 6 }, result: { display: 'grid', textAlign: 'left', gap: 2, color: '#E7D8FF', background: 'rgba(179,136,255,.08)', border: '1px solid rgba(179,136,255,.2)', borderRadius: 4, padding: 6, cursor: 'pointer' },
  nearby: { display: 'grid', gap: 5, borderTop: '1px solid rgba(179,136,255,.25)', marginTop: 8, paddingTop: 7 }, row: { color: '#D8E4EF' }, error: { color: '#FF9AA5' }, warning: { color: '#FFD36A' }, retryButton: { color: '#FFE1E5', background: 'transparent', border: '1px solid rgba(255,154,165,.4)', borderRadius: 4, padding: '3px 6px', cursor: 'pointer' }, measureButton: { justifySelf: 'start', color: '#BDEEFF', background: 'rgba(0,217,255,.08)', border: '1px solid rgba(0,217,255,.35)', borderRadius: 4, padding: '6px 8px', cursor: 'pointer' }
};
