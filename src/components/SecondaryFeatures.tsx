import React from 'react';
import { Navigation, Activity, ArrowRight, Route, ShieldAlert, Sparkles } from 'lucide-react';

interface SecondaryFeaturesProps {
  onNavigationClick?: () => void;
  onMeasuringClick?: () => void;
}

export const SecondaryFeatures: React.FC<SecondaryFeaturesProps> = ({
  onNavigationClick,
  onMeasuringClick
}) => {
  return (
    <div style={styles.sectionContainer} className="secondary-feature-section">
      <div style={styles.sectionHeader}>
        <div style={styles.sectionTag}>
          <Sparkles size={13} color="#00D9FF" />
          <span>SECONDARY ENGINE SUITE</span>
        </div>
        <h3 style={styles.sectionTitle}>EXTENDED NETWORK TOOLS</h3>
      </div>

      <div style={styles.cardsGrid} className="secondary-feature-grid">
        {/* START NAVIGATION Feature Card */}
        <div style={styles.featureCard} className="glass-panel glass-panel-hover tech-corners">
          <div style={styles.cardHeader}>
            <div style={styles.iconBoxNav}>
              <Navigation size={22} color="#00D9FF" />
            </div>
            <div style={styles.badgeV2}>V2 MODULE</div>
          </div>

          <h4 style={styles.cardTitle}>START NAVIGATION</h4>
          
          <p style={styles.cardDesc}>
            Find a route optimized for network quality across campus buildings, pathways, and study hubs.
          </p>

          <div style={styles.featureList}>
            <div style={styles.featureItem}>
              <Route size={14} color="#00D9FF" />
              <span>Network-Weighted Dijkstra Pathfinding</span>
            </div>
            <div style={styles.featureItem}>
              <ShieldAlert size={14} color="#9DB4C8" />
              <span>Avoid Campus Dead-Zones & Cell Drops</span>
            </div>
          </div>

          <button
            type="button"
            className="btn-tech-secondary"
            style={styles.actionBtn}
            onClick={onNavigationClick}
          >
            <span>START NAVIGATION</span>
            <ArrowRight size={16} color="#00D9FF" />
          </button>
        </div>

        {/* START MEASURING Feature Card */}
        <div style={styles.featureCard} className="glass-panel glass-panel-hover tech-corners">
          <div style={styles.cardHeader}>
            <div style={styles.iconBoxMeasure}>
              <Activity size={22} color="#35F4FF" />
            </div>
            <div style={styles.badgeV2}>CONTRIBUTE</div>
          </div>

          <h4 style={styles.cardTitle}>START MEASURING</h4>
          
          <p style={styles.cardDesc}>
            Measure network quality in real-time as you move around campus and help improve the NETNAV map.
          </p>

          <div style={styles.featureList}>
            <div style={styles.featureItem}>
              <Activity size={14} color="#35F4FF" />
              <span>Real-Time Downlink, Uplink & Jitter Sampling</span>
            </div>
            <div style={styles.featureItem}>
              <Sparkles size={14} color="#9DB4C8" />
              <span>Crowdsourced Spatial Network Heatmaps</span>
            </div>
          </div>

          <button
            type="button"
            className="btn-tech-secondary"
            style={styles.actionBtn}
            onClick={onMeasuringClick}
          >
            <span>START MEASURING</span>
            <ArrowRight size={16} color="#35F4FF" />
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  sectionContainer: {
    width: '100%',
    maxWidth: '1400px',
    margin: '0 auto 40px'
  },
  sectionHeader: {
    marginBottom: '20px'
  },
  sectionTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.68rem',
    fontWeight: 700,
    color: '#00D9FF',
    letterSpacing: '0.08em',
    marginBottom: '4px'
  },
  sectionTitle: {
    fontSize: '1.2rem',
    fontWeight: 800,
    color: '#F5FAFF',
    margin: 0
  },
  cardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '24px'
  },
  featureCard: {
    padding: '24px',
    borderRadius: '16px',
    border: '1px solid rgba(0, 217, 255, 0.2)',
    backgroundColor: 'rgba(11, 26, 45, 0.75)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px'
  },
  iconBoxNav: {
    width: '42px',
    height: '42px',
    borderRadius: '10px',
    backgroundColor: 'rgba(0, 143, 209, 0.15)',
    border: '1px solid rgba(0, 217, 255, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconBoxMeasure: {
    width: '42px',
    height: '42px',
    borderRadius: '10px',
    backgroundColor: 'rgba(53, 244, 255, 0.15)',
    border: '1px solid rgba(53, 244, 255, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  badgeV2: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: '4px',
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
    color: '#9DB4C8',
    border: '1px solid rgba(0, 217, 255, 0.2)'
  },
  cardTitle: {
    fontSize: '1.2rem',
    fontWeight: 800,
    color: '#F5FAFF',
    marginBottom: '8px'
  },
  cardDesc: {
    fontSize: '0.9rem',
    color: '#9DB4C8',
    lineHeight: '1.5',
    marginBottom: '18px'
  },
  featureList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '24px',
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: 'rgba(5, 11, 22, 0.5)',
    border: '1px solid rgba(0, 217, 255, 0.1)'
  },
  featureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '0.78rem',
    color: '#9DB4C8'
  },
  actionBtn: {
    width: '100%',
    justifyContent: 'center',
    padding: '12px 20px',
    fontSize: '0.9rem',
    fontWeight: 600
  }
};
