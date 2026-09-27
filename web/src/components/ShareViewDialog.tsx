import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { View } from '@planner/shared';
import { usePlanner } from '../state/PlannerContext.tsx';
import { Dialog } from './Dialog.tsx';

export function ShareViewDialog({ view, onClose }: { view: View; onClose: () => void }) {
  const { t } = useTranslation();
  const planner = usePlanner();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const link = view.shareToken ? `${window.location.origin}/shared/${view.shareToken}` : null;

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context): the link is
      // still visible and selectable in the input, so this just no-ops.
    }
  }

  return (
    <Dialog onClose={onClose}>
      <h2>{t('share.title')}</h2>
      <p className="hint">{t('share.description')}</p>

      {link ? (
        <>
          <div className="field">
            <label htmlFor="share-link">{t('share.linkLabel')}</label>
            <div className="share-link-row">
              <input id="share-link" type="text" readOnly value={link} onFocus={(e) => e.target.select()} />
              <button className="btn" onClick={() => void copyLink()}>
                {copied ? t('share.copied') : t('share.copy')}
              </button>
            </div>
          </div>
          <div className="dialog-actions">
            <button className="btn btn-danger" disabled={busy} onClick={() => void withBusy(() => planner.unshareView(view.id))}>
              {t('share.revoke')}
            </button>
            <button className="btn" disabled={busy} onClick={() => void withBusy(() => planner.shareView(view.id))}>
              {t('share.regenerate')}
            </button>
          </div>
        </>
      ) : (
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            {t('share.cancel')}
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void withBusy(() => planner.shareView(view.id))}>
            {t('share.create')}
          </button>
        </div>
      )}
    </Dialog>
  );
}
