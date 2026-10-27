import React, { useEffect, useRef } from 'react';

interface AccessibleDialogProps {
  title: string;
  onClose?: () => void;
  closeOnEscape?: boolean;
  children: React.ReactNode;
}

export const AccessibleDialog: React.FC<AccessibleDialogProps> = ({ title, onClose, closeOnEscape = true, children }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [];
    (focusable()[0] ?? dialog)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) { event.preventDefault(); onCloseRef.current?.(); return; }
      if (event.key !== 'Tab') return;
      const items = [...focusable()];
      if (!items.length) { event.preventDefault(); dialog?.focus(); return; }
      const first = items[0], last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); previousFocusRef.current?.focus(); };
  }, [closeOnEscape]);

  return <div style={styles.backdrop}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="netnav-dialog-title" tabIndex={-1} style={styles.dialog}>
      <h2 id="netnav-dialog-title" style={styles.title}>{title}</h2>
      {children}
    </div>
  </div>;
};

const styles: Record<string, React.CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(2,7,15,.86)', backdropFilter: 'blur(8px)' },
  dialog: { width: 'min(100%, 520px)', maxHeight: 'min(90vh, 760px)', overflowY: 'auto', padding: 24, borderRadius: 16, border: '1px solid rgba(0,217,255,.4)', background: '#0B1A2D', color: '#F5FAFF', boxShadow: '0 24px 80px rgba(0,0,0,.65)', outline: 'none' },
  title: { margin: '0 0 14px', fontSize: '1.2rem', color: '#35F4FF' }
};
