import React, { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Badge, Button, type BadgeTone } from './primitives';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  className?: string;
  closeOnBackdrop?: boolean;
}

interface OverlayInternalProps extends OverlayProps {
  surface: 'modal' | 'sheet';
}

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const OverlaySurface: React.FC<OverlayInternalProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel = 'بستن پنجره',
  className,
  closeOnBackdrop = true,
  surface,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const focusFrame = window.requestAnimationFrame(() => panel?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="ds-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description != null ? descriptionId : undefined}
        tabIndex={-1}
        className={[`ds-dialog`, surface === 'sheet' ? 'ds-bottom-sheet' : '', className || ''].filter(Boolean).join(' ')}
      >
        <header className="ds-dialog__header">
          <div className="ds-dialog__heading">
            <h2 id={titleId} className="ds-dialog__title">{title}</h2>
            {description != null && <p id={descriptionId} className="ds-dialog__description">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel} startIcon={<X size={19} />} />
        </header>
        <div className="ds-dialog__body">{children}</div>
        {footer != null && <footer className="ds-dialog__footer">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
};

export const Modal: React.FC<OverlayProps> = (props) => <OverlaySurface {...props} surface="modal" />;
export const BottomSheet: React.FC<OverlayProps> = (props) => <OverlaySurface {...props} surface="sheet" />;

export type ToastTone = 'info' | 'success' | 'warning' | 'error';
export interface ToastProps {
  open: boolean;
  message: ReactNode;
  title?: ReactNode;
  tone?: ToastTone;
  action?: ReactNode;
  onClose: () => void;
  className?: string;
}

const toneToBadge: Record<ToastTone, BadgeTone> = {
  info: 'primary',
  success: 'success',
  warning: 'warning',
  error: 'danger',
};

export const Toast: React.FC<ToastProps> = ({ open, message, title, tone = 'info', action, onClose, className }) => {
  if (!open) return null;
  return (
    <div
      className={[`ds-status-toast`, tone === 'success' ? 'ds-status-toast--success' : '', tone === 'warning' ? 'ds-status-toast--warning' : '', tone === 'error' ? 'ds-status-toast--error' : '', className || ''].filter(Boolean).join(' ')}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <div className="min-w-0 flex-1">
        {title != null && <div className="mb-1 font-bold">{title}</div>}
        <div className="ds-status-toast__content">{message}</div>
        {action != null && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={toneToBadge[tone]}>{tone === 'success' ? 'موفق' : tone === 'warning' ? 'توجه' : tone === 'error' ? 'خطا' : 'اطلاع'}</Badge>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="بستن پیام" startIcon={<X size={17} />} />
      </div>
    </div>
  );
};
