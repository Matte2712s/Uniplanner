import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.tsx';

export function DeleteFolderDialog({
  folderName,
  subfolderCount,
  sourceCount,
  onConfirm,
  onCancel,
}: {
  folderName: string;
  subfolderCount: number;
  sourceCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog onClose={onCancel}>
      <h2>{t('deleteFolder.title', { name: folderName })}</h2>
      {subfolderCount > 0 && <p className="hint">{t('deleteFolder.subfoldersWarning', { count: subfolderCount })}</p>}
      {sourceCount > 0 && <p className="hint">{t('deleteFolder.sourcesWarning', { count: sourceCount })}</p>}
      <div className="dialog-actions">
        <button className="btn" onClick={onCancel}>
          {t('deleteFolder.cancel')}
        </button>
        <button className="btn btn-danger" onClick={onConfirm}>
          {t('deleteFolder.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
