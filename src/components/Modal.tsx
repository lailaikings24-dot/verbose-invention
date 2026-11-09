import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 17 }}>{title}</h2>
          <div className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="col" style={{ gap: 14 }}>
          {children}
        </div>
        {footer && <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}
