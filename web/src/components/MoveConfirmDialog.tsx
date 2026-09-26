import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.tsx';

export function MoveConfirmDialog({
  itemName,
  targetName,
  onConfirm,
  onCancel,
}: {
  itemName: string;
  targetName: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog onClose={onCancel}>
      <h2>{t('moveConfirm.title')}</h2>
      <p>{targetName ? t('moveConfirm.intoFolder', { item: itemName, folder: targetName }) : t('moveConfirm.toRoot', { item: itemName })}</p>
      <div className="dialog-actions">
        <button className="btn" onClick={onCancel}>
          {t('moveConfirm.cancel')}
        </button>
        <button className="btn btn-primary" onClick={onConfirm}>
          {t('moveConfirm.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
