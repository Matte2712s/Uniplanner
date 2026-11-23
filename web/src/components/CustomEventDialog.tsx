import type { FormEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomEventDto } from '@planner/shared';
import { MAX_EVENT_LOCATION_LENGTH, MAX_EVENT_NOTES_LENGTH, MAX_EVENT_TITLE_LENGTH, MAX_EVENT_URL_LENGTH } from '@planner/shared';
import { browserTimeZone } from '../lib/customEventFormat.ts';
import type { CustomEventDraft, EventFormState } from '../lib/customEventForm.ts';
import { hasUnplacedError, initialFormState, requestErrorMessage, validateForm } from '../lib/customEventForm.ts';
import { usePlanner } from '../state/PlannerContext.tsx';
import { ColorSwatches } from './ColorSwatches.tsx';
import type { FieldCtl } from './customEventFields.tsx';
import { FieldError, TextField } from './customEventFields.tsx';
import { Dialog } from './Dialog.tsx';
import { ScheduleFields } from './ScheduleFields.tsx';

/** Create (initial null) or edit an event; `draft` prefills a new one. */
export function CustomEventDialog({
  initial,
  draft,
  onClose,
  onSaved,
}: {
  initial: CustomEventDto | null;
  draft?: CustomEventDraft;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const planner = usePlanner();
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<EventFormState>(() => initialFormState(initial ?? draft, planner.eventLabels));
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const zone = useMemo(browserTimeZone, []);

  const validation = useMemo(() => validateForm(state), [state]);

  const ctl: FieldCtl = {
    idFor: (key) => `${prefix}-${key.replace(/\./g, '-')}`,
    error: (key) => (attempted || touched.has(key) ? validation.errors.get(key) : undefined),
    touch: (key) => setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key))),
  };

  // Runs after the submit attempt has rendered, so the invalid fields are marked
  useEffect(() => {
    if (focusRequest > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  function patch(change: Partial<EventFormState>) {
    setState((s) => ({ ...s, ...change }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!validation.data) {
      setAttempted(true);
      setFocusRequest((n) => n + 1);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (initial) await planner.updateCustomEvent(initial.id, validation.data);
      else await planner.createCustomEvent(validation.data);
      onSaved?.();
      onClose();
    } catch (error) {
      setSaveError(requestErrorMessage(t, error));
      setSaving(false);
    }
  }

  const labelId = ctl.idFor('labelId');

  return (
    <Dialog onClose={onClose} className="dialog-wide" closeButton>
      <form ref={formRef} noValidate onSubmit={(e) => void submit(e)}>
        <h2>{initial ? t('customEvents.dialog.editTitle') : t('customEvents.dialog.newTitle')}</h2>

        <TextField
          ctl={ctl}
          field="title"
          label={t('customEvents.field.title')}
          value={state.title}
          maxLength={MAX_EVENT_TITLE_LENGTH}
          autoFocus={!initial}
          onChange={(title) => patch({ title })}
        />

        <ScheduleFields state={state} update={setState} ctl={ctl} />
        {state.timeZone !== zone && <p className="hint">{t('customEvents.timeZoneHint', { tz: state.timeZone })}</p>}
        <FieldError ctl={ctl} field="timeZone" />

        <div className="field">
          <label htmlFor={labelId}>{t('customEvents.field.label')}</label>
          <select
            id={labelId}
            value={state.labelId ?? ''}
            onChange={(e) => patch({ labelId: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">{t('customEvents.noLabel')}</option>
            {planner.eventLabels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
          <FieldError ctl={ctl} field="labelId" />
        </div>

        <ColorSwatches
          label={t('customEvents.field.color')}
          value={state.color}
          onChange={(color) => patch({ color })}
          noneLabel={t('customEvents.color.useLabel')}
        />
        <FieldError ctl={ctl} field="color" />

        <TextField
          ctl={ctl}
          field="location"
          label={t('customEvents.field.location')}
          value={state.location}
          maxLength={MAX_EVENT_LOCATION_LENGTH}
          onChange={(location) => patch({ location })}
        />
        <TextField
          ctl={ctl}
          field="url"
          type="url"
          label={t('customEvents.field.url')}
          value={state.url}
          maxLength={MAX_EVENT_URL_LENGTH}
          onChange={(url) => patch({ url })}
        />
        <TextField
          ctl={ctl}
          field="notes"
          multiline
          label={t('customEvents.field.notes')}
          value={state.notes}
          maxLength={MAX_EVENT_NOTES_LENGTH}
          onChange={(notes) => patch({ notes })}
        />

        {attempted && hasUnplacedError(validation.errors) && <div className="error-text">{t('customEvents.error.generic')}</div>}
        {saveError && (
          <div className="error-text" role="alert">
            {saveError}
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('customEvents.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {t('customEvents.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
