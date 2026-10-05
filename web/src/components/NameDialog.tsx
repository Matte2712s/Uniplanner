import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog.tsx';

export function NameDialog({
  title,
  label,
  initialValue = '',
  maxLength,
  validate,
  invalidMessage,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  initialValue?: string;
  maxLength: number;
  validate?: (name: string) => boolean;
  invalidMessage?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const name = value.trim();
  const invalid = name !== '' && validate != null && !validate(name);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (name && !invalid) onSubmit(name);
  }

  return (
    <Dialog onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <h2>{title}</h2>
        <div className="field">
          <label htmlFor="name-dialog-input">{label}</label>
          <input
            id="name-dialog-input"
            type="text"
            autoComplete="off"
            autoFocus
            maxLength={maxLength}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            aria-invalid={invalid}
          />
          {invalid && invalidMessage && <div className="error-text">{invalidMessage}</div>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t('nameDialog.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name || invalid}>
            {t('nameDialog.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
