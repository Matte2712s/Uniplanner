import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomEventOccurrence, EventLabelDto } from '@planner/shared';
import { parseHttpsUrl } from '@planner/shared';
import { isHexColor, resolveCustomEventColor } from '../lib/color.ts';
import { requestErrorMessage } from '../lib/customEventForm.ts';
import { browserTimeZone, describeSchedule, formatOccurrence } from '../lib/customEventFormat.ts';
import { usePlanner } from '../state/PlannerContext.tsx';
import type { CalendarCustomEvent } from './CalendarView.tsx';
import { DeleteCustomEventDialog } from './DeleteCustomEventDialog.tsx';
import { Dialog } from './Dialog.tsx';

// Only the signed-in or guest app has a PlannerProvider, so everything that
// needs it lives in these two components and the shared page never mounts them.

function OwnerActions({
  event,
  occurrence,
  onEdit,
  onDuplicate,
  onDelete,
  onClose,
}: {
  event: CalendarCustomEvent;
  occurrence: CustomEventOccurrence;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const planner = usePlanner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function skip() {
    setBusy(true);
    setError(null);
    try {
      await planner.skipOccurrence(event.id, occurrence.date);
      onClose();
    } catch (err) {
      setError(requestErrorMessage(t, err));
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="btn btn-danger" disabled={busy} onClick={onDelete}>
          {t('customEvents.delete.action')}
        </button>
        {event.schedule.kind === 'weekly' && (
          <button className="btn" disabled={busy} onClick={() => void skip()}>
            {t('customEvents.skipDate')}
          </button>
        )}
        <button className="btn" disabled={busy} onClick={onDuplicate}>
          {t('customEvents.duplicate')}
        </button>
        <button className="btn" disabled={busy} onClick={onClose}>
          {t('customEvents.close')}
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={onEdit}>
          {t('customEvents.edit')}
        </button>
      </div>
    </>
  );
}

function OwnerDeleteConfirm({
  event,
  onDeleted,
  onCancel,
}: {
  event: CalendarCustomEvent;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const planner = usePlanner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await planner.deleteCustomEvent(event.id);
      onDeleted();
    } catch (err) {
      setError(requestErrorMessage(t, err));
      setBusy(false);
    }
  }

  return (
    <DeleteCustomEventDialog
      eventTitle={event.title}
      recurring={event.schedule.kind === 'weekly'}
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
    />
  );
}

export function CustomEventDetail({
  event,
  occurrence,
  labels,
  readOnly,
  onEdit,
  onDuplicate,
  onClose,
}: {
  event: CalendarCustomEvent;
  occurrence: CustomEventOccurrence;
  labels: readonly EventLabelDto[];
  readOnly?: boolean;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Replaces the detail instead of stacking on it, so Escape closes one dialog at a time
  if (confirmingDelete && !readOnly) {
    return <OwnerDeleteConfirm event={event} onDeleted={onClose} onCancel={() => setConfirmingDelete(false)} />;
  }

  const label = event.labelId === null ? undefined : labels.find((l) => l.id === event.labelId);
  const color = resolveCustomEventColor(event, labels);
  // Defense in depth: the schema already restricts links to https
  const href = event.url ? parseHttpsUrl(event.url) : null;

  return (
    <Dialog onClose={onClose}>
      <h2>
        <span className="event-dot" style={{ background: color }} />
        {event.title}
      </h2>
      <p className="hint">{formatOccurrence(occurrence, i18n.language)}</p>

      {label && isHexColor(label.color) && (
        <div className="event-badges">
          <span className="event-badge">
            <span className="legend-swatch" style={{ background: label.color }} />
            {label.name}
          </span>
        </div>
      )}

      {event.schedule.kind === 'weekly' && (
        <div className="field">
          <label>{t('customEvents.field.schedule')}</label>
          <div>{describeSchedule(event.schedule, t, i18n.language)}</div>
          {event.timeZone !== browserTimeZone() && <div className="hint">{t('customEvents.timeZoneHint', { tz: event.timeZone })}</div>}
        </div>
      )}

      {event.location && (
        <div className="field">
          <label>{t('customEvents.field.location')}</label>
          <div>{event.location}</div>
        </div>
      )}

      {href && (
        <div className="field">
          <label>{t('customEvents.field.url')}</label>
          <div>
            <a href={href} target="_blank" rel="noopener noreferrer">
              {new URL(href).hostname}
            </a>
          </div>
        </div>
      )}

      {event.notes && (
        <div className="field">
          <label>{t('customEvents.field.notes')}</label>
          <div className="event-notes">{event.notes}</div>
        </div>
      )}

      {readOnly ? (
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            {t('customEvents.close')}
          </button>
        </div>
      ) : (
        <OwnerActions
          event={event}
          occurrence={occurrence}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onDelete={() => setConfirmingDelete(true)}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}
