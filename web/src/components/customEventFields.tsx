import { useTranslation } from 'react-i18next';
import { issueMessage } from '../lib/customEventForm.ts';

// What every field of the event form needs from the dialog that owns the state
export interface FieldCtl {
  idFor(key: string): string;
  // Issue code to show for the field, or undefined while it is still untouched
  error(key: string): string | undefined;
  touch(key: string): void;
}

/** Shared a11y wiring: id, validity and the link to the error text. */
export function fieldAttrs(ctl: FieldCtl, key: string) {
  const id = ctl.idFor(key);
  const invalid = ctl.error(key) !== undefined;
  return {
    id,
    'aria-invalid': invalid,
    'aria-describedby': invalid ? `${id}-error` : undefined,
    onBlur: () => ctl.touch(key),
  };
}

export function FieldError({ ctl, field }: { ctl: FieldCtl; field: string }) {
  const { t } = useTranslation();
  const code = ctl.error(field);
  if (code === undefined) return null;
  return (
    <div id={`${ctl.idFor(field)}-error`} className="error-text">
      {issueMessage(t, code)}
    </div>
  );
}

/** Labeled single-line or multi-line input with its error text. */
export function TextField({
  ctl,
  field,
  label,
  type = 'text',
  value,
  onChange,
  maxLength,
  autoFocus,
  multiline,
}: {
  ctl: FieldCtl;
  field: string;
  label: string;
  type?: 'text' | 'url' | 'date' | 'time';
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  autoFocus?: boolean;
  multiline?: boolean;
}) {
  const attrs = fieldAttrs(ctl, field);
  // Pickers have no typing phase, so a change is already a finished edit
  const touchOnChange = type === 'date' || type === 'time';
  const handleChange = (next: string) => {
    onChange(next);
    if (touchOnChange) ctl.touch(field);
  };
  return (
    <div className="field">
      <label htmlFor={attrs.id}>{label}</label>
      {multiline ? (
        <textarea {...attrs} value={value} maxLength={maxLength} onChange={(e) => handleChange(e.target.value)} />
      ) : (
        <input
          {...attrs}
          type={type}
          value={value}
          maxLength={maxLength}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(e) => handleChange(e.target.value)}
        />
      )}
      <FieldError ctl={ctl} field={field} />
    </div>
  );
}
