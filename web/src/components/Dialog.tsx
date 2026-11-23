import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX } from './icons.tsx';

export function Dialog({
  onClose,
  className,
  closeButton,
  children,
}: {
  onClose: () => void;
  className?: string;
  // Corner X, for long dialogs whose own buttons scroll out of view
  closeButton?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  // A drag that starts in a field and ends on the backdrop must not close the dialog
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={className ? `dialog ${className}` : 'dialog'}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {closeButton && (
          <button
            type="button"
            className="icon-btn dialog-close"
            aria-label={t('dialog.close')}
            title={t('dialog.close')}
            onClick={onClose}
          >
            <IconX width={16} height={16} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
