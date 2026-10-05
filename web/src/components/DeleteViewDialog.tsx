import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.tsx';

export function DeleteViewDialog({
  viewName,
  onConfirm,
  onCancel,
}: {
  viewName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog onClose={onCancel}>
      <h2>{t('deleteView.title', { name: viewName })}</h2>
      <div className="dialog-actions">
        <button className="btn" onClick={onCancel}>
          {t('deleteView.cancel')}
        </button>
        <button className="btn btn-danger" onClick={onConfirm}>
          {t('deleteView.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
