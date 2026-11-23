import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.tsx';

// The generic message unless the caller knows what went wrong
export function ErrorDialog({ message, onClose }: { message?: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog onClose={onClose}>
      <h2>{t('errorDialog.title')}</h2>
      <p className="hint">{message ?? t('error.generic')}</p>
      <div className="dialog-actions">
        <button className="btn btn-primary" autoFocus onClick={onClose}>
          {t('errorDialog.close')}
        </button>
      </div>
    </Dialog>
  );
}
