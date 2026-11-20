import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomEventDto } from '@planner/shared';
import { resolveCustomEventColor } from '../lib/color.ts';
import { requestErrorMessage } from '../lib/customEventForm.ts';
import { describeSchedule } from '../lib/customEventFormat.ts';
import { usePlanner } from '../state/PlannerContext.tsx';
import { DeleteCustomEventDialog } from './DeleteCustomEventDialog.tsx';
import { Dialog } from './Dialog.tsx';
import { IconPencil, IconTrash } from './icons.tsx';

/** Every event in one list, including ones outside the visible calendar range. */
export function ManageEventsDialog({ onClose, onEdit }: { onClose: () => void; onEdit: (event: CustomEventDto) => void }) {
  const { t, i18n } = useTranslation();
  const planner = usePlanner();
  const [deleting, setDeleting] = useState<CustomEventDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...planner.customEvents].sort((a, b) => a.title.localeCompare(b.title, i18n.language)),
    [planner.customEvents, i18n.language],
  );

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await planner.deleteCustomEvent(deleting.id);
      setDeleting(null);
    } catch (err) {
      setError(requestErrorMessage(t, err));
    }
    setBusy(false);
  }

  // Replaces the list instead of stacking on it, so Escape closes one dialog at a time
  if (deleting) {
    return (
      <DeleteCustomEventDialog
        eventTitle={deleting.title}
        recurring={deleting.schedule.kind === 'weekly'}
        busy={busy}
        error={error}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setDeleting(null);
          setError(null);
        }}
      />
    );
  }

  return (
    <Dialog onClose={onClose} className="dialog-wide">
      <h2>{t('customEvents.manage.title')}</h2>
      {sorted.length === 0 ? (
        <p className="hint">{t('customEvents.manage.empty')}</p>
      ) : (
        <div className="program-list">
          {sorted.map((event) => (
            <div key={event.id} className="program-row">
              <span className="event-dot" style={{ background: resolveCustomEventColor(event, planner.eventLabels) }} />
              <div className="event-row-main">
                <div className="event-row-title">{event.title}</div>
                <div className="hint">{describeSchedule(event.schedule, t, i18n.language)}</div>
              </div>
              <button
                className="icon-btn"
                aria-label={t('customEvents.manage.editAria', { name: event.title })}
                title={t('customEvents.edit')}
                onClick={() => onEdit(event)}
              >
                <IconPencil />
              </button>
              <button
                className="icon-btn"
                aria-label={t('customEvents.manage.deleteAria', { name: event.title })}
                title={t('customEvents.delete.action')}
                onClick={() => setDeleting(event)}
              >
                <IconTrash />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          {t('customEvents.close')}
        </button>
      </div>
    </Dialog>
  );
}
