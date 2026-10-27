import React from 'react';
import { Radio, Wifi, Navigation, Activity } from 'lucide-react';

interface HeaderProps {
  activeTab?: string;
  onSelectTab?: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab = 'find', onSelectTab }) => {
  return (
    <header style={styles.header} className="site-header">
      <div style={styles.headerContainer} className="site-header-inner">
        {/* Brand Identity */}
        <div style={styles.brandGroup} className="site-brand">
          <div style={styles.logoIconBox}>
            <Radio size={22} color="#00D9FF" />
            <div style={styles.logoPulseRing} />
          </div>
          <div>
            <div style={styles.logoTitleGroup}>
              <span style={styles.logoTitle}>NETNAV</span>
              <span style={styles.versionBadge}>V2</span>
            </div>
            <p style={styles.logoSubtitle}>NETWORK-AWARE CAMPUS NAVIGATION • VIT VELLORE</p>
          </div>
        </div>

        {/* Technical Status Indicator */}
        <div style={styles.statusGroup} className="site-status">
          <div style={styles.statusIndicator}>
            <span style={styles.statusDot} />
            <span style={styles.statusText}>NETWORK QUALITY MONITOR</span>
          </div>
        </div>

        {/* UI Navigation Buttons */}
        <nav style={styles.navGroup} className="site-nav" aria-label="Main navigation">
          <button
            style={{
              ...styles.navBtn,
              ...(activeTab === 'find' ? styles.navBtnActive : {})
            }}
            onClick={() => onSelectTab?.('find')}
            type="button"
            aria-pressed={activeTab === 'find'}
            aria-label="Find Best Spot"
          >
            <Wifi size={16} />
            <span>Find Best Spot</span>
          </button>
          
          <button
            style={{
              ...styles.navBtn,
              ...(activeTab === 'nav' ? styles.navBtnActive : {})
            }}
            onClick={() => onSelectTab?.('nav')}
            type="button"
            aria-pressed={activeTab === 'nav'}
            aria-label="Start Navigation"
          >
            <Navigation size={16} />
            <span>Start Navigation</span>
          </button>

          <button
            style={{
              ...styles.navBtn,
              ...(activeTab === 'measure' ? styles.navBtnActive : {})
            }}
            onClick={() => onSelectTab?.('measure')}
            type="button"
            aria-pressed={activeTab === 'measure'}
            aria-label="Start Measuring"
          >
            <Activity size={16} />
            <span>Start Measuring</span>
          </button>
        </nav>
      </div>
    </header>
  );
};

const styles: Record<string, React.CSSProperties> = {
  header: {
    width: '100%',
    backgroundColor: 'rgba(8, 20, 38, 0.85)',
    backdropFilter: 'blur(16px)',
    borderBottom: '1px solid rgba(0, 217, 255, 0.15)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    padding: '12px 24px'
  },
  headerContainer: {
    maxWidth: '1400px',
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '20px',
    flexWrap: 'wrap'
  },
  brandGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px'
  },
  logoIconBox: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: 'rgba(0, 143, 209, 0.15)',
    border: '1px solid rgba(0, 217, 255, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  logoPulseRing: {
    position: 'absolute',
    inset: '-2px',
    borderRadius: '12px',
    border: '1px solid rgba(53, 244, 255, 0.3)',
    pointerEvents: 'none'
  },
  logoTitleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  logoTitle: {
    fontFamily: 'var(--font-sans)',
    fontWeight: 800,
    fontSize: '1.4rem',
    letterSpacing: '0.08em',
    color: '#F5FAFF',
    background: 'linear-gradient(135deg, #FFFFFF 0%, #00D9FF 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent'
  },
  versionBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: 'rgba(0, 217, 255, 0.12)',
    color: '#00D9FF',
    border: '1px solid rgba(0, 217, 255, 0.3)'
  },
  logoSubtitle: {
    fontSize: '0.7rem',
    fontFamily: 'var(--font-mono)',
    color: '#60788C',
    letterSpacing: '0.06em',
    marginTop: '2px'
  },
  statusGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 12px',
    borderRadius: '9999px',
    backgroundColor: 'rgba(11, 26, 45, 0.6)',
    border: '1px solid rgba(0, 217, 255, 0.2)'
  },
  statusDot: {
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    backgroundColor: '#00E676',
    boxShadow: '0 0 8px #00E676'
  },
  statusText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#9DB4C8',
    letterSpacing: '0.05em'
  },
  navGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  navBtn: {
    backgroundColor: 'transparent',
    color: '#9DB4C8',
    border: '1px solid transparent',
    padding: '8px 14px',
    borderRadius: '8px',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease'
  },
  navBtnActive: {
    backgroundColor: 'rgba(0, 143, 209, 0.18)',
    color: '#35F4FF',
    borderColor: 'rgba(0, 217, 255, 0.4)',
    boxShadow: '0 0 12px rgba(0, 217, 255, 0.2)'
  }
};
