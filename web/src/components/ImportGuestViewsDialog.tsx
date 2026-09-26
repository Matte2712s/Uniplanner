import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlanner } from '../state/PlannerContext.tsx';
import { Dialog } from './Dialog.tsx';

export function ImportGuestViewsDialog({ count }: { count: number }) {
  const { t } = useTranslation();
  const planner = usePlanner();
  const [busy, setBusy] = useState(false);

  return (
    <Dialog onClose={planner.skipImport}>
      <h2>{t('import.title')}</h2>
      <p>{t('import.description', { count })}</p>
      <div className="dialog-actions">
        <button className="btn" onClick={planner.skipImport} disabled={busy}>
          {t('import.skip')}
        </button>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await planner.confirmImport();
            setBusy(false);
          }}
        >
          {t('import.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
