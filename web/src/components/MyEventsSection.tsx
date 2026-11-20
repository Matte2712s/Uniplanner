import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EventLabelDto, ViewSettings } from '@planner/shared';
import { isHexColor } from '../lib/color.ts';
import { usePlanner } from '../state/PlannerContext.tsx';
import { DeleteEventLabelDialog } from './DeleteEventLabelDialog.tsx';
import { ErrorDialog } from './ErrorDialog.tsx';
import { IconPencil, IconTrash } from './icons.tsx';
import { LabelDialog } from './LabelDialog.tsx';

/** Sidebar section: event entry points, the visibility switches and the label list. */
export function MyEventsSection({
  settings,
  onNewEvent,
  onManageEvents,
}: {
  settings: ViewSettings;
  onNewEvent: () => void;
  onManageEvents: () => void;
}) {
  const { t } = useTranslation();
  const planner = usePlanner();
  const [labelDialog, setLabelDialog] = useState<{ initial: EventLabelDto | null } | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<EventLabelDto | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const { show, hiddenLabels } = settings.customEvents;

  // Server failures surface in the themed error dialog
  async function reportFailure(action: () => Promise<unknown>) {
    try {
      await action();
    } catch {
      setActionFailed(true);
    }
  }

  function updateEventSettings(patch: Partial<ViewSettings['customEvents']>) {
    void reportFailure(() => planner.updateActiveViewSettings({ ...settings, customEvents: { ...settings.customEvents, ...patch } }));
  }

  function setLabelVisible(id: number, visible: boolean) {
    const rest = hiddenLabels.filter((hidden) => hidden !== id);
    updateEventSettings({ hiddenLabels: visible ? rest : [...rest, id] });
  }

  async function confirmDeleteLabel() {
    if (!deletingLabel) return;
    await reportFailure(() => planner.deleteEventLabel(deletingLabel.id));
    setDeletingLabel(null);
  }

  return (
    <>
      <div className="section-title">{t('sidebar.myEvents')}</div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" style={{ flex: 1 }} onClick={onNewEvent} disabled={planner.customEventsAtLimit}>
          + {t('customEvents.new')}
        </button>
        <button className="btn" onClick={onManageEvents}>
          {t('customEvents.manage.action')}
        </button>
      </div>
      {planner.customEventsAtLimit && <p className="hint">{t('customEvents.limitReached')}</p>}

      <label className="checkbox-row" style={{ margin: '10px 0 4px' }}>
        <input type="checkbox" checked={show} onChange={(e) => updateEventSettings({ show: e.target.checked })} />
        {t('customEvents.show')}
      </label>

      {planner.eventLabels.map((label) => (
        <div key={label.id} className="label-row">
          <label className="checkbox-row">
            <input type="checkbox" checked={!hiddenLabels.includes(label.id)} onChange={(e) => setLabelVisible(label.id, e.target.checked)} />
            {isHexColor(label.color) && <span className="legend-swatch" style={{ background: label.color }} />}
            <span className="label-name">{label.name}</span>
          </label>
          <button
            className="icon-btn icon-btn-sm"
            aria-label={t('eventLabels.editAria', { name: label.name })}
            title={t('eventLabels.edit')}
            onClick={() => setLabelDialog({ initial: label })}
          >
            <IconPencil />
          </button>
          <button
            className="icon-btn icon-btn-sm"
            aria-label={t('eventLabels.deleteAria', { name: label.name })}
            title={t('eventLabels.delete')}
            onClick={() => setDeletingLabel(label)}
          >
            <IconTrash />
          </button>
        </div>
      ))}

      <button className="btn" style={{ marginTop: 6 }} onClick={() => setLabelDialog({ initial: null })} disabled={planner.labelsAtLimit}>
        + {t('eventLabels.new')}
      </button>
      {planner.labelsAtLimit && <p className="hint">{t('eventLabels.limitReached')}</p>}

      {labelDialog && <LabelDialog initial={labelDialog.initial} onClose={() => setLabelDialog(null)} />}
      {deletingLabel && (
        <DeleteEventLabelDialog
          labelName={deletingLabel.name}
          onCancel={() => setDeletingLabel(null)}
          onConfirm={() => void confirmDeleteLabel()}
        />
      )}
      {actionFailed && <ErrorDialog onClose={() => setActionFailed(false)} />}
    </>
  );
}
