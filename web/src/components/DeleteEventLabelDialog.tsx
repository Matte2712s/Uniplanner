import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.tsx';

export function DeleteEventLabelDialog({
  labelName,
  onConfirm,
  onCancel,
}: {
  labelName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog onClose={onCancel}>
      <h2>{t('eventLabels.deleteTitle', { name: labelName })}</h2>
      <p className="hint">{t('eventLabels.deleteWarning')}</p>
      <div className="dialog-actions">
        <button className="btn" onClick={onCancel}>
          {t('customEvents.cancel')}
        </button>
        <button className="btn btn-danger" onClick={onConfirm}>
          {t('customEvents.delete.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
