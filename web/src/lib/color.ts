import type { EventLabelDto } from '@planner/shared';
import { hexColorSchema } from '@planner/shared';

// Deterministic, accessible color per course key, overridable per view.
const HUE_STEP = 47; // spreads hues before they start repeating

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Fixed at a mid lightness so white event text (see CalendarView) is
// always legible on it regardless of hue.
export function colorForCourse(courseKey: string, overrides: Record<string, string>): string {
  const override = overrides[courseKey];
  if (override) return override;
  const hue = (hashString(courseKey) * HUE_STEP) % 360;
  return `hsl(${hue} 62% 42%)`;
}

// Custom events

export const isHexColor = (value: unknown): value is string => hexColorSchema.safeParse(value).success;

// Distinct hues, all dark enough for white text (WCAG contrast of about 4.9 or more)
export const EVENT_COLOR_PRESETS: readonly string[] = [
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#0f766e',
  '#0369a1',
  '#1d4ed8',
  '#6d28d9',
  '#be185d',
  '#475569',
];

// Close to the app accent
export const DEFAULT_CUSTOM_EVENT_COLOR = '#b91c1c';

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#1a1a1a';

function linearChannel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

// WCAG relative luminance of a #rrggbb color
function relativeLuminance(hex: string): number {
  const channel = (offset: number) => linearChannel(Number.parseInt(hex.slice(offset, offset + 2), 16));
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const DARK_TEXT_LUMINANCE = relativeLuminance(DARK_TEXT);

/** White or near-black, whichever contrasts more with the given #rrggbb background. */
export function readableTextColor(hex: string): string {
  if (!isHexColor(hex)) return LIGHT_TEXT;
  const luminance = relativeLuminance(hex);
  const againstLight = 1.05 / (luminance + 0.05);
  const againstDark = (luminance + 0.05) / (DARK_TEXT_LUMINANCE + 0.05);
  return againstLight >= againstDark ? LIGHT_TEXT : DARK_TEXT;
}

/** Own color, else the label's, else the default. Anything that is not a valid hex is ignored. */
export function resolveCustomEventColor(
  event: { color: string | null; labelId: number | null },
  labels: readonly EventLabelDto[],
): string {
  if (isHexColor(event.color)) return event.color;
  const label = event.labelId === null ? undefined : labels.find((l) => l.id === event.labelId);
  if (label && isHexColor(label.color)) return label.color;
  return DEFAULT_CUSTOM_EVENT_COLOR;
}
