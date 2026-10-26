import React from 'react';
import { Radio, ShieldCheck } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer style={styles.footer}>
      <div style={styles.container}>
        <div style={styles.brandRow}>
          <Radio size={16} color="#00D9FF" />
          
          <span style={styles.dot}>•</span>
          <span style={styles.subtext}>Network-Aware Campus Navigation</span>
        </div>

        <div style={styles.rightRow}>
          <div style={styles.statusPill}>
            <ShieldCheck size={13} color="#00E676" />
            <span>VIT VELLORE CAMPUS SPECTRUM MODEL</span>
          </div>
          <span style={styles.copyright}>UI FOUNDATION VERSION 1</span>
        </div>
      </div>
    </footer>
  );
};

const styles: Record<string, React.CSSProperties> = {
  footer: {
    width: '100%',
    backgroundColor: 'rgba(5, 11, 22, 0.95)',
    borderTop: '1px solid rgba(0, 217, 255, 0.15)',
    padding: '20px 24px',
    marginTop: 'auto'
  },
  container: {
    maxWidth: '1400px',
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '16px'
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  brandName: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85rem',
    fontWeight: 700,
    color: '#F5FAFF',
    letterSpacing: '0.06em'
  },
  dot: {
    color: '#60788C'
  },
  subtext: {
    fontSize: '0.8rem',
    color: '#9DB4C8'
  },
  rightRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  statusPill: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    color: '#9DB4C8',
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid rgba(0, 217, 255, 0.2)'
  },
  copyright: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    color: '#60788C'
  }
};
