import type { FormEvent } from 'react';
import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EventLabelDto } from '@planner/shared';
import { eventLabelInputSchema, MAX_LABEL_NAME_LENGTH } from '@planner/shared';
import { DEFAULT_CUSTOM_EVENT_COLOR, EVENT_COLOR_PRESETS } from '../lib/color.ts';
import { issueMessage, requestErrorMessage } from '../lib/customEventForm.ts';
import { usePlanner } from '../state/PlannerContext.tsx';
import { ColorSwatches } from './ColorSwatches.tsx';
import { Dialog } from './Dialog.tsx';

/** Create (initial null) or edit an event label. */
export function LabelDialog({ initial, onClose }: { initial: EventLabelDto | null; onClose: () => void }) {
  const { t } = useTranslation();
  const planner = usePlanner();
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial?.name ?? '');
  // New labels cycle through the presets so they start out distinguishable
  const [color, setColor] = useState(
    initial?.color ?? EVENT_COLOR_PRESETS[planner.eventLabels.length % EVENT_COLOR_PRESETS.length] ?? DEFAULT_CUSTOM_EVENT_COLOR,
  );
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parsed = useMemo(() => eventLabelInputSchema.safeParse({ name, color }), [name, color]);
  const nameIssue = parsed.success ? undefined : parsed.error.issues.find((issue) => issue.path[0] === 'name');
  const nameError = touched && nameIssue ? issueMessage(t, nameIssue.message) : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!parsed.success) {
      setTouched(true);
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (initial) await planner.updateEventLabel(initial.id, parsed.data);
      else await planner.createEventLabel(parsed.data);
      onClose();
    } catch (error) {
      setSaveError(requestErrorMessage(t, error));
      setSaving(false);
    }
  }

  return (
    <Dialog onClose={onClose}>
      <form noValidate onSubmit={(e) => void submit(e)}>
        <h2>{initial ? t('eventLabels.edit') : t('eventLabels.new')}</h2>
        <div className="field">
          <label htmlFor={nameId}>{t('eventLabels.name')}</label>
          <input
            ref={nameRef}
            id={nameId}
            type="text"
            autoComplete="off"
            autoFocus
            maxLength={MAX_LABEL_NAME_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={nameError !== undefined}
            aria-describedby={nameError ? `${nameId}-error` : undefined}
          />
          {nameError && (
            <div id={`${nameId}-error`} className="error-text">
              {nameError}
            </div>
          )}
        </div>
        <ColorSwatches label={t('eventLabels.color')} value={color} onChange={(next) => next !== null && setColor(next)} />
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
