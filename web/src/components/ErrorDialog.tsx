import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.tsx';

export function ErrorDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog onClose={onClose}>
      <h2>{t('errorDialog.title')}</h2>
      <p className="hint">{t('error.generic')}</p>
      <div className="dialog-actions">
        <button className="btn btn-primary" autoFocus onClick={onClose}>
          {t('errorDialog.close')}
        </button>
      </div>
    </Dialog>
  );
}
