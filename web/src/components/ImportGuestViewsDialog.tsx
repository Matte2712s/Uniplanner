import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlanner } from '../state/PlannerContext.tsx';
import { Dialog } from './Dialog.tsx';

export function ImportGuestViewsDialog({ count }: { count: number }) {
  const { t } = useTranslation();
  const planner = usePlanner();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // The import covers labels and events too, so any step can fail
  async function handleConfirm() {
    setBusy(true);
    setFailed(false);
    try {
      await planner.confirmImport();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onClose={planner.skipImport}>
      <h2>{t('import.title')}</h2>
      <p>{t('import.description', { count })}</p>
      {failed && (
        <p className="error-text" role="alert">
          {t('import.error')}
        </p>
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={planner.skipImport} disabled={busy}>
          {t('import.skip')}
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void handleConfirm()}>
          {t('import.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
