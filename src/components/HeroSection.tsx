import React, { useState } from 'react';
import type { TelecomOperator } from '../types';
import { OPERATORS } from '../data/mockData';
import { Zap, Signal, ChevronDown, Sparkles, MapPin } from 'lucide-react';

interface HeroSectionProps {
  selectedOperator: TelecomOperator;
  onSelectOperator: (op: TelecomOperator) => void;
  onFindBestSpotClick: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  selectedOperator,
  onSelectOperator,
  onFindBestSpotClick
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const currentOp = OPERATORS.find(o => o.id === selectedOperator) || OPERATORS[0];

  return (
    <section style={styles.heroContainer} className="hero-responsive">
      <div style={styles.heroGridBackground} />
      
      <div style={styles.heroContent} className="hero-content">
        {/* Top Tagline */}
        <div style={styles.heroPill}>
          <Sparkles size={14} color="#35F4FF" />
          <span>PRIMARY ENGINE • FIND BEST SPOT</span>
        </div>

        <h1 style={styles.heroTitle}>
          FIND BEST SPOT
        </h1>

        <p style={styles.heroSubtitle}>
          Find the strongest network quality near you across VIT Vellore campus.
        </p>

        {/* Operator Select & Trigger Form Card */}
        <div style={styles.actionCard} className="glass-panel hero-action-card">
          <div style={styles.formRow} className="hero-form-row">
            {/* Operator Selection Dropdown */}
            <div style={styles.inputGroup} className="hero-input-group">
              <label style={styles.label}>
                <Signal size={14} color="#00D9FF" />
                <span>SELECT NETWORK</span>
              </label>

              <div style={styles.selectWrapper}>
                <button
                  type="button"
                  style={styles.selectButton}
                  onClick={() => setIsOpen(!isOpen)}
                  aria-expanded={isOpen}
                  aria-haspopup="listbox"
                  aria-label={`Select network operator, current: ${currentOp.name}`}
                >
                  <div style={styles.selectedOperatorValue}>
                    <span
                      style={{
                        ...styles.operatorDot,
                        backgroundColor: currentOp.color,
                        boxShadow: `0 0 8px ${currentOp.color}`
                      }}
                    />
                    <span style={styles.operatorTextName}>{currentOp.name}</span>
                    <span style={styles.operatorBadge}>{currentOp.badge}</span>
                  </div>
                  <ChevronDown
                    size={18}
                    color="#9DB4C8"
                    style={{
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s ease'
                    }}
                  />
                </button>

                {/* Dropdown Options */}
                {isOpen && (
                  <div style={styles.dropdownMenu} className="glass-panel" role="listbox" aria-label="Network operators">
                    {OPERATORS.map((op) => (
                      <button
                        type="button"
                        key={op.id}
                        style={{
                          ...styles.dropdownOption,
                          border: 0,
                          width: '100%',
                          backgroundColor:
                            op.id === selectedOperator
                              ? 'rgba(0, 217, 255, 0.12)'
                              : 'transparent'
                        }}
                        onClick={() => {
                          onSelectOperator(op.id);
                          setIsOpen(false);
                        }}
                        role="option"
                        aria-selected={op.id === selectedOperator}
                      >
                        <div style={styles.opInfoLeft}>
                          <span
                            style={{
                              ...styles.operatorDot,
                              backgroundColor: op.color
                            }}
                          />
                          <span style={styles.opOptionName}>{op.name}</span>
                        </div>
                        <span style={styles.opOptionBadge}>{op.badge}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Primary Action Button */}
            <div style={styles.buttonGroup} className="hero-button-group">
              <label style={styles.labelHidden}>ACTION</label>
              <button
                type="button"
                style={styles.mainCtaBtn}
                className="btn-tech-primary hero-cta"
                onClick={onFindBestSpotClick}
              >
                <Zap size={20} color="#35F4FF" />
                <span>FIND BEST SPOT</span>
              </button>
            </div>
          </div>

          {/* Quick Context Footer inside Hero */}
          <div style={styles.heroCardFooter} className="hero-card-footer">
            <div style={styles.footerInfoItem}>
              <MapPin size={13} color="#9DB4C8" />
              <span>Location: <strong>Main Building Lawn (VIT Vellore)</strong></span>
            </div>
            <div style={styles.footerInfoItem}>
              <span style={styles.tagDot} />
              <span>Target: <strong>Maximum Throughput & Latency Score</strong></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  heroContainer: {
    position: 'relative',
    padding: '40px 24px 32px',
    maxWidth: '1400px',
    margin: '0 auto',
    width: '100%'
  },
  heroGridBackground: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse at center, rgba(0, 143, 209, 0.08) 0%, transparent 70%)',
    pointerEvents: 'none',
    zIndex: -1
  },
  heroContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '16px'
  },
  heroPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 14px',
    borderRadius: '9999px',
    backgroundColor: 'rgba(0, 217, 255, 0.08)',
    border: '1px solid rgba(0, 217, 255, 0.25)',
    fontSize: '0.75rem',
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    color: '#35F4FF',
    letterSpacing: '0.08em'
  },
  heroTitle: {
    fontSize: '2.75rem',
    fontWeight: 800,
    letterSpacing: '0.04em',
    color: '#F5FAFF',
    textShadow: '0 0 30px rgba(0, 217, 255, 0.25)',
    margin: 0
  },
  heroSubtitle: {
    fontSize: '1.1rem',
    color: '#9DB4C8',
    maxWidth: '640px',
    lineHeight: '1.6',
    margin: '0 0 12px'
  },
  actionCard: {
    width: '100%',
    maxWidth: '840px',
    padding: '24px',
    borderRadius: '16px',
    border: '1px solid rgba(0, 217, 255, 0.3)',
    boxShadow: '0 12px 40px rgba(5, 11, 22, 0.8), 0 0 20px rgba(0, 217, 255, 0.15)',
    position: 'relative'
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '16px',
    alignItems: 'flex-end',
    width: '100%'
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    textAlign: 'left'
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    fontWeight: 700,
    color: '#00D9FF',
    letterSpacing: '0.06em'
  },
  labelHidden: {
    visibility: 'hidden',
    fontSize: '0.75rem'
  },
  selectWrapper: {
    position: 'relative',
    width: '100%'
  },
  selectButton: {
    width: '100%',
    backgroundColor: '#081426',
    border: '1px solid rgba(0, 217, 255, 0.3)',
    borderRadius: '10px',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    color: '#F5FAFF',
    transition: 'all 0.2s ease'
  },
  selectedOperatorValue: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  operatorDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block'
  },
  operatorTextName: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: '#F5FAFF'
  },
  operatorBadge: {
    fontSize: '0.7rem',
    fontFamily: 'var(--font-mono)',
    padding: '2px 8px',
    borderRadius: '4px',
    backgroundColor: 'rgba(0, 217, 255, 0.15)',
    color: '#00D9FF'
  },
  dropdownMenu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    backgroundColor: '#0B1A2D',
    border: '1px solid rgba(0, 217, 255, 0.4)',
    borderRadius: '10px',
    overflow: 'hidden',
    zIndex: 50,
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6)'
  },
  dropdownOption: {
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    transition: 'background 0.15s ease'
  },
  opInfoLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  opOptionName: {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: '#F5FAFF'
  },
  opOptionBadge: {
    fontSize: '0.7rem',
    fontFamily: 'var(--font-mono)',
    color: '#9DB4C8'
  },
  buttonGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  mainCtaBtn: {
    height: '46px',
    padding: '0 28px',
    whiteSpace: 'nowrap'
  },
  heroCardFooter: {
    marginTop: '18px',
    paddingTop: '14px',
    borderTop: '1px solid rgba(0, 217, 255, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: '0.78rem',
    color: '#9DB4C8',
    flexWrap: 'wrap',
    gap: '10px'
  },
  footerInfoItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  tagDot: {
    width: '5px',
    height: '5px',
    borderRadius: '50%',
    backgroundColor: '#35F4FF'
  }
};
