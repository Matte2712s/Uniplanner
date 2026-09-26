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
