import { describe, expect, it } from 'vitest';
import {
  hideEvent,
  isEventHidden,
  matchingHiddenRules,
  unhideEvent,
  weeklySlotOf,
} from '../src/hiddenEvents.ts';
import {
  MAX_HIDDEN_RULES_PER_SOURCE,
  viewSettingsSchema,
  type CalendarEventDto,
  type HiddenOnceRule,
  type HiddenRule,
  type HiddenWeeklyRule,
  type ViewSettings,
} from '../src/schemas.ts';

const COURSE = 'MAT01|Analisi 1';

// Thursday 14:00 Rome: UTC+2 in October, UTC+1 in December
const OCTOBER_THURSDAY = '2026-10-01T12:00:00.000Z';
const DECEMBER_THURSDAY = '2026-12-03T13:00:00.000Z';

function event(overrides: Partial<CalendarEventDto> = {}): CalendarEventDto {
  return {
    id: '1:100:2026-10-01T12:00:00.000Z',
    sourceId: 1,
    courseKey: COURSE,
    courseCode: 'MAT01',
    courseName: 'Analisi 1',
    courseNameEn: null,
    activity: null,
    partition: null,
    start: OCTOBER_THURSDAY,
    end: '2026-10-01T14:00:00.000Z',
    teachers: [],
    rooms: [],
    status: 'ok',
    online: false,
    onlineUrl: null,
    offSite: false,
    extra: false,
    makeup: false,
    notes: null,
    notesEn: null,
    ...overrides,
  };
}

function weeklyRule(overrides: Partial<HiddenWeeklyRule> = {}): HiddenWeeklyRule {
  return { kind: 'weekly', courseKey: COURSE, partition: null, weekday: 4, time: '14:00', ...overrides };
}

function onceRule(overrides: Partial<HiddenOnceRule> = {}): HiddenOnceRule {
  return { kind: 'once', eventId: 'x', courseKey: COURSE, start: '2026-10-01T12:00:00.000Z', ...overrides };
}

function settingsWith(hidden: HiddenRule[], sourceId = 1): ViewSettings {
  return viewSettingsSchema.parse({ sources: [{ sourceId, hidden }] });
}

function hiddenOf(settings: ViewSettings | 'limit', sourceId = 1): HiddenRule[] {
  if (settings === 'limit') throw new Error('unexpected limit');
  return settings.sources.find((s) => s.sourceId === sourceId)!.hidden;
}

describe('weeklySlotOf', () => {
  it('reads the Rome weekday and start time on both sides of the DST change', () => {
    expect(weeklySlotOf(OCTOBER_THURSDAY)).toEqual({ weekday: 4, time: '14:00' });
    expect(weeklySlotOf(DECEMBER_THURSDAY)).toEqual({ weekday: 4, time: '14:00' });
  });

  it('ignores the offset the instant is written with', () => {
    expect(weeklySlotOf('2026-10-01T14:00:00+02:00')).toEqual({ weekday: 4, time: '14:00' });
    expect(weeklySlotOf('2026-12-03T14:00:00+01:00')).toEqual({ weekday: 4, time: '14:00' });
    expect(weeklySlotOf('2026-12-03T08:00:00-05:00')).toEqual({ weekday: 4, time: '14:00' });
  });

  it('uses the Rome date, not the UTC one, around midnight', () => {
    // Sunday 22:30 UTC is already Monday 00:30 in Rome (summer time)
    expect(weeklySlotOf('2026-10-04T22:30:00.000Z')).toEqual({ weekday: 1, time: '00:30' });
    // Midnight must not print as 24:00
    expect(weeklySlotOf('2026-12-06T23:00:00.000Z')).toEqual({ weekday: 1, time: '00:00' });
    // Late evening stays on its own day
    expect(weeklySlotOf('2026-12-06T22:30:00.000Z')).toEqual({ weekday: 7, time: '23:30' });
  });

  it('numbers Monday as 1 and Sunday as 7', () => {
    expect(weeklySlotOf('2026-11-23T09:00:00.000Z').weekday).toBe(1);
    expect(weeklySlotOf('2026-11-29T09:00:00.000Z').weekday).toBe(7);
  });
});

describe('matchingHiddenRules', () => {
  it('matches a weekly rule in October and December alike', () => {
    const rules = [weeklyRule()];
    expect(isEventHidden(rules, event({ start: OCTOBER_THURSDAY }))).toBe(true);
    expect(isEventHidden(rules, event({ start: DECEMBER_THURSDAY }))).toBe(true);
  });

  it('ignores the end time', () => {
    expect(isEventHidden([weeklyRule()], event({ end: '2026-10-01T16:00:00.000Z' }))).toBe(true);
  });

  it('does not match another weekday or start time', () => {
    const rules = [weeklyRule()];
    // Friday at 14:00 Rome
    expect(isEventHidden(rules, event({ start: '2026-10-02T12:00:00.000Z' }))).toBe(false);
    // Thursday at 15:00 Rome
    expect(isEventHidden(rules, event({ start: '2026-10-01T13:00:00.000Z' }))).toBe(false);
  });

  it('does not match another course', () => {
    expect(isEventHidden([weeklyRule()], event({ courseKey: 'MAT02|Algebra' }))).toBe(false);
  });

  it('keeps parallel partitions of one course apart', () => {
    const rules = [weeklyRule({ partition: 'Matricole pari' })];
    expect(isEventHidden(rules, event({ partition: 'Matricole pari' }))).toBe(true);
    expect(isEventHidden(rules, event({ partition: 'Matricole dispari' }))).toBe(false);
    expect(isEventHidden(rules, event({ partition: null }))).toBe(false);
    // A rule without partition does not hide a partitioned lesson either
    expect(isEventHidden([weeklyRule()], event({ partition: 'Matricole pari' }))).toBe(false);
  });

  it('matches a once rule only by its exact event id', () => {
    const rules = [onceRule({ eventId: '1:100:2026-10-01T12:00:00.000Z' })];
    expect(isEventHidden(rules, event({ id: '1:100:2026-10-01T12:00:00.000Z' }))).toBe(true);
    // Same lesson moved to another hour gets a new id and shows again
    expect(isEventHidden(rules, event({ id: '1:100:2026-10-01T13:00:00.000Z' }))).toBe(false);
    expect(isEventHidden(rules, event({ id: '1:101:2026-10-01T12:00:00.000Z' }))).toBe(false);
  });

  it('returns every rule that matches', () => {
    const once = onceRule({ eventId: event().id });
    const weekly = weeklyRule();
    const other = weeklyRule({ weekday: 2 });
    expect(matchingHiddenRules([other, once, weekly], event())).toEqual([once, weekly]);
  });

  it('matches nothing without rules', () => {
    expect(matchingHiddenRules([], event())).toEqual([]);
    expect(isEventHidden([], event())).toBe(false);
  });
});

describe('hideEvent', () => {
  it('adds a once rule carrying the id, course and start', () => {
    const next = hideEvent(settingsWith([]), event(), 'once');
    expect(hiddenOf(next)).toEqual([
      { kind: 'once', eventId: event().id, courseKey: COURSE, start: OCTOBER_THURSDAY },
    ]);
  });

  it('adds a weekly rule for the Rome slot and the partition', () => {
    const next = hideEvent(settingsWith([]), event({ partition: 'Matricole pari', start: DECEMBER_THURSDAY }), 'weekly');
    expect(hiddenOf(next)).toEqual([
      { kind: 'weekly', courseKey: COURSE, partition: 'Matricole pari', weekday: 4, time: '14:00' },
    ]);
  });

  it('produces rules the settings schema accepts', () => {
    const once = hideEvent(settingsWith([]), event(), 'once');
    const both = hideEvent(once as ViewSettings, event(), 'weekly');
    expect(viewSettingsSchema.safeParse(both).success).toBe(true);
  });

  it('keeps existing rules and leaves other sources alone', () => {
    const existing = weeklyRule({ weekday: 2 });
    const settings = viewSettingsSchema.parse({
      sources: [
        { sourceId: 1, hidden: [existing] },
        { sourceId: 2, hidden: [weeklyRule({ weekday: 3 })] },
      ],
    });
    const next = hideEvent(settings, event(), 'once');
    expect(hiddenOf(next, 1)).toHaveLength(2);
    expect(hiddenOf(next, 1)[0]).toEqual(existing);
    expect(hiddenOf(next, 2)).toEqual(hiddenOf(settings, 2));
  });

  it('never mutates its input', () => {
    const settings = settingsWith([weeklyRule({ weekday: 2 })]);
    const snapshot = JSON.parse(JSON.stringify(settings));
    hideEvent(settings, event(), 'once');
    expect(settings).toEqual(snapshot);
  });

  it('does not add an identical rule twice', () => {
    const once = hideEvent(settingsWith([]), event(), 'once') as ViewSettings;
    expect(hiddenOf(hideEvent(once, event(), 'once'))).toHaveLength(1);

    const weekly = hideEvent(settingsWith([]), event(), 'weekly') as ViewSettings;
    // A later lesson of the same slot is the same weekly rule
    expect(hiddenOf(hideEvent(weekly, event({ start: DECEMBER_THURSDAY }), 'weekly'))).toHaveLength(1);
    // But a once rule for the same lesson is a different rule
    expect(hiddenOf(hideEvent(weekly, event(), 'once'))).toHaveLength(2);
  });

  it('treats a different partition as a different weekly rule', () => {
    const first = hideEvent(settingsWith([]), event({ partition: 'A' }), 'weekly') as ViewSettings;
    expect(hiddenOf(hideEvent(first, event({ partition: 'B' }), 'weekly'))).toHaveLength(2);
  });

  it('returns the settings unchanged for a source not in the view', () => {
    const settings = settingsWith([weeklyRule()]);
    expect(hideEvent(settings, event({ sourceId: 99 }), 'once')).toBe(settings);
    expect(hideEvent(settings, event({ sourceId: 99 }), 'weekly')).toBe(settings);
  });

  describe('at the cap', () => {
    const NOW = Date.parse('2026-11-23T10:00:00.000Z');
    const PAST = '2026-10-01T12:00:00.000Z';
    const FUTURE = '2026-12-03T13:00:00.000Z';

    function full(count: number, makeRule: (i: number) => HiddenRule): ViewSettings {
      return settingsWith(Array.from({ length: count }, (_, i) => makeRule(i)));
    }

    it('drops past once rules to make room', () => {
      const settings = full(MAX_HIDDEN_RULES_PER_SOURCE, (i) =>
        i % 2 === 0 ? onceRule({ eventId: `past${i}`, start: PAST }) : onceRule({ eventId: `future${i}`, start: FUTURE }),
      );
      const next = hiddenOf(hideEvent(settings, event(), 'weekly', NOW));
      // 50 future once rules survive, plus the new one
      expect(next).toHaveLength(MAX_HIDDEN_RULES_PER_SOURCE / 2 + 1);
      expect(next.filter((r) => r.kind === 'once' && r.start === PAST)).toHaveLength(0);
      expect(next[next.length - 1]).toEqual(weeklyRule());
    });

    it('keeps weekly rules and future once rules when pruning', () => {
      const settings = full(MAX_HIDDEN_RULES_PER_SOURCE, (i) =>
        i === 0 ? weeklyRule({ weekday: 2 }) : i === 1 ? onceRule({ eventId: 'future', start: FUTURE }) : onceRule({ eventId: `past${i}`, start: PAST }),
      );
      const next = hiddenOf(hideEvent(settings, event(), 'once', NOW));
      expect(next.map((r) => r.kind)).toEqual(['weekly', 'once', 'once']);
    });

    it('answers limit when nothing can be pruned', () => {
      const settings = full(MAX_HIDDEN_RULES_PER_SOURCE, (i) => weeklyRule({ weekday: (i % 7) + 1, time: `${String(Math.floor(i / 7)).padStart(2, '0')}:00` }));
      expect(hideEvent(settings, event(), 'weekly', NOW)).toBe('limit');
      expect(hideEvent(settings, event(), 'once', NOW)).toBe('limit');
    });

    it('answers limit when every once rule is still upcoming', () => {
      const settings = full(MAX_HIDDEN_RULES_PER_SOURCE, (i) => onceRule({ eventId: `future${i}`, start: FUTURE }));
      expect(hideEvent(settings, event(), 'once', NOW)).toBe('limit');
    });

    it('does not answer limit for a rule that already exists', () => {
      const settings = full(MAX_HIDDEN_RULES_PER_SOURCE, (i) =>
        i === 0 ? weeklyRule() : onceRule({ eventId: `future${i}`, start: FUTURE }),
      );
      expect(hideEvent(settings, event(), 'weekly', NOW)).toBe(settings);
    });

    it('treats a once rule starting exactly now as still upcoming', () => {
      const settings = full(MAX_HIDDEN_RULES_PER_SOURCE, (i) => onceRule({ eventId: `e${i}`, start: new Date(NOW).toISOString() }));
      expect(hideEvent(settings, event(), 'once', NOW)).toBe('limit');
    });

    it('counts the cap per source', () => {
      const settings = viewSettingsSchema.parse({
        sources: [
          { sourceId: 1, hidden: Array.from({ length: MAX_HIDDEN_RULES_PER_SOURCE }, (_, i) => onceRule({ eventId: `e${i}`, start: FUTURE })) },
          { sourceId: 2, hidden: [] },
        ],
      });
      expect(hideEvent(settings, event({ sourceId: 1 }), 'weekly', NOW)).toBe('limit');
      expect(hiddenOf(hideEvent(settings, event({ sourceId: 2 }), 'weekly', NOW), 2)).toHaveLength(1);
    });
  });
});

describe('unhideEvent', () => {
  it('removes both a once and a weekly rule matching the event', () => {
    const keep = weeklyRule({ weekday: 2 });
    const settings = settingsWith([onceRule({ eventId: event().id }), keep, weeklyRule()]);
    const next = unhideEvent(settings, event());
    expect(hiddenOf(next)).toEqual([keep]);
    expect(isEventHidden(hiddenOf(next), event())).toBe(false);
  });

  it('removes the weekly rule when it is the only match', () => {
    const next = unhideEvent(settingsWith([weeklyRule()]), event({ start: DECEMBER_THURSDAY }));
    expect(hiddenOf(next)).toEqual([]);
  });

  it('keeps rules for other lessons of the course', () => {
    const other = onceRule({ eventId: 'other' });
    const next = unhideEvent(settingsWith([other, onceRule({ eventId: event().id })]), event());
    expect(hiddenOf(next)).toEqual([other]);
  });

  it('only touches the event source', () => {
    const settings = viewSettingsSchema.parse({
      sources: [
        { sourceId: 1, hidden: [weeklyRule()] },
        { sourceId: 2, hidden: [weeklyRule()] },
      ],
    });
    const next = unhideEvent(settings, event({ sourceId: 2 }));
    expect(hiddenOf(next, 1)).toEqual([weeklyRule()]);
    expect(hiddenOf(next, 2)).toEqual([]);
  });

  it('returns the settings unchanged for a source not in the view', () => {
    const settings = settingsWith([weeklyRule()]);
    expect(unhideEvent(settings, event({ sourceId: 99 }))).toBe(settings);
  });

  it('returns the settings unchanged when nothing matches', () => {
    const settings = settingsWith([weeklyRule({ weekday: 2 })]);
    expect(unhideEvent(settings, event())).toBe(settings);
  });

  it('never mutates its input', () => {
    const settings = settingsWith([weeklyRule()]);
    const snapshot = JSON.parse(JSON.stringify(settings));
    unhideEvent(settings, event());
    expect(settings).toEqual(snapshot);
  });

  it('undoes hideEvent', () => {
    const start = settingsWith([]);
    const hidden = hideEvent(hideEvent(start, event(), 'once') as ViewSettings, event(), 'weekly') as ViewSettings;
    expect(isEventHidden(hiddenOf(hidden), event())).toBe(true);
    expect(unhideEvent(hidden, event())).toEqual(start);
  });
});

describe('viewSettingsSchema hidden rules', () => {
  const baseSource = { sourceId: 1, courseMode: 'exclude', courses: [] };

  it('defaults hidden to an empty list for settings stored before the field existed', () => {
    const parsed = viewSettingsSchema.parse({ sources: [baseSource] });
    expect(parsed.sources[0]!.hidden).toEqual([]);
  });

  it('accepts and keeps valid rules of both kinds', () => {
    const hidden = [onceRule(), weeklyRule({ partition: 'Matricole pari' }), weeklyRule({ weekday: 7, time: '08:30' })];
    expect(viewSettingsSchema.parse({ sources: [{ ...baseSource, hidden }] }).sources[0]!.hidden).toEqual(hidden);
  });

  it('accepts a once start written with an offset', () => {
    const rule = onceRule({ start: '2026-10-01T14:00:00+02:00' });
    expect(viewSettingsSchema.safeParse({ sources: [{ ...baseSource, hidden: [rule] }] }).success).toBe(true);
  });

  it('rejects an invalid weekday', () => {
    for (const weekday of [0, 8, 1.5, -1]) {
      const hidden = [weeklyRule({ weekday })];
      expect(viewSettingsSchema.safeParse({ sources: [{ ...baseSource, hidden }] }).success, String(weekday)).toBe(false);
    }
  });

  it('rejects a malformed time', () => {
    for (const time of ['24:00', '9:00', '09:60', '0900', '09:00:00', '', 'ab:cd']) {
      const hidden = [weeklyRule({ time })];
      expect(viewSettingsSchema.safeParse({ sources: [{ ...baseSource, hidden }] }).success, time).toBe(false);
    }
  });

  it('rejects an unknown kind and a malformed once rule', () => {
    const bad: unknown[] = [
      { kind: 'daily', courseKey: COURSE },
      { ...onceRule(), eventId: '' },
      { ...onceRule(), start: 'tomorrow' },
      { ...onceRule(), courseKey: '' },
      { ...weeklyRule(), partition: undefined },
      { ...weeklyRule(), partition: 'p'.repeat(301) },
    ];
    for (const rule of bad) {
      expect(viewSettingsSchema.safeParse({ sources: [{ ...baseSource, hidden: [rule] }] }).success, JSON.stringify(rule)).toBe(false);
    }
  });

  it('rejects more rules than the cap', () => {
    const rules = (count: number) => Array.from({ length: count }, (_, i) => onceRule({ eventId: `e${i}` }));
    expect(viewSettingsSchema.safeParse({ sources: [{ ...baseSource, hidden: rules(MAX_HIDDEN_RULES_PER_SOURCE) }] }).success).toBe(true);
    expect(viewSettingsSchema.safeParse({ sources: [{ ...baseSource, hidden: rules(101) }] }).success).toBe(false);
  });
});
