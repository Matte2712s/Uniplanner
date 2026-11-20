import { describe, expect, it } from 'vitest';
import {
  customEventDataSchema,
  customEventInputSchema,
  eventLabelInputSchema,
  expandOccurrences,
  guestImportSchema,
  localToUtc,
  MAX_EVENT_EXCEPTIONS,
  MAX_EVENT_SLOTS,
  MAX_OCCURRENCES_PER_EXPANSION,
  type ExpandableEvent,
} from '../src/customEvents.ts';
import { viewSettingsSchema } from '../src/schemas.ts';

const ONCE = { kind: 'once', startDate: '2026-11-19', startTime: '10:00', endDate: '2026-11-19', endTime: '12:00' };

function input(overrides: Record<string, unknown> = {}) {
  return { title: 'Studio', timeZone: 'Europe/Rome', schedule: ONCE, ...overrides };
}

function weekly(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'weekly',
    startDate: '2026-11-16',
    slots: [{ weekday: 1, startTime: '09:00', endTime: '11:00' }],
    ...overrides,
  };
}

function messages(value: unknown): string[] {
  const result = customEventInputSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

function parse(value: unknown) {
  return customEventInputSchema.parse(value);
}

describe('customEventInputSchema', () => {
  it('accepts a minimal one-shot event and fills nullable fields', () => {
    expect(parse(input())).toEqual({
      title: 'Studio',
      notes: null,
      location: null,
      url: null,
      labelId: null,
      color: null,
      timeZone: 'Europe/Rome',
      schedule: ONCE,
    });
  });

  describe('text fields', () => {
    it('trims and NFC-normalizes the title', () => {
      expect(parse(input({ title: '  Café  ' })).title).toBe('Café');
    });

    it('enforces title length after trimming', () => {
      expect(parse(input({ title: 'a'.repeat(120) })).title).toHaveLength(120);
      expect(messages(input({ title: 'a'.repeat(121) }))).toContain('too_long');
      expect(messages(input({ title: '   ' }))).toContain('required');
    });

    it.each<[string, string]>([
      ['newline', 'a\nb'],
      ['bidi override', 'a‮b'],
      ['zero-width space', 'a​b'],
      ['inner BOM', 'a﻿b'],
      ['backslash', 'a\\b'],
    ])('rejects %s in the title', (_label, title) => {
      expect(messages(input({ title }))).toContain('invalid_chars');
    });

    it('strips a leading BOM as whitespace', () => {
      expect(parse(input({ title: '﻿ab' })).title).toBe('ab');
    });

    it('keeps line breaks in notes and normalizes CRLF', () => {
      expect(parse(input({ notes: ' line 1\r\nline 2\rline 3 ' })).notes).toBe('line 1\nline 2\nline 3');
    });

    it('rejects other controls in notes', () => {
      expect(messages(input({ notes: 'a\tb' }))).toContain('invalid_chars');
      expect(messages(input({ notes: 'a\n‮b' }))).toContain('invalid_chars');
    });

    it('turns blank optional text into null', () => {
      const parsed = parse(input({ notes: '  \n ', location: ' ' }));
      expect(parsed.notes).toBeNull();
      expect(parsed.location).toBeNull();
    });

    it('caps notes and location', () => {
      expect(messages(input({ notes: 'a'.repeat(1001) }))).toContain('too_long');
      expect(messages(input({ location: 'a'.repeat(121) }))).toContain('too_long');
    });
  });

  describe('strictness', () => {
    it('rejects unknown keys at every level', () => {
      expect(customEventInputSchema.safeParse(input({ userId: 7 })).success).toBe(false);
      expect(customEventInputSchema.safeParse(input({ schedule: { ...ONCE, extra: 1 } })).success).toBe(false);
      expect(
        customEventInputSchema.safeParse(
          input({ schedule: weekly({ slots: [{ weekday: 1, startTime: '09:00', endTime: '10:00', x: 1 }] }) }),
        ).success,
      ).toBe(false);
    });

    it('rejects a __proto__ key coming from JSON', () => {
      const payload = JSON.parse('{"title":"a","timeZone":"UTC","schedule":' + JSON.stringify(ONCE) + ',"__proto__":{"admin":true}}');
      expect(customEventInputSchema.safeParse(payload).success).toBe(false);
    });

    it('validates labelId as a positive integer', () => {
      for (const labelId of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 2]) {
        expect(customEventInputSchema.safeParse(input({ labelId })).success).toBe(false);
      }
      expect(parse(input({ labelId: 3 })).labelId).toBe(3);
    });

    it('accepts only #rrggbb colors', () => {
      expect(parse(input({ color: '#A1b2C3' })).color).toBe('#A1b2C3');
      for (const color of ['red', '#fff', '#12345g', 'url(x)', '#1234567']) {
        expect(customEventInputSchema.safeParse(input({ color })).success).toBe(false);
      }
    });
  });

  describe('url', () => {
    it('stores the canonical https href', () => {
      expect(parse(input({ url: ' https://Example.COM/path?q=1 ' })).url).toBe('https://example.com/path?q=1');
      expect(parse(input({ url: '' })).url).toBeNull();
    });

    it.each<[string, string]>([
      ['javascript scheme', 'javascript:alert(1)'],
      ['data scheme', 'data:text/html,<script>alert(1)</script>'],
      ['plain http', 'http://example.com'],
      ['credentials', 'https://user:pw@example.com'],
      ['inner whitespace', 'https://example.com/a b'],
      ['bidi override', 'https://example.com/‮'],
      ['not a url', 'example.com'],
      ['too long', 'https://example.com/' + 'a'.repeat(2048)],
    ])('rejects %s', (_label, url) => {
      expect(messages(input({ url }))).toContain('invalid_url');
    });
  });

  describe('time zone', () => {
    it('canonicalizes letter case', () => {
      expect(parse(input({ timeZone: 'europe/rome' })).timeZone).toBe('Europe/Rome');
    });

    it.each(['Mars/Olympus', '../etc/passwd', 'Europe/Rome; drop', '', 'A'.repeat(65)])('rejects %s', (timeZone) => {
      expect(messages(input({ timeZone }))).toContain('invalid_time_zone');
    });
  });

  describe('dates and times', () => {
    it.each(['2026-02-30', '2026-2-03', '1999-12-31', '2101-01-01', '2026-13-01', '20260101'])(
      'rejects date %s',
      (startDate) => {
        expect(messages(input({ schedule: { ...ONCE, startDate } }))).toContain('invalid_date');
      },
    );

    it('accepts leap days', () => {
      const schedule = { ...ONCE, startDate: '2028-02-29', endDate: '2028-02-29' };
      expect(customEventInputSchema.safeParse(input({ schedule })).success).toBe(true);
    });

    it('allows 24:00 only as an end time', () => {
      expect(customEventInputSchema.safeParse(input({ schedule: { ...ONCE, endTime: '24:00' } })).success).toBe(true);
      expect(messages(input({ schedule: { ...ONCE, startTime: '24:00' } }))).toContain('invalid_time');
    });

    it.each(['9:00', '23:60', '12:00:00', '24:01'])('rejects time %s', (endTime) => {
      expect(messages(input({ schedule: { ...ONCE, endTime } }))).toContain('invalid_time');
    });

    it('reports only the field issue when a date is malformed', () => {
      expect(messages(input({ schedule: { ...ONCE, startDate: 'nope' } }))).toEqual(['invalid_date']);
    });
  });

  describe('once and allDay', () => {
    it('requires the end after the start', () => {
      expect(messages(input({ schedule: { ...ONCE, endTime: '10:00' } }))).toContain('end_before_start');
      expect(messages(input({ schedule: { ...ONCE, endDate: '2026-11-18', endTime: '23:00' } }))).toContain(
        'end_before_start',
      );
    });

    it('caps the span of a one-shot event', () => {
      const ok = { ...ONCE, endDate: '2026-12-03', endTime: '10:00' };
      const tooLong = { ...ONCE, endDate: '2026-12-03', endTime: '10:01' };
      expect(customEventInputSchema.safeParse(input({ schedule: ok })).success).toBe(true);
      expect(messages(input({ schedule: tooLong }))).toContain('span_too_long');
    });

    it('caps the span of an all-day event at 14 days inclusive', () => {
      const allDay = (endDate: string) => input({ schedule: { kind: 'allDay', startDate: '2026-11-01', endDate } });
      expect(customEventInputSchema.safeParse(allDay('2026-11-14')).success).toBe(true);
      expect(messages(allDay('2026-11-15'))).toContain('span_too_long');
      expect(messages(allDay('2026-10-31'))).toContain('end_before_start');
    });
  });

  describe('weekly', () => {
    it('applies defaults', () => {
      expect(parse(input({ schedule: weekly() })).schedule).toEqual({
        ...weekly(),
        untilDate: null,
        intervalWeeks: 1,
        exceptions: [],
      });
    });

    it('requires 1 to MAX_EVENT_SLOTS slots', () => {
      expect(messages(input({ schedule: weekly({ slots: [] }) }))).toContain('required');
      const slots = Array.from({ length: MAX_EVENT_SLOTS + 1 }, (_, i) => ({
        weekday: (i % 7) + 1,
        startTime: `${String(8 + Math.floor(i / 7)).padStart(2, '0')}:00`,
        endTime: '23:00',
      }));
      expect(messages(input({ schedule: weekly({ slots }) }))).toContain('too_many');
    });

    it('rejects duplicate slots and slots ending before they start', () => {
      const dup = { weekday: 1, startTime: '09:00', endTime: '10:00' };
      expect(messages(input({ schedule: weekly({ slots: [dup, { ...dup, endTime: '11:00' }] }) }))).toContain(
        'duplicate_slot',
      );
      expect(messages(input({ schedule: weekly({ slots: [{ ...dup, endTime: '09:00' }] }) }))).toContain(
        'end_before_start',
      );
    });

    it('bounds the interval and weekday', () => {
      for (const intervalWeeks of [0, 5, 1.5]) {
        expect(customEventInputSchema.safeParse(input({ schedule: weekly({ intervalWeeks }) })).success).toBe(false);
      }
      for (const weekday of [0, 8]) {
        const slots = [{ weekday, startTime: '09:00', endTime: '10:00' }];
        expect(customEventInputSchema.safeParse(input({ schedule: weekly({ slots }) })).success).toBe(false);
      }
    });

    it('requires untilDate on or after startDate', () => {
      expect(messages(input({ schedule: weekly({ untilDate: '2026-11-15' }) }))).toContain('until_before_start');
      expect(customEventInputSchema.safeParse(input({ schedule: weekly({ untilDate: '2026-11-16' }) })).success).toBe(
        true,
      );
    });

    it('dedupes, sorts and range-checks exceptions', () => {
      const schedule = weekly({ untilDate: '2026-12-31', exceptions: ['2026-11-30', '2026-11-23', '2026-11-30'] });
      const parsed = parse(input({ schedule })).schedule;
      expect(parsed.kind === 'weekly' && parsed.exceptions).toEqual(['2026-11-23', '2026-11-30']);
      expect(messages(input({ schedule: weekly({ exceptions: ['2026-11-15'] }) }))).toContain('exception_out_of_range');
      expect(
        messages(input({ schedule: weekly({ untilDate: '2026-12-31', exceptions: ['2027-01-01'] }) })),
      ).toContain('exception_out_of_range');
    });

    it('caps exceptions', () => {
      const exceptions = Array.from({ length: MAX_EVENT_EXCEPTIONS + 1 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 10, 16 + i));
        return d.toISOString().slice(0, 10);
      });
      expect(messages(input({ schedule: weekly({ exceptions }) }))).toContain('too_many');
    });
  });

  it('round-trips its own output (stored rows re-validate unchanged)', () => {
    const parsed = parse(
      input({
        title: ' Café ',
        notes: 'a\r\nb',
        url: 'https://Example.com',
        timeZone: 'europe/rome',
        schedule: weekly({ exceptions: ['2026-11-30', '2026-11-23'] }),
      }),
    );
    const data = customEventDataSchema.parse(JSON.parse(JSON.stringify({ ...parsed, labelId: undefined })));
    expect(customEventDataSchema.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
    expect(data).toEqual({ ...parsed, labelId: undefined });
  });
});

describe('eventLabelInputSchema', () => {
  it('validates name and color strictly', () => {
    expect(eventLabelInputSchema.parse({ name: ' Gym ', color: '#112233' })).toEqual({ name: 'Gym', color: '#112233' });
    expect(eventLabelInputSchema.safeParse({ name: 'a'.repeat(41), color: '#112233' }).success).toBe(false);
    expect(eventLabelInputSchema.safeParse({ name: 'Gym', color: 'blue' }).success).toBe(false);
    expect(eventLabelInputSchema.safeParse({ name: 'Gym', color: '#112233', userId: 1 }).success).toBe(false);
  });
});

describe('guestImportSchema', () => {
  const label = { ref: 1, name: 'Gym', color: '#112233' };

  it('accepts labels, events and views together', () => {
    const parsed = guestImportSchema.parse({
      labels: [label],
      events: [input({ labelId: 1 })],
      views: [{ name: 'Mine', settings: { customEvents: { hiddenLabels: [1] } } }],
    });
    expect(parsed.events[0]?.labelId).toBe(1);
    expect(parsed.views[0]?.settings.customEvents.hiddenLabels).toEqual([1]);
  });

  it('rejects duplicate label refs, unknown keys and oversized lists', () => {
    expect(guestImportSchema.safeParse({ labels: [label, label], events: [], views: [] }).success).toBe(false);
    expect(guestImportSchema.safeParse({ labels: [{ ...label, userId: 2 }], events: [], views: [] }).success).toBe(false);
    expect(guestImportSchema.safeParse({ labels: [], events: [], views: [], extra: 1 }).success).toBe(false);
    expect(
      guestImportSchema.safeParse({ labels: [], events: Array.from({ length: 201 }, () => input()), views: [] }).success,
    ).toBe(false);
  });
});

describe('viewSettingsSchema customEvents', () => {
  it('defaults for views stored before custom events existed', () => {
    expect(viewSettingsSchema.parse({}).customEvents).toEqual({ show: true, hiddenLabels: [], shareInLink: false });
  });
});

describe('localToUtc', () => {
  it('converts ordinary wall times', () => {
    expect(new Date(localToUtc('2026-07-01', '09:00', 'Europe/Rome')).toISOString()).toBe('2026-07-01T07:00:00.000Z');
    expect(new Date(localToUtc('2026-01-15', '09:00', 'Europe/Rome')).toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(new Date(localToUtc('2026-07-01', '09:00', 'America/New_York')).toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
  });

  it('moves a time inside the spring-forward gap forward by the gap', () => {
    // 02:30 does not exist in Rome on 2026-03-29; lands on 03:30 CEST
    expect(new Date(localToUtc('2026-03-29', '02:30', 'Europe/Rome')).toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });

  it('resolves a repeated fall-back time to its earlier instance', () => {
    // 02:30 happens twice in Rome on 2026-10-25; the first is still CEST
    expect(new Date(localToUtc('2026-10-25', '02:30', 'Europe/Rome')).toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('treats 24:00 as the next midnight', () => {
    expect(new Date(localToUtc('2026-11-16', '24:00', 'UTC')).toISOString()).toBe('2026-11-17T00:00:00.000Z');
  });
});

describe('expandOccurrences', () => {
  function event(id: number, schedule: Record<string, unknown>, timeZone = 'Europe/Rome'): ExpandableEvent {
    return { id, timeZone, ...customEventDataSchema.pick({ schedule: true }).parse({ schedule }) };
  }
  const range = (from: string, to: string) => [new Date(from), new Date(to)] as const;

  it('expands a one-shot event inside the range only', () => {
    const ev = event(1, ONCE);
    expect(expandOccurrences([ev], ...range('2026-11-16T00:00:00Z', '2026-11-23T00:00:00Z'))).toEqual([
      {
        eventId: 1,
        key: '1:once',
        start: '2026-11-19T09:00:00.000Z',
        end: '2026-11-19T11:00:00.000Z',
        allDay: false,
        date: '2026-11-19',
      },
    ]);
    expect(expandOccurrences([ev], ...range('2026-11-23T00:00:00Z', '2026-11-30T00:00:00Z'))).toEqual([]);
  });

  it('emits all-day events as dates with an exclusive end', () => {
    const ev = event(2, { kind: 'allDay', startDate: '2026-11-18', endDate: '2026-11-20' });
    const [occ] = expandOccurrences([ev], ...range('2026-11-16T00:00:00Z', '2026-11-23T00:00:00Z'));
    expect(occ).toMatchObject({ start: '2026-11-18', end: '2026-11-21', allDay: true });
  });

  it('expands several weekly slots on different days and hours', () => {
    const ev = event(
      3,
      weekly({
        slots: [
          { weekday: 1, startTime: '09:00', endTime: '11:00' },
          { weekday: 3, startTime: '14:00', endTime: '16:00' },
        ],
      }),
    );
    const occ = expandOccurrences([ev], ...range('2026-11-16T00:00:00Z', '2026-11-30T00:00:00Z'));
    expect(occ.map((o) => [o.date, o.start])).toEqual([
      ['2026-11-16', '2026-11-16T08:00:00.000Z'],
      ['2026-11-18', '2026-11-18T13:00:00.000Z'],
      ['2026-11-23', '2026-11-23T08:00:00.000Z'],
      ['2026-11-25', '2026-11-25T13:00:00.000Z'],
    ]);
    expect(new Set(occ.map((o) => o.key)).size).toBe(occ.length);
  });

  it('honors the interval, anchored on the start week', () => {
    const everyTwo = event(4, weekly({ intervalWeeks: 2 }));
    const occ = expandOccurrences([everyTwo], ...range('2026-11-16T00:00:00Z', '2026-12-14T00:00:00Z'));
    expect(occ.map((o) => o.date)).toEqual(['2026-11-16', '2026-11-30']);

    // Starts on a Wednesday: the Monday of that week is week 0 but precedes the start
    const midWeek = event(5, weekly({ startDate: '2026-11-18', intervalWeeks: 2 }));
    const occ2 = expandOccurrences([midWeek], ...range('2026-11-16T00:00:00Z', '2026-12-14T00:00:00Z'));
    expect(occ2.map((o) => o.date)).toEqual(['2026-11-30']);
  });

  it('stops at untilDate (inclusive) and skips exceptions', () => {
    const ev = event(6, weekly({ untilDate: '2026-12-07', exceptions: ['2026-11-23'] }));
    const occ = expandOccurrences([ev], ...range('2026-11-16T00:00:00Z', '2026-12-28T00:00:00Z'));
    expect(occ.map((o) => o.date)).toEqual(['2026-11-16', '2026-11-30', '2026-12-07']);
  });

  it('keeps the wall-clock time across a DST change', () => {
    const ev = event(7, weekly({ startDate: '2026-10-19', slots: [{ weekday: 1, startTime: '09:00', endTime: '10:00' }] }));
    const occ = expandOccurrences([ev], ...range('2026-10-19T00:00:00Z', '2026-11-02T00:00:00Z'));
    expect(occ.map((o) => o.start)).toEqual(['2026-10-19T07:00:00.000Z', '2026-10-26T08:00:00.000Z']);
  });

  it('includes occurrences that only partially overlap the range', () => {
    const ev = event(8, weekly({ slots: [{ weekday: 1, startTime: '23:00', endTime: '24:00' }] }), 'UTC');
    expect(expandOccurrences([ev], ...range('2026-11-16T23:30:00Z', '2026-11-17T00:00:00Z'))).toHaveLength(1);
    expect(expandOccurrences([ev], ...range('2026-11-17T00:00:00Z', '2026-11-17T01:00:00Z'))).toHaveLength(0);
    expect(expandOccurrences([ev], ...range('2026-11-16T22:00:00Z', '2026-11-16T23:00:00Z'))).toHaveLength(0);
  });

  it('only walks the requested range for long-running series', () => {
    const ev = event(9, weekly({ startDate: '2000-01-03' }));
    const occ = expandOccurrences([ev], ...range('2026-11-16T00:00:00Z', '2026-11-23T00:00:00Z'));
    expect(occ.map((o) => o.date)).toEqual(['2026-11-16']);
  });

  it('clamps the range to MAX_RANGE_DAYS', () => {
    const ev = event(10, weekly());
    const occ = expandOccurrences([ev], ...range('2026-11-16T00:00:00Z', '2027-11-16T00:00:00Z'));
    expect(occ.length).toBeLessThanOrEqual(7);
  });

  it('caps the number of occurrences', () => {
    const slots = Array.from({ length: MAX_EVENT_SLOTS }, (_, i) => ({
      weekday: (i % 7) + 1,
      startTime: i < 7 ? '08:00' : '12:00',
      endTime: i < 7 ? '09:00' : '13:00',
    }));
    const events = Array.from({ length: 200 }, (_, i) => event(i + 1, weekly({ slots })));
    const occ = expandOccurrences(events, ...range('2026-11-16T00:00:00Z', '2026-12-31T00:00:00Z'));
    expect(occ).toHaveLength(MAX_OCCURRENCES_PER_EXPANSION);
  });

  it('skips an event whose zone cannot be loaded without dropping the others', () => {
    const good = event(11, ONCE);
    const bad = { ...event(12, ONCE), timeZone: 'Not/AZone' };
    const occ = expandOccurrences([bad, good], ...range('2026-11-16T00:00:00Z', '2026-11-23T00:00:00Z'));
    expect(occ.map((o) => o.eventId)).toEqual([11]);
  });

  it('returns nothing for an empty or inverted range', () => {
    const ev = event(13, ONCE);
    expect(expandOccurrences([ev], ...range('2026-11-23T00:00:00Z', '2026-11-16T00:00:00Z'))).toEqual([]);
  });
});
