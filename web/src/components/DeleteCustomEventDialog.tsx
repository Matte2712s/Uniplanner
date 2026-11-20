import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.tsx';

export function DeleteCustomEventDialog({
  eventTitle,
  recurring,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  eventTitle: string;
  recurring: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog onClose={onCancel}>
      <h2>{t('customEvents.delete.title', { name: eventTitle })}</h2>
      {recurring && <p className="hint">{t('customEvents.delete.seriesWarning')}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={onCancel} disabled={busy}>
          {t('customEvents.cancel')}
        </button>
        <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {t('customEvents.delete.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
