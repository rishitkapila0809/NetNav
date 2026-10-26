import React from 'react';
import type { LiveMeasurement } from '../types';
import type { HistoryStatus } from '../services/historicalMeasurements';
import { calculateMeasurementNqs, NQS_FORMULA_VERSION, telemetryEmptyMessage, type TelemetrySource } from '../services/measurementTelemetry';
import { Activity, Gauge, ArrowDownUp, Zap, Signal, Radio, Upload } from 'lucide-react';
import { networkMeasurer } from '../services/networkMeasurer';

interface MetricsCardProps {
  measurement: LiveMeasurement | null;
  source: TelemetrySource | null;
  historyStatus: HistoryStatus;
  historyError: string | null;
  operatorName: string;
}

export const MetricsCard: React.FC<MetricsCardProps> = ({ measurement, source, historyStatus, historyError, operatorName }) => {
  const offline = Boolean(measurement?.isOffline || measurement?.status === 'NO_CONNECTIVITY');
  const evaluation = measurement ? calculateMeasurementNqs(measurement) : null;
  const nqsColor = measurement && !offline ? networkMeasurer.getNqsColor(measurement.nqs, measurement.status) : '#60788C';
  const metricAvailable = (key: string, value: number | undefined) => !offline && measurement?.metricAvailability?.[key] === true && typeof value === 'number' && Number.isFinite(value);
  const value = (key: string, raw: number | undefined, unit: string) => metricAvailable(key, raw) ? `${raw} ${unit}` : 'N/A';
  const emptyText = historyStatus === 'error' && historyError ? `${telemetryEmptyMessage('error', operatorName)} ${historyError}` : telemetryEmptyMessage(historyStatus, operatorName);

  const tiles = [
    { key: 'latency', label: 'LATENCY', icon: <Gauge size={14} color="#00D9FF" />, text: value('latency', measurement?.latencyMs, 'ms'), bar: metricAvailable('latency', measurement?.latencyMs) ? Math.max(0, Math.min(100, 100 - (measurement!.latencyMs / 300) * 100)) : 0 },
    { key: 'packetLoss', label: 'HTTP PROBE FAILURE RATE', icon: <ArrowDownUp size={14} color="#35F4FF" />, text: value('packetLoss', measurement?.packetLossPercent, '%'), bar: metricAvailable('packetLoss', measurement?.packetLossPercent) ? Math.max(0, Math.min(100, 100 - measurement!.packetLossPercent * 5)) : 0 },
    { key: 'download', label: 'DOWNLOAD', icon: <Zap size={14} color="#00E676" />, text: value('download', measurement?.downloadMbps, 'Mbps'), bar: metricAvailable('download', measurement?.downloadMbps) ? Math.max(0, Math.min(100, (measurement!.downloadMbps / 100) * 100)) : 0 },
    { key: 'upload', label: 'UPLOAD', icon: <Upload size={14} color="#00E676" />, text: value('upload', measurement?.uploadMbps, 'Mbps'), bar: metricAvailable('upload', measurement?.uploadMbps) ? Math.max(0, Math.min(100, (measurement!.uploadMbps / 100) * 100)) : 0 },
    { key: 'jitter', label: 'JITTER', icon: <Activity size={14} color="#9DB4C8" />, text: value('jitter', measurement?.jitterMs, 'ms'), bar: metricAvailable('jitter', measurement?.jitterMs) ? Math.max(0, Math.min(100, 100 - (measurement!.jitterMs / 50) * 100)) : 0 },
    { key: 'signal', label: 'SIGNAL (RSRP)', icon: <Signal size={14} color="#00D9FF" />, text: metricAvailable('signal', measurement?.signalDbm) ? `${measurement!.signalDbm} dBm` : 'Unavailable', bar: 0 },
  ];

  return <div style={styles.card} className="glass-panel tech-corners" aria-label="Network quality telemetry">
    <div style={styles.header}>
      <div style={styles.headerTitleGroup}><div style={styles.iconBox}><Activity size={18} color="#00D9FF" /></div><div><div style={styles.metaLabel}>TELEMETRY READOUT</div><h3 style={styles.title}>NETWORK QUALITY</h3></div></div>
      <div style={styles.opTag}><Radio size={12} color="#00D9FF" /><span>{operatorName}</span></div>
    </div>
    {measurement ? <>
      <div style={styles.recordInfo}><b>{source === 'live' ? 'LIVE SESSION SAMPLE' : 'LATEST SAVED SAMPLE'}</b><span>{new Date(measurement.timestamp).toLocaleString()}</span></div>
      <div style={styles.scoreRow}>
        <div><div style={styles.scoreTitle}>STORED NQS</div><div style={{ ...styles.scoreVal, color: nqsColor }}>{offline ? 'N/A' : `${measurement.nqs}/100`}</div></div>
        <div style={{ ...styles.statusBadge, color: offline ? '#AAB8C4' : nqsColor, borderColor: `${nqsColor}66` }}>{offline ? 'MEASUREMENT SERVER UNREACHABLE' : measurement.status}</div>
      </div>
      <div style={styles.metricsGrid}>{tiles.map((tile) => <div key={tile.key} style={styles.metricTile}>
        <div style={styles.tileHeader}>{tile.icon}<span style={styles.tileLabel}>{tile.label}</span></div>
        <div style={styles.tileNum}>{tile.text}</div>
        <div style={styles.tileBarTrack}><div style={{ ...styles.tileBarFill, width: `${tile.bar}%`, backgroundColor: nqsColor }} /></div>
      </div>)}</div>
      <div style={styles.sourceNote}>Operator {measurement.operator} · GPS accuracy ±{Math.round(measurement.accuracy)} m · Source: {source === 'live' ? 'current session' : 'persisted database record'}</div>
      {source === 'persisted' && <div style={evaluation?.verification === 'mismatch' || evaluation?.verification === 'unsupported-signal' ? styles.formulaWarning : styles.formulaNote}>
        {evaluation?.verification === 'match' ? `Stored NQS matches ${NQS_FORMULA_VERSION}. Historical rows do not store a formula-version field.`
          : evaluation?.verification === 'mismatch' ? `Stored NQS is ${measurement.nqs}; current formula yields ${evaluation.nqs}. Showing the saved value without rewriting it.`
            : evaluation?.verification === 'unsupported-signal' ? 'This row marks signal as available, but no signal-strength NQS normalizer is defined. Showing the stored score without recalculation.'
              : 'The stored NQS cannot be verified from the available metrics. Showing the saved score as recorded.'}
      </div>}
      {source === 'live' && evaluation?.verification === 'mismatch' && <div style={styles.formulaWarning}>Live sample NQS does not match the current normalized metrics; showing this sample’s stored score.</div>}
      <div style={styles.footer}>HTTP probe failure rate is not IP-layer packet loss. Browser signal strength is unavailable unless the record explicitly contains it.</div>
    </> : <div role={historyStatus === 'error' ? 'alert' : 'status'} style={styles.empty}>{emptyText}</div>}
  </div>;
};

const styles: Record<string, React.CSSProperties> = {
  card: { padding: 24, borderRadius: 16, border: '1px solid rgba(0,217,255,.25)', backgroundColor: 'rgba(11,26,45,.85)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid rgba(0,217,255,.15)' },
  headerTitleGroup: { display: 'flex', alignItems: 'center', gap: 10 }, iconBox: { width: 34, height: 34, borderRadius: 8, backgroundColor: 'rgba(0,217,255,.12)', border: '1px solid rgba(0,217,255,.3)', display: 'grid', placeItems: 'center' },
  metaLabel: { fontFamily: 'var(--font-mono)', fontSize: '.62rem', fontWeight: 700, color: '#00D9FF' }, title: { fontSize: '1.1rem', fontWeight: 800, color: '#F5FAFF', margin: 0 },
  opTag: { display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: '.72rem', color: '#9DB4C8', backgroundColor: 'rgba(0,217,255,.08)', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,217,255,.2)' },
  recordInfo: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', color: '#9DB4C8', fontSize: '.68rem', marginBottom: 10 },
  scoreRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(5,11,22,.6)', padding: '14px 18px', borderRadius: 10, border: '1px solid rgba(0,217,255,.15)', marginBottom: 14 },
  scoreTitle: { fontFamily: 'var(--font-mono)', fontSize: '.65rem', fontWeight: 700, color: '#60788C' }, scoreVal: { fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: 800, lineHeight: 1 }, statusBadge: { fontSize: '.68rem', padding: '5px 9px', border: '1px solid', borderRadius: 6, textAlign: 'right' },
  metricsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginBottom: 12 }, metricTile: { minWidth: 0, backgroundColor: 'rgba(8,20,38,.8)', border: '1px solid rgba(0,217,255,.15)', borderRadius: 9, padding: 10, display: 'grid', gap: 7 },
  tileHeader: { display: 'flex', alignItems: 'center', gap: 5 }, tileLabel: { fontFamily: 'var(--font-mono)', fontSize: '.56rem', fontWeight: 700, color: '#9DB4C8' }, tileNum: { fontFamily: 'var(--font-mono)', fontSize: '.98rem', fontWeight: 700, color: '#F5FAFF', overflowWrap: 'anywhere' },
  tileBarTrack: { height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 2 }, tileBarFill: { height: '100%', borderRadius: 2 }, sourceNote: { color: '#9DB4C8', fontSize: '.65rem', margin: '4px 0' },
  formulaNote: { color: '#9DB4C8', fontSize: '.65rem', lineHeight: 1.4, marginTop: 6 }, formulaWarning: { color: '#FFD36A', fontSize: '.65rem', lineHeight: 1.4, marginTop: 6 }, footer: { color: '#71879A', fontSize: '.62rem', lineHeight: 1.4, borderTop: '1px solid rgba(0,217,255,.1)', paddingTop: 8, marginTop: 8 },
  empty: { minHeight: 150, display: 'grid', placeItems: 'center', textAlign: 'center', color: '#AAB8C4', lineHeight: 1.5, padding: 18 }
};
