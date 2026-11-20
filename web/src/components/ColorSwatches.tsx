import type { KeyboardEvent } from 'react';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_CUSTOM_EVENT_COLOR, EVENT_COLOR_PRESETS, readableTextColor } from '../lib/color.ts';
import { IconCheck } from './icons.tsx';

/**
 * Preset swatches as a radiogroup plus a native picker for any other color.
 * With `noneLabel`, a leading option selects `null` (e.g. "use the label color").
 */
export function ColorSwatches({
  label,
  value,
  onChange,
  noneLabel,
}: {
  label: string;
  value: string | null;
  onChange: (color: string | null) => void;
  noneLabel?: string;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const options: (string | null)[] = noneLabel === undefined ? [...EVENT_COLOR_PRESETS] : [null, ...EVENT_COLOR_PRESETS];
  const normalized = value?.toLowerCase() ?? null;
  const selectedIndex = options.findIndex((option) => option === normalized);
  const isCustom = normalized !== null && selectedIndex === -1;
  // Roving tab stop: one stop for the whole group
  const tabStop = selectedIndex === -1 ? 0 : selectedIndex;

  function onKeyDown(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const current = buttons.current.findIndex((button) => button === document.activeElement);
    const next = (Math.max(current, 0) + step + options.length) % options.length;
    onChange(options[next] ?? null);
    buttons.current[next]?.focus();
  }

  return (
    <div className="field">
      <span className="field-label" id={labelId}>
        {label}
      </span>
      <div className="color-picker">
        <div className="color-swatches" role="radiogroup" aria-labelledby={labelId} onKeyDown={onKeyDown}>
          {options.map((option, index) => {
            const checked = index === selectedIndex;
            const name = option ?? noneLabel ?? '';
            return (
              <button
                key={option ?? 'none'}
                ref={(el) => {
                  buttons.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={name}
                title={name}
                tabIndex={index === tabStop ? 0 : -1}
                className={option === null ? 'color-swatch color-swatch-none' : 'color-swatch'}
                style={option === null ? undefined : { background: option, color: readableTextColor(option) }}
                onClick={() => onChange(option)}
              >
                {checked && <IconCheck width={16} height={16} strokeWidth={2} />}
              </button>
            );
          })}
        </div>
        <label className={isCustom ? 'color-custom selected' : 'color-custom'}>
          <input type="color" value={normalized ?? DEFAULT_CUSTOM_EVENT_COLOR} onChange={(e) => onChange(e.target.value)} />
          <span>{t('customEvents.color.custom')}</span>
        </label>
      </div>
    </div>
  );
}
