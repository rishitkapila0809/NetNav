import React, { useState } from 'react';
import type { LiveMeasurement, MeasurementSessionSummary } from '../types';
import { networkMeasurer } from '../services/networkMeasurer';
import { Activity, Play, Square, Info, ChevronDown, ChevronUp, MapPin, Gauge, ArrowDownUp, Zap, Signal, CheckCircle2, Award } from 'lucide-react';

interface LiveMeasurementCardProps {
  isMeasuring: boolean;
  currentMeasurement: LiveMeasurement | null;
  storageState: { status: 'score-ineligible' | 'persistence-ineligible' | 'pending' | 'saved' | 'failed' | 'unknown'; error?: string } | null;
  measurementCount: number;
  sessionSummary: MeasurementSessionSummary | null;
  onStartMeasuring: () => void;
  onStopMeasuring: () => void;
}

export const LiveMeasurementCard: React.FC<LiveMeasurementCardProps> = ({
  isMeasuring,
  currentMeasurement,
  storageState,
  measurementCount,
  sessionSummary,
  onStartMeasuring,
  onStopMeasuring
}) => {
  const [showDetails, setShowDetails] = useState<boolean>(false);

  const nqs = currentMeasurement?.nqs;
  const status = currentMeasurement?.status;
  const isOffline = Boolean(currentMeasurement?.isOffline || status === 'NO_CONNECTIVITY');
  const nqsColor = currentMeasurement ? networkMeasurer.getNqsColor(nqs ?? 0, status) : '#60788C';

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km (${Math.round(meters)} m)`;
    }
    return `${Math.round(meters)} m`;
  };

  return (
    <div style={styles.card} className="glass-panel tech-corners">
      {/* Top Header Bar */}
      <div style={styles.header}>
        <div style={styles.headerTitleGroup}>
          <div style={{ ...styles.iconBox, borderColor: isMeasuring ? '#FF1744' : 'rgba(0, 217, 255, 0.3)' }}>
            <Activity size={20} color={isMeasuring ? '#FF1744' : '#00D9FF'} className={isMeasuring ? 'animate-pulse' : ''} />
          </div>
          <div>
            <div style={styles.metaLabel}>REAL-TIME SAMPLING ENGINE</div>
            <h2 style={styles.cardTitle}>LIVE MEASUREMENT</h2>
          </div>
        </div>

        {/* Start / Stop Action Buttons */}
        <div>
          {!isMeasuring ? (
            <button
              type="button"
              className="btn-tech-primary"
              style={styles.startBtn}
              onClick={onStartMeasuring}
            >
              <Play size={16} color="#35F4FF" fill="#35F4FF" />
              <span>START MEASURING</span>
            </button>
          ) : (
            <button
              type="button"
              style={styles.stopBtn}
              onClick={onStopMeasuring}
            >
              <Square size={16} color="#FFFFFF" fill="#FFFFFF" />
              <span>STOP MEASURING</span>
            </button>
          )}
        </div>
      </div>

      {/* ACTIVE LIVE MEASUREMENT VIEW */}
      {isMeasuring && (
        <div style={styles.liveMeasuringBody}>
          {/* Live Indicator / Offline Banner */}
          {isOffline ? (
            <div style={styles.offlineBanner}>
              <div style={styles.offlineBannerTitle}>
                <span style={styles.offlinePulseDot} />
                <span>MEASUREMENT SERVER UNREACHABLE</span>
              </div>
              <div style={styles.offlineBannerSub}>
                {currentMeasurement?.offlineReason === 'MEASUREMENT_SERVER_UNREACHABLE'
                  ? 'Probe failed 3 times. Retrying the measurement server every ~1 second; session remains active.'
                  : 'Measurement unavailable; GPS coordinates continue to be recorded.'}
              </div>
            </div>
          ) : (
            <div style={styles.liveBanner}>
              <span style={styles.livePulseDot} />
              <span style={styles.liveBannerText}>MEASURING LIVE • SAMPLING EVERY ~1 SECOND</span>
              <span style={styles.samplesCountTag}>{measurementCount} SAMPLES</span>
            </div>
          )}

          {/* Prominent NQS Score Box (Primary Focus) */}
          <div style={{ ...styles.nqsHeroBox, borderColor: nqsColor }}>
            <div style={styles.nqsHeroHeader}>
              <span style={styles.nqsHeroLabel}>LIVE NQS SCORE</span>
              <div
                style={{
                  ...styles.statusBadge,
                  backgroundColor: `${nqsColor}18`,
                  color: nqsColor,
                  borderColor: `${nqsColor}40`
                }}
              >
                <CheckCircle2 size={13} color={nqsColor} />
                <span>{isOffline ? 'NO CONNECTIVITY' : status ?? 'WAITING FOR SAMPLE'}</span>
              </div>
            </div>

            <div style={styles.nqsBigNumberGroup}>
              <span style={{ ...styles.nqsBigNumber, color: nqsColor, textShadow: `0 0 24px ${nqsColor}60` }}>
                {isOffline ? 'OFFLINE' : status === 'UNAVAILABLE' ? 'N/A' : nqs ?? '—'}
              </span>
              {!isOffline && status !== 'UNAVAILABLE' && <span style={styles.nqsMaxLabel}>/100</span>}
            </div>

            {/* Prominent Coordinates & Accuracy readout */}
            {currentMeasurement && (
              <div style={styles.liveCoordsFooter}>
                <MapPin size={13} color="#00D9FF" />
                <span>
                  GPS: <strong>{currentMeasurement.latitude.toFixed(5)}° N, {currentMeasurement.longitude.toFixed(5)}° E</strong> (±{Math.round(currentMeasurement.accuracy)} m)
                </span>
              </div>
            )}
            {currentMeasurement && <div style={{ ...styles.liveCoordsFooter, marginTop: 4 }}>
              <span>{currentMeasurement.operator} · Live session sample · {new Date(currentMeasurement.timestamp).toLocaleString()}</span>
            </div>}
            {currentMeasurement && storageState && <div style={{ ...styles.liveCoordsFooter, marginTop: 4 }} role="status" aria-live="polite">
              <span>
                {storageState.status === 'score-ineligible' ? 'NQS: insufficient valid metrics' : storageState.status === 'persistence-ineligible' ? 'NQS eligible; sample not eligible for persistence' : `Storage: ${storageState.status === 'saved' ? 'saved to history' : storageState.status === 'pending' ? 'saving…' : storageState.status === 'failed' ? `save failed${storageState.error ? ` — ${storageState.error}` : ''}` : storageState.status === 'unknown' ? `save outcome unknown${storageState.error ? ` — ${storageState.error}` : ''}` : 'not eligible'}`}
              </span>
            </div>}
          </div>

          {/* "ⓘ Details" Interaction Toggle */}
          <div style={styles.detailsToggleRow}>
            <button
              type="button"
              style={styles.detailsToggleBtn}
              onClick={() => setShowDetails(!showDetails)}
            >
              <Info size={15} color="#00D9FF" />
              <span>ⓘ Details</span>
              {showDetails ? <ChevronUp size={16} color="#9DB4C8" /> : <ChevronDown size={16} color="#9DB4C8" />}
            </button>
          </div>

          {/* Detailed Raw Metrics Collapsible Section */}
          {showDetails && currentMeasurement && (
            <div style={styles.detailsGrid}>
              {/* Latency */}
              <div style={styles.detailTile}>
                <div style={styles.tileHeader}>
                  <Gauge size={14} color="#00D9FF" />
                  <span>LATENCY</span>
                </div>
                  <div style={styles.tileVal}>{!isOffline && currentMeasurement.metricAvailability?.latency === true ? `${currentMeasurement.latencyMs} ms` : 'N/A'}</div>
              </div>

              {/* Jitter */}
              <div style={styles.detailTile}>
                <div style={styles.tileHeader}>
                  <Activity size={14} color="#35F4FF" />
                  <span>JITTER</span>
                </div>
                  <div style={styles.tileVal}>{!isOffline && currentMeasurement.metricAvailability?.jitter === true ? `${currentMeasurement.jitterMs} ms` : 'N/A'}</div>
              </div>

              {/* Probe Failure Rate (HTTP Probe Loss) */}
              <div style={styles.detailTile}>
                <div style={styles.tileHeader}>
                  <ArrowDownUp size={14} color="#00E676" />
                  <span>HTTP PROBE FAILURE RATE</span>
                </div>
                <div style={styles.tileVal}>{currentMeasurement.metricAvailability?.probeFailure === true ? `${currentMeasurement.probeFailurePercent} %` : 'N/A'}</div>
              </div>

              {/* Download Throughput */}
              <div style={styles.detailTile}>
                <div style={styles.tileHeader}>
                  <Zap size={14} color="#00E676" />
                  <span>DOWNLOAD THROUGHPUT</span>
                </div>
                <div style={styles.tileVal}>{!isOffline && currentMeasurement.metricAvailability?.download === true ? `${currentMeasurement.downloadMbps} Mbps` : 'N/A'}</div>
              </div>

              <div style={styles.detailTile}>
                <div style={styles.tileHeader}><Zap size={14} color="#00E676" /><span>UPLOAD THROUGHPUT</span></div>
                <div style={styles.tileVal}>{!isOffline && currentMeasurement.metricAvailability?.upload === true ? `${currentMeasurement.uploadMbps} Mbps` : 'N/A'}</div>
              </div>

              {/* Signal Strength (Honest Browser Handling) */}
              <div style={{ ...styles.detailTile, gridColumn: 'span 2' }}>
                <div style={styles.tileHeader}>
                  <Signal size={14} color="#9DB4C8" />
                  <span>SIGNAL STRENGTH (RSRP / dBm)</span>
                </div>
                <div style={styles.tileValUnavailable}>
                  UNAVAILABLE <span style={styles.unavailableReason}>(Browsers do not expose raw Wi-Fi/cellular dBm)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SESSION SUMMARY VIEW (After Stopping) */}
      {!isMeasuring && sessionSummary && (
        <div style={styles.summaryContainer}>
          <div style={styles.summaryTitleRow}>
            <Award size={20} color="#00E676" />
            <div>
              <div style={styles.summarySubLabel}>MEASUREMENT COMPLETE</div>
              <h4 style={styles.summaryHeading}>SESSION SCAN SUMMARY</h4>
            </div>
          </div>

          {/* Session Overview Bar */}
          <div style={styles.summaryOverviewRow}>
            <div style={styles.summaryOverviewItem}>
              <span style={styles.summaryOverviewLabel}>Duration:</span>
              <span style={styles.summaryOverviewValue}>{formatDuration(sessionSummary.durationSeconds)}</span>
            </div>
            <div style={styles.summaryOverviewItem}>
              <span style={styles.summaryOverviewLabel}>Distance Travelled:</span>
              <span style={styles.summaryOverviewValue}>{formatDistance(sessionSummary.distanceMeters)}</span>
            </div>
            <div style={styles.summaryOverviewItem}>
              <span style={styles.summaryOverviewLabel}>Samples:</span>
              <span style={styles.summaryOverviewValue}>{sessionSummary.totalMeasurements}</span>
            </div>
          </div>

          <div style={styles.summarySpotsGrid}>
            {/* BEST NETWORK SPOT */}
            <div style={{ ...styles.spotCard, borderColor: 'rgba(0, 230, 118, 0.4)' }}>
              <div style={styles.spotCardHeader}>
                <Award size={16} color="#00E676" />
                <span style={{ ...styles.spotCardTitle, color: '#00E676' }}>BEST NETWORK SPOT</span>
              </div>

              {sessionSummary.bestSpot ? (
                <div style={styles.spotCardBody}>
                  <div style={styles.spotNqsRow}>
                    <span style={styles.spotNqsLabel}>NQS:</span>
                    <span style={{ ...styles.spotNqsVal, color: networkMeasurer.getNqsColor(sessionSummary.bestSpot.nqs) }}>
                      {sessionSummary.bestSpot.nqs}
                    </span>
                    <span
                      style={{
                        ...styles.qualityTag,
                        backgroundColor: `${networkMeasurer.getNqsColor(sessionSummary.bestSpot.nqs)}1A`,
                        color: networkMeasurer.getNqsColor(sessionSummary.bestSpot.nqs),
                        borderColor: `${networkMeasurer.getNqsColor(sessionSummary.bestSpot.nqs)}40`
                      }}
                    >
                      {sessionSummary.bestSpot.status}
                    </span>
                  </div>

                  <div style={styles.spotLocationRow}>
                    <MapPin size={13} color="#00D9FF" />
                    <span>
                      Location: <strong>{sessionSummary.bestSpot.latitude.toFixed(5)}° N, {sessionSummary.bestSpot.longitude.toFixed(5)}° E</strong>
                    </span>
                  </div>
                </div>
              ) : (
                <div style={styles.noSpotText}>No valid network measurement collected</div>
              )}
            </div>

            {/* WORST NETWORK SPOT */}
            <div style={{ ...styles.spotCard, borderColor: 'rgba(255, 23, 68, 0.4)' }}>
              <div style={styles.spotCardHeader}>
                <Activity size={16} color="#FF1744" />
                <span style={{ ...styles.spotCardTitle, color: '#FF1744' }}>WORST NETWORK SPOT</span>
              </div>

              {sessionSummary.worstSpot ? (
                <div style={styles.spotCardBody}>
                  <div style={styles.spotNqsRow}>
                    <span style={styles.spotNqsLabel}>NQS:</span>
                    <span style={{ ...styles.spotNqsVal, color: networkMeasurer.getNqsColor(sessionSummary.worstSpot.nqs) }}>
                      {sessionSummary.worstSpot.nqs}
                    </span>
                    <span
                      style={{
                        ...styles.qualityTag,
                        backgroundColor: `${networkMeasurer.getNqsColor(sessionSummary.worstSpot.nqs)}1A`,
                        color: networkMeasurer.getNqsColor(sessionSummary.worstSpot.nqs),
                        borderColor: `${networkMeasurer.getNqsColor(sessionSummary.worstSpot.nqs)}40`
                      }}
                    >
                      {sessionSummary.worstSpot.status}
                    </span>
                  </div>

                  <div style={styles.spotLocationRow}>
                    <MapPin size={13} color="#00D9FF" />
                    <span>
                      Location: <strong>{sessionSummary.worstSpot.latitude.toFixed(5)}° N, {sessionSummary.worstSpot.longitude.toFixed(5)}° E</strong>
                    </span>
                  </div>
                </div>
              ) : (
                <div style={styles.noSpotText}>No valid network measurement collected</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* IDLE VIEW (Before starting) */}
      {!isMeasuring && !sessionSummary && (
        <div style={styles.idleNotice}>
          <Activity size={24} color="#00D9FF" />
          <p style={styles.idleText}>
            Click <strong>Start Measuring</strong> to begin a live network-quality measurement session over Wi-Fi. Measurements will be collected every ~1 second and plotted directly on the campus map as you move.
          </p>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    padding: '24px',
    borderRadius: '16px',
    border: '1px solid rgba(0, 217, 255, 0.25)',
    backgroundColor: 'rgba(11, 26, 45, 0.85)',
    marginBottom: '24px'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: '16px',
    borderBottom: '1px solid rgba(0, 217, 255, 0.15)',
    flexWrap: 'wrap',
    gap: '12px'
  },
  headerTitleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  iconBox: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: 'rgba(0, 143, 209, 0.15)',
    border: '1px solid rgba(0, 217, 255, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  metaLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    fontWeight: 700,
    color: '#00D9FF',
    letterSpacing: '0.08em'
  },
  cardTitle: {
    fontSize: '1.25rem',
    fontWeight: 800,
    color: '#F5FAFF',
    margin: 0
  },
  startBtn: {
    padding: '10px 20px',
    fontSize: '0.88rem'
  },
  stopBtn: {
    backgroundColor: '#FF1744',
    color: '#FFFFFF',
    border: '1px solid #FF5252',
    padding: '10px 20px',
    borderRadius: '10px',
    fontWeight: 700,
    fontSize: '0.88rem',
    fontFamily: 'var(--font-mono)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 0 16px rgba(255, 23, 68, 0.5)'
  },
  liveMeasuringBody: {
    marginTop: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  liveBanner: {
    backgroundColor: 'rgba(5, 11, 22, 0.8)',
    border: '1px solid rgba(0, 230, 118, 0.3)',
    borderRadius: '8px',
    padding: '8px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    fontWeight: 700
  },
  livePulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#00E676',
    boxShadow: '0 0 10px #00E676',
    display: 'inline-block'
  },
  liveBannerText: {
    color: '#00E676',
    letterSpacing: '0.05em'
  },
  samplesCountTag: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    color: '#00E676',
    padding: '2px 8px',
    borderRadius: '4px'
  },
  nqsHeroBox: {
    backgroundColor: 'rgba(5, 11, 22, 0.9)',
    border: '2px solid',
    borderRadius: '14px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    boxShadow: 'inset 0 0 30px rgba(0,0,0,0.5)',
    transition: 'border-color 0.3s ease'
  },
  nqsHeroHeader: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px'
  },
  nqsHeroLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    fontWeight: 700,
    color: '#9DB4C8',
    letterSpacing: '0.08em'
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '9999px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    fontWeight: 800,
    border: '1px solid'
  },
  nqsBigNumberGroup: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    margin: '10px 0'
  },
  nqsBigNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: '4rem',
    fontWeight: 800,
    lineHeight: 1,
    transition: 'color 0.3s ease'
  },
  nqsMaxLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '1.2rem',
    color: '#60788C',
    fontWeight: 600
  },
  liveCoordsFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.78rem',
    color: '#9DB4C8',
    fontFamily: 'var(--font-mono)',
    marginTop: '6px'
  },
  detailsToggleRow: {
    display: 'flex',
    justifyContent: 'center'
  },
  detailsToggleBtn: {
    background: 'none',
    border: 'none',
    color: '#00D9FF',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 12px',
    borderRadius: '6px',
    backgroundColor: 'rgba(0, 217, 255, 0.08)'
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '10px',
    padding: '14px',
    borderRadius: '10px',
    backgroundColor: 'rgba(5, 11, 22, 0.6)',
    border: '1px solid rgba(0, 217, 255, 0.15)'
  },
  detailTile: {
    backgroundColor: 'rgba(8, 20, 38, 0.7)',
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid rgba(0, 217, 255, 0.1)'
  },
  tileHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.62rem',
    color: '#9DB4C8',
    fontWeight: 700,
    marginBottom: '4px'
  },
  tileVal: {
    fontFamily: 'var(--font-mono)',
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#F5FAFF'
  },
  unit: {
    fontSize: '0.7rem',
    color: '#60788C',
    fontWeight: 400
  },
  tileValUnavailable: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85rem',
    fontWeight: 700,
    color: '#FF9100'
  },
  unavailableReason: {
    fontSize: '0.68rem',
    fontWeight: 400,
    color: '#60788C',
    display: 'block',
    marginTop: '2px'
  },
  summaryContainer: {
    marginTop: '16px',
    padding: '20px',
    borderRadius: '14px',
    backgroundColor: 'rgba(5, 11, 22, 0.9)',
    border: '1px solid rgba(0, 230, 118, 0.35)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
  },
  summaryTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px'
  },
  summarySubLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    fontWeight: 800,
    color: '#00E676',
    letterSpacing: '0.12em'
  },
  summaryHeading: {
    fontFamily: 'var(--font-mono)',
    fontSize: '1.1rem',
    fontWeight: 900,
    color: '#F5FAFF',
    margin: 0,
    letterSpacing: '0.04em'
  },
  summaryOverviewRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(8, 20, 38, 0.85)',
    borderRadius: '10px',
    padding: '12px 16px',
    border: '1px solid rgba(0, 217, 255, 0.2)',
    marginBottom: '18px',
    flexWrap: 'wrap',
    gap: '12px'
  },
  summaryOverviewItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px'
  },
  summaryOverviewLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    color: '#60788C',
    fontWeight: 700,
    textTransform: 'uppercase'
  },
  summaryOverviewValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '1.25rem',
    fontWeight: 800,
    color: '#00D9FF'
  },
  summarySpotsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px'
  },
  spotCard: {
    backgroundColor: 'rgba(8, 20, 38, 0.85)',
    borderRadius: '12px',
    padding: '16px',
    border: '1px solid'
  },
  spotCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '12px',
    paddingBottom: '8px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
  },
  spotCardTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    fontWeight: 800,
    letterSpacing: '0.08em'
  },
  spotCardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  spotNqsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  spotNqsLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    color: '#9DB4C8',
    fontWeight: 700
  },
  spotNqsVal: {
    fontFamily: 'var(--font-mono)',
    fontSize: '2rem',
    fontWeight: 900,
    lineHeight: 1
  },
  qualityTag: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 10px',
    borderRadius: '9999px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    fontWeight: 800,
    border: '1px solid'
  },
  spotLocationRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.78rem',
    color: '#9DB4C8'
  },
  noSpotText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8rem',
    color: '#60788C',
    fontStyle: 'italic'
  },
  offlineBanner: {
    backgroundColor: 'rgba(255, 23, 68, 0.15)',
    border: '1px solid rgba(255, 23, 68, 0.5)',
    borderRadius: '10px',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  offlineBannerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.82rem',
    fontWeight: 800,
    color: '#FF1744'
  },
  offlinePulseDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#FF1744',
    boxShadow: '0 0 10px #FF1744',
    display: 'inline-block',
    animation: 'pulse 1s infinite'
  },
  offlineBannerSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    color: '#FF9100'
  },
  idleNotice: {
    marginTop: '16px',
    padding: '16px',
    borderRadius: '10px',
    backgroundColor: 'rgba(5, 11, 22, 0.5)',
    border: '1px dashed rgba(0, 217, 255, 0.2)',
    display: 'flex',
    alignItems: 'center',
    gap: '14px'
  },
  idleText: {
    fontSize: '0.85rem',
    color: '#9DB4C8',
    margin: 0,
    lineHeight: '1.5'
  }
};
