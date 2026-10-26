import React from 'react';
import type { TelecomOperator } from '../types';
import type { BestSpotCandidate, BestSpotResult } from '../services/bestSpot';
import { Activity, Award, Clock, MapPin, Radio, RefreshCw } from 'lucide-react';

type BestSpotViewState = BestSpotResult | { status: 'idle' | 'history-loading' | 'history-error' };
interface BestSpotCardProps {
  selectedOperator: TelecomOperator;
  state: BestSpotViewState;
  onMeasureLiveClick?: () => void;
  onRetrySearch?: () => void;
  onRetryLocation?: () => void;
  onRetryHistory?: () => void;
}

const showMetric = (key: string, value: number | undefined, suffix: string, availability: Record<string, boolean>) =>
  availability[key] && value !== undefined && Number.isFinite(value) ? `${value.toFixed(1)} ${suffix}` : 'N/A';

export const BestSpotCard: React.FC<BestSpotCardProps> = ({ selectedOperator, state, onMeasureLiveClick, onRetrySearch, onRetryLocation, onRetryHistory }) => {
  const candidate: BestSpotCandidate | null = state.status === 'success' ? state.candidate : null;
  const messages: Record<BestSpotViewState['status'], string> = {
    idle: 'Use Find Best Spot to search saved measurements within 10 metres of your current location.',
    'gps-unavailable': 'Waiting for a GPS fix. Enable location access and wait for the map to report your position.',
    'gps-stale': 'Your GPS fix is older than 30 seconds. Wait for a fresh position, then retry.',
    'gps-invalid': 'The browser returned invalid coordinates or accuracy data. Retry location from the map.',
    'gps-inaccurate': 'GPS accuracy is worse than 10 metres, so this search cannot reliably use a 10-metre radius. Wait for a more accurate fix and retry.',
    'history-loading': 'Loading saved measurements…',
    'history-error': 'Saved measurements could not be loaded. Retry history, then search again.',
    'no-data': `No valid ${selectedOperator} measurements were found within 10 metres. Measure this area to add historical data.`,
    success: ''
  };

  return (
    <div style={styles.card} className="glass-panel tech-corners">
      <div style={styles.cardHeader}>
        <div style={styles.titleGroup}>
          <div style={styles.iconBox}><Award size={20} color="#00E676" /></div>
          <div><div style={styles.headerLabel}>PERSISTED MEASUREMENTS · 10 M RADIUS</div><h2 style={styles.cardTitle}>BEST NETWORK SPOT</h2></div>
        </div>
        {candidate && <div className="badge-nqs badge-excellent">{candidate.rankScore.toFixed(1)} RANK</div>}
      </div>

      {candidate ? (
        <>
          <div style={styles.contentBody}>
            <div style={styles.scoreBox}>
              <div style={styles.scoreLabel}>AVERAGE HISTORICAL NQS</div>
              <div style={styles.scoreNumberGroup}><span style={styles.scoreNumber}>{candidate.nqs}</span><span style={styles.scoreMax}>/100</span></div>
              <div style={styles.scoreSubtext}><Radio size={12} color="#00D9FF" /><span>{candidate.operator} · {candidate.sampleCount} sample{candidate.sampleCount === 1 ? '' : 's'}</span></div>
            </div>
            <div style={styles.detailsGrid}>
              <div style={styles.detailItem}><MapPin size={16} color="#00D9FF" /><div><span style={styles.detailMetaLabel}>SPOT · DISTANCE</span><div style={styles.detailValue}>{candidate.distanceMeters.toFixed(1)} m from your GPS fix</div><div style={styles.detailSubValue}>{candidate.latitude.toFixed(6)}, {candidate.longitude.toFixed(6)}</div></div></div>
              <div style={styles.detailItem}><Clock size={16} color="#9DB4C8" /><div><span style={styles.detailMetaLabel}>LAST MEASURED · GPS ACCURACY</span><div style={styles.detailValue}>{new Date(candidate.lastMeasured).toLocaleString()}</div><div style={styles.detailSubValue}>Mean recorded accuracy ±{candidate.averageAccuracy.toFixed(1)} m</div></div></div>
              <div style={styles.metricGrid}>
                <span>Latency <b>{showMetric('latency', candidate.metrics.latencyMs, 'ms', candidate.metricAvailability)}</b></span>
                <span>Download <b>{showMetric('download', candidate.metrics.downloadMbps, 'Mbps', candidate.metricAvailability)}</b></span>
                <span>Upload <b>{showMetric('upload', candidate.metrics.uploadMbps, 'Mbps', candidate.metricAvailability)}</b></span>
                <span>Jitter <b>{showMetric('jitter', candidate.metrics.jitterMs, 'ms', candidate.metricAvailability)}</b></span>
                <span>Probe failure <b>{showMetric('packetLoss', candidate.metrics.packetLossPercent, '%', candidate.metricAvailability)}</b></span>
                <span>Signal <b>{showMetric('signal', candidate.metrics.signalDbm, 'dBm', candidate.metricAvailability)}</b></span>
              </div>
            </div>
          </div>
          <p style={styles.formula}>Rank = .70×adjusted NQS + .15×sample support + .10×recency + .05×GPS quality. Adjusted NQS = 50 + (recency-weighted NQS − 50)×n/(n+2); sample support = 100×(1−e^(−n/3)); recency = 100×2^(−age/30 days); GPS quality = 100/(1+mean accuracy/10 m). Each record's NQS is weighted with the same 30-day half-life.</p>
        </>
      ) : (
        <div style={styles.emptyState} role={state.status.includes('error') ? 'alert' : 'status'}>
          <p>{messages[state.status]}</p>
          {state.status === 'history-error' && <button type="button" style={styles.actionBtn} onClick={onRetryHistory}><RefreshCw size={14} /> Retry History</button>}
          {['gps-stale', 'gps-invalid', 'gps-inaccurate'].includes(state.status) && <>
            <button type="button" style={styles.actionBtn} onClick={onRetryLocation}><MapPin size={14} /> Retry Location</button>
            <button type="button" style={styles.actionBtn} onClick={onRetrySearch}><RefreshCw size={14} /> Retry Search</button>
          </>}
          {state.status === 'no-data' && <button type="button" style={styles.actionBtn} onClick={onMeasureLiveClick}><Activity size={15} /> Measure This Area</button>}
          {state.status === 'history-loading' && <span>One moment…</span>}
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: { padding: '24px', borderRadius: '16px', border: '1px solid rgba(0,230,118,.3)', backgroundColor: 'rgba(11,26,45,.85)', boxShadow: '0 8px 32px rgba(0,0,0,.5),0 0 20px rgba(0,230,118,.08)' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '16px', borderBottom: '1px solid rgba(0,217,255,.15)', marginBottom: '20px', gap: '12px' },
  titleGroup: { display: 'flex', alignItems: 'center', gap: '12px' },
  iconBox: { width: '38px', height: '38px', borderRadius: '10px', backgroundColor: 'rgba(0,230,118,.12)', border: '1px solid rgba(0,230,118,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  headerLabel: { fontFamily: 'var(--font-mono)', fontSize: '.65rem', fontWeight: 700, color: '#00E676', letterSpacing: '.08em' },
  cardTitle: { fontSize: '1.25rem', fontWeight: 800, color: '#F5FAFF', margin: 0 },
  contentBody: { display: 'grid', gridTemplateColumns: '220px 1fr', gap: '24px', alignItems: 'center', marginBottom: '14px' },
  scoreBox: { backgroundColor: 'rgba(5,11,22,.8)', border: '1px solid rgba(0,230,118,.3)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  scoreLabel: { fontFamily: 'var(--font-mono)', fontSize: '.62rem', fontWeight: 700, color: '#9DB4C8', marginBottom: '4px' },
  scoreNumberGroup: { display: 'flex', alignItems: 'baseline', gap: '4px' },
  scoreNumber: { fontFamily: 'var(--font-mono)', fontSize: '3.2rem', fontWeight: 800, color: '#00E676', lineHeight: 1 },
  scoreMax: { fontFamily: 'var(--font-mono)', fontSize: '.9rem', color: '#60788C' },
  scoreSubtext: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', fontSize: '.72rem', color: '#9DB4C8' },
  detailsGrid: { display: 'flex', flexDirection: 'column', gap: '13px', minWidth: 0 },
  detailItem: { display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '.9rem' },
  detailMetaLabel: { display: 'block', fontFamily: 'var(--font-mono)', fontSize: '.62rem', fontWeight: 700, color: '#60788C' },
  detailValue: { fontSize: '.9rem', fontWeight: 700, color: '#F5FAFF' },
  detailSubValue: { fontSize: '.75rem', color: '#9DB4C8' },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '8px', color: '#9DB4C8', fontSize: '.75rem' },
  formula: { margin: '8px 0 0', color: '#8299AD', fontSize: '.7rem', lineHeight: 1.5 },
  emptyState: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px', minHeight: '90px', color: '#CBD8E3', lineHeight: 1.5 },
  actionBtn: { display: 'inline-flex', alignItems: 'center', gap: '7px', border: '1px solid rgba(53,244,255,.4)', background: 'rgba(0,217,255,.06)', color: '#35F4FF', borderRadius: '6px', padding: '8px 11px', cursor: 'pointer' }
};
