import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.tsx';

export function DeleteSourceDialog({
  sourceName,
  onConfirm,
  onCancel,
}: {
  sourceName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog onClose={onCancel}>
      <h2>{t('deleteSource.title', { name: sourceName })}</h2>
      <p className="hint">{t('deleteSource.warning')}</p>
      <div className="dialog-actions">
        <button className="btn" onClick={onCancel}>
          {t('deleteSource.cancel')}
        </button>
        <button className="btn btn-danger" onClick={onConfirm}>
          {t('deleteSource.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
