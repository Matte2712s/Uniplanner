import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_CUSTOM_SOURCES_PER_USER } from '@planner/shared';
import { api } from '../api/client.ts';
import { usePlanner } from '../state/PlannerContext.tsx';
import { Dialog } from './Dialog.tsx';
import { IconCheck } from './icons.tsx';

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'valid'; title: string }
  | { status: 'invalid'; messageKey: string };

export function AddSourceDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (sourceId: number) => void }) {
  const { t } = useTranslation();
  const planner = usePlanner();
  const [url, setUrl] = useState('');
  const [check, setCheck] = useState<CheckState>({ status: 'idle' });
  const [adding, setAdding] = useState(false);
  const [addingProgram, setAddingProgram] = useState<string | null>(null);

  const atLimit = planner.sources.custom.length >= MAX_CUSTOM_SOURCES_PER_USER;

  async function handleAddProgram(program: string) {
    setAddingProgram(program);
    try {
      await planner.addProgram(program);
    } finally {
      setAddingProgram(null);
    }
  }

  async function handleCheck() {
    setCheck({ status: 'checking' });
    const result = await api.validateSource(url);
    if (result.ok) {
      setCheck({ status: 'valid', title: result.title });
    } else {
      const reason = 'reason' in result.error ? result.error.reason : undefined;
      const key = reason ? `error.url.${reason}` : 'error.generic';
      setCheck({ status: 'invalid', messageKey: key });
    }
  }

  async function handleAdd() {
    setAdding(true);
    try {
      const result = await api.addSource(url);
      if (result.ok) {
        planner.addCustomSource(result.source);
        const settings = planner.activeView?.settings;
        if (settings && !settings.sources.some((s) => s.sourceId === result.source.id)) {
          await planner.updateActiveViewSettings({
            ...settings,
            sources: [...settings.sources, { sourceId: result.source.id, courseMode: 'exclude', courses: [] }],
          });
        }
        onAdded(result.source.id);
        onClose();
      } else {
        setCheck({ status: 'invalid', messageKey: 'error.generic' });
      }
    } finally {
      setAdding(false);
    }
  }

  return (
    <Dialog onClose={onClose}>
      <h2>{t('addSource.title')}</h2>

      {planner.programs.length > 0 && (
        <>
          <div className="dialog-section-title">{t('addSource.programsTitle')}</div>
          <div className="program-list">
            {planner.programs.map((p) => (
              <div className="program-row" key={p.program}>
                <span className="name">{p.program}</span>
                {p.added ? (
                  <span className="program-added">
                    <IconCheck /> {t('addSource.programAdded')}
                  </span>
                ) : (
                  <button className="btn" onClick={() => void handleAddProgram(p.program)} disabled={addingProgram === p.program}>
                    {t('addSource.programAdd')}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="dialog-divider" />
        </>
      )}

      <p className="hint">{t('addSource.description')}</p>
      {atLimit ? (
        <p className="error-text">{t('addSource.limitReached')}</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="source-url">{t('addSource.urlLabel')}</label>
            <input
              id="source-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setCheck({ status: 'idle' });
              }}
              placeholder="https://unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=..."
            />
          </div>
          {check.status === 'checking' && (
            <p className="hint">
              <span className="spinner" /> {t('addSource.checking')}
            </p>
          )}
          {check.status === 'valid' && <p className="hint">{t('addSource.valid', { title: check.title })}</p>}
          {check.status === 'invalid' && <p className="error-text">{t(check.messageKey)}</p>}
        </>
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          {t('addSource.cancel')}
        </button>
        {check.status === 'valid' ? (
          <button className="btn btn-primary" onClick={handleAdd} disabled={adding || atLimit}>
            {t('addSource.add')}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={handleCheck} disabled={!url || check.status === 'checking' || atLimit}>
            {t('addSource.validate')}
          </button>
        )}
      </div>
    </Dialog>
  );
}
