import { useTranslation } from 'react-i18next';
import { MAX_EVENT_SLOTS, MAX_RECURRENCE_INTERVAL_WEEKS } from '@planner/shared';
import { weekdayNames } from '../lib/customEventFormat.ts';
import type { EventFormState, ScheduleKind } from '../lib/customEventForm.ts';
import { addSlot, effectiveExceptions, setStartDate, switchKind } from '../lib/customEventForm.ts';
import type { FieldCtl } from './customEventFields.tsx';
import { fieldAttrs, FieldError, TextField } from './customEventFields.tsx';
import { IconPlus, IconTrash } from './icons.tsx';

const KINDS: ScheduleKind[] = ['once', 'allDay', 'weekly'];

type Update = (change: (s: EventFormState) => EventFormState) => void;

function SlotRows({ state, update, ctl }: { state: EventFormState; update: Update; ctl: FieldCtl }) {
  const { t, i18n } = useTranslation();
  const names = weekdayNames(i18n.language).long;

  function patchSlot(index: number, patch: Partial<EventFormState['slots'][number]>) {
    update((s) => ({ ...s, slots: s.slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)) }));
  }

  return (
    <div className="field slot-list">
      <span className="field-label">{t('customEvents.field.slots')}</span>
      {state.slots.map((slot, index) => {
        const weekdayKey = `slot.${index}.weekday`;
        const startKey = `slot.${index}.startTime`;
        const endKey = `slot.${index}.endTime`;
        return (
          // Slots have no identity of their own; rows are positional
          <div key={index}>
            <div className="slot-row">
              <select
                {...fieldAttrs(ctl, weekdayKey)}
                aria-label={t('customEvents.slot.weekday')}
                value={slot.weekday}
                onChange={(e) => {
                  patchSlot(index, { weekday: Number(e.target.value) });
                  ctl.touch(weekdayKey);
                }}
              >
                {names.map((name, i) => (
                  <option key={i} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                {...fieldAttrs(ctl, startKey)}
                type="time"
                aria-label={t('customEvents.slot.startTime')}
                value={slot.startTime}
                onChange={(e) => {
                  patchSlot(index, { startTime: e.target.value });
                  ctl.touch(startKey);
                }}
              />
              <input
                {...fieldAttrs(ctl, endKey)}
                type="time"
                aria-label={t('customEvents.slot.endTime')}
                value={slot.endTime}
                onChange={(e) => {
                  patchSlot(index, { endTime: e.target.value });
                  ctl.touch(endKey);
                }}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={t('customEvents.slot.remove')}
                title={t('customEvents.slot.remove')}
                disabled={state.slots.length <= 1}
                onClick={() => update((s) => ({ ...s, slots: s.slots.filter((_, i) => i !== index) }))}
              >
                <IconTrash />
              </button>
            </div>
            <FieldError ctl={ctl} field={weekdayKey} />
            <FieldError ctl={ctl} field={startKey} />
            <FieldError ctl={ctl} field={endKey} />
          </div>
        );
      })}
      <FieldError ctl={ctl} field="slots" />
      <div>
        <button type="button" className="btn" disabled={state.slots.length >= MAX_EVENT_SLOTS} onClick={() => update(addSlot)}>
          <IconPlus /> {t('customEvents.addSlot')}
        </button>
      </div>
    </div>
  );
}

function WeeklyFields({ state, update, ctl }: { state: EventFormState; update: Update; ctl: FieldCtl }) {
  const { t } = useTranslation();
  const skipped = effectiveExceptions(state).length;
  const untilAttrs = fieldAttrs(ctl, 'untilDate');
  return (
    <>
      <div className="field-row">
        <TextField
          ctl={ctl}
          field="startDate"
          type="date"
          label={t('customEvents.field.startDate')}
          value={state.startDate}
          onChange={(startDate) => update((s) => setStartDate(s, startDate))}
        />
        <div className="field">
          <label htmlFor={untilAttrs.id}>{t('customEvents.field.untilDate')}</label>
          <div className="input-action-row">
            <input
              {...untilAttrs}
              type="date"
              value={state.untilDate}
              onChange={(e) => {
                update((s) => ({ ...s, untilDate: e.target.value }));
                ctl.touch('untilDate');
              }}
            />
            {state.untilDate !== '' && (
              <button type="button" className="text-btn" onClick={() => update((s) => ({ ...s, untilDate: '' }))}>
                {t('customEvents.clearDate')}
              </button>
            )}
          </div>
          <FieldError ctl={ctl} field="untilDate" />
        </div>
      </div>
      <div className="field">
        <label htmlFor={ctl.idFor('interval')}>{t('customEvents.field.interval')}</label>
        <select
          id={ctl.idFor('interval')}
          value={state.intervalWeeks}
          onChange={(e) => update((s) => ({ ...s, intervalWeeks: Number(e.target.value) }))}
        >
          {Array.from({ length: MAX_RECURRENCE_INTERVAL_WEEKS }, (_, i) => i + 1).map((weeks) => (
            <option key={weeks} value={weeks}>
              {t('customEvents.weeks', { count: weeks })}
            </option>
          ))}
        </select>
      </div>
      <SlotRows state={state} update={update} ctl={ctl} />
      {skipped > 0 && (
        <p className="hint">
          {t('customEvents.skippedDates', { count: skipped })}{' '}
          <button type="button" className="text-btn" onClick={() => update((s) => ({ ...s, exceptions: [] }))}>
            {t('customEvents.restoreAll')}
          </button>
        </p>
      )}
      <FieldError ctl={ctl} field="exceptions" />
    </>
  );
}

/** Schedule type switch and the inputs of the selected type. */
export function ScheduleFields({ state, update, ctl }: { state: EventFormState; update: Update; ctl: FieldCtl }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="field">
        <span className="field-label">{t('customEvents.field.type')}</span>
        <div className="segmented segmented-full" role="group" aria-label={t('customEvents.field.type')}>
          {KINDS.map((kind) => (
            <button key={kind} type="button" aria-pressed={state.kind === kind} onClick={() => update((s) => switchKind(s, kind))}>
              {t(`customEvents.type.${kind}`)}
            </button>
          ))}
        </div>
      </div>

      {state.kind === 'once' && (
        <>
          <div className="field-row">
            <TextField
              ctl={ctl}
              field="startDate"
              type="date"
              label={t('customEvents.field.startDate')}
              value={state.startDate}
              onChange={(startDate) => update((s) => setStartDate(s, startDate))}
            />
            <TextField
              ctl={ctl}
              field="startTime"
              type="time"
              label={t('customEvents.field.startTime')}
              value={state.startTime}
              onChange={(startTime) => update((s) => ({ ...s, startTime }))}
            />
          </div>
          <div className="field-row">
            <TextField
              ctl={ctl}
              field="endDate"
              type="date"
              label={t('customEvents.field.endDate')}
              value={state.endDate}
              onChange={(endDate) => update((s) => ({ ...s, endDate }))}
            />
            <TextField
              ctl={ctl}
              field="endTime"
              type="time"
              label={t('customEvents.field.endTime')}
              value={state.endTime}
              onChange={(endTime) => update((s) => ({ ...s, endTime }))}
            />
          </div>
        </>
      )}

      {state.kind === 'allDay' && (
        <div className="field-row">
          <TextField
            ctl={ctl}
            field="startDate"
            type="date"
            label={t('customEvents.field.startDate')}
            value={state.startDate}
            onChange={(startDate) => update((s) => setStartDate(s, startDate))}
          />
          <TextField
            ctl={ctl}
            field="endDate"
            type="date"
            label={t('customEvents.field.endDate')}
            value={state.endDate}
            onChange={(endDate) => update((s) => ({ ...s, endDate }))}
          />
        </div>
      )}

      {state.kind === 'weekly' && <WeeklyFields state={state} update={update} ctl={ctl} />}
    </>
  );
}
