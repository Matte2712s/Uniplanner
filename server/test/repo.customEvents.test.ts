import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  customEventInputSchema,
  defaultViewSettings,
  MAX_CUSTOM_EVENTS_PER_USER,
  MAX_EVENT_LABELS_PER_USER,
  type CustomEventData,
  type GuestImportData,
} from '@planner/shared';
import { openDb, type Db } from '../src/db/index.ts';
import {
  createCustomEvent,
  createEventLabel,
  createView,
  deleteCustomEvent,
  deleteEventLabel,
  getCustomEvent,
  getEventLabel,
  getSharedViewContext,
  getView,
  hasCustomEvent,
  importGuestData,
  listCustomEvents,
  listEventLabels,
  setViewShareToken,
  updateCustomEvent,
  updateEventLabel,
  upsertUser,
} from '../src/db/repo.ts';

function makeUser(db: Db, sub: string) {
  return upsertUser(db, sub, `${sub}@example.com`, sub);
}

function sampleEvent(overrides: Record<string, unknown> = {}): CustomEventData {
  return customEventInputSchema.parse({
    title: 'Studio',
    timeZone: 'Europe/Rome',
    schedule: { kind: 'once', startDate: '2026-11-19', startTime: '10:00', endDate: '2026-11-19', endTime: '12:00' },
    ...overrides,
  });
}

function weeklyEvent(overrides: Record<string, unknown> = {}): CustomEventData {
  return sampleEvent({
    title: 'Lab',
    schedule: { kind: 'weekly', startDate: '2026-11-16', slots: [{ weekday: 1, startTime: '09:00', endTime: '11:00' }] },
    ...overrides,
  });
}

function insertRawEvent(db: Db, userId: number, data: string): number {
  const res = db.prepare('INSERT INTO custom_events (user_id, data) VALUES (?, ?)').run(userId, data);
  return Number(res.lastInsertRowid);
}

function insertRawView(db: Db, userId: number, settings: string): number {
  const res = db
    .prepare('INSERT INTO views (user_id, name, position, settings) VALUES (?, ?, 0, ?)')
    .run(userId, 'Raw', settings);
  return Number(res.lastInsertRowid);
}

describe('event labels', () => {
  it('creates, lists, renames and deletes labels scoped per user', () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'a');
    const b = makeUser(db, 'b');

    const first = createEventLabel(db, a.id, { name: 'Exam', color: '#ff0000' });
    const second = createEventLabel(db, a.id, { name: 'Lab', color: '#00ff00' });
    createEventLabel(db, b.id, { name: 'Other', color: '#0000ff' });
    if (first === 'limit' || second === 'limit') throw new Error('unexpected limit');

    expect(listEventLabels(db, a.id).map((l) => l.name)).toEqual(['Exam', 'Lab']);
    expect(listEventLabels(db, b.id).map((l) => l.name)).toEqual(['Other']);

    const renamed = updateEventLabel(db, a.id, first.id, { name: 'Exams', color: '#123456' });
    expect(renamed).toMatchObject({ id: first.id, name: 'Exams', color: '#123456' });

    // Another user can neither read, change nor delete it
    expect(getEventLabel(db, b.id, first.id)).toBeUndefined();
    expect(updateEventLabel(db, b.id, first.id, { name: 'Hijack', color: '#000000' })).toBeUndefined();
    expect(deleteEventLabel(db, b.id, first.id)).toBe(false);
    expect(getEventLabel(db, a.id, first.id)).toMatchObject({ name: 'Exams' });

    expect(deleteEventLabel(db, a.id, first.id)).toBe(true);
    expect(deleteEventLabel(db, a.id, first.id)).toBe(false);
    expect(listEventLabels(db, a.id).map((l) => l.id)).toEqual([second.id]);
  });

  it('caps labels per user', () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'a');
    const b = makeUser(db, 'b');

    for (let i = 0; i < MAX_EVENT_LABELS_PER_USER; i++) {
      expect(createEventLabel(db, a.id, { name: `L${i}`, color: '#ff0000' })).not.toBe('limit');
    }
    expect(createEventLabel(db, a.id, { name: 'Over', color: '#ff0000' })).toBe('limit');
    expect(listEventLabels(db, a.id)).toHaveLength(MAX_EVENT_LABELS_PER_USER);
    // The cap is per user
    expect(createEventLabel(db, b.id, { name: 'Fine', color: '#ff0000' })).not.toBe('limit');
  });
});

describe('custom events', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  afterEach(() => {
    warn.mockClear();
  });

  it('creates, reads, updates and deletes events scoped per user', () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'a');
    const b = makeUser(db, 'b');

    const created = createCustomEvent(db, a.id, sampleEvent({ notes: 'Bring laptop', url: 'https://example.com/x' }));
    if (typeof created === 'string') throw new Error(created);
    const weekly = createCustomEvent(db, a.id, weeklyEvent());
    if (typeof weekly === 'string') throw new Error(weekly);
    createCustomEvent(db, b.id, sampleEvent({ title: 'Not mine' }));

    expect(created).toMatchObject({
      title: 'Studio',
      notes: 'Bring laptop',
      url: 'https://example.com/x',
      location: null,
      color: null,
      labelId: null,
      timeZone: 'Europe/Rome',
    });
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(created).not.toHaveProperty('userId');
    expect(created).not.toHaveProperty('user_id');

    expect(listCustomEvents(db, a.id).map((e) => e.id)).toEqual([created.id, weekly.id]);
    expect(listCustomEvents(db, b.id).map((e) => e.title)).toEqual(['Not mine']);
    expect(getCustomEvent(db, a.id, created.id)).toEqual(created);
    // Weekly defaults survive the round trip through storage
    expect(getCustomEvent(db, a.id, weekly.id)?.schedule).toMatchObject({
      kind: 'weekly',
      untilDate: null,
      intervalWeeks: 1,
      exceptions: [],
    });

    // Make the old timestamp distinguishable from "now"
    db.prepare("UPDATE custom_events SET updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(created.id);
    const updated = updateCustomEvent(db, a.id, created.id, sampleEvent({ title: 'Renamed', location: 'Room 4' }));
    if (typeof updated === 'string') throw new Error(updated);
    expect(updated).toMatchObject({ id: created.id, title: 'Renamed', location: 'Room 4', notes: null, url: null });
    expect(updated.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
    expect(getCustomEvent(db, a.id, created.id)).toEqual(updated);

    expect(deleteCustomEvent(db, a.id, created.id)).toBe(true);
    expect(deleteCustomEvent(db, a.id, created.id)).toBe(false);
    expect(getCustomEvent(db, a.id, created.id)).toBeUndefined();
  });

  it('keeps events out of reach of other users', () => {
    const db = openDb(':memory:');
    const owner = makeUser(db, 'owner');
    const stranger = makeUser(db, 'stranger');
    const event = createCustomEvent(db, owner.id, sampleEvent());
    if (typeof event === 'string') throw new Error(event);

    expect(getCustomEvent(db, stranger.id, event.id)).toBeUndefined();
    expect(hasCustomEvent(db, stranger.id, event.id)).toBe(false);
    expect(updateCustomEvent(db, stranger.id, event.id, sampleEvent({ title: 'Hijacked' }))).toBe('not_found');
    expect(deleteCustomEvent(db, stranger.id, event.id)).toBe(false);
    expect(listCustomEvents(db, stranger.id)).toEqual([]);

    expect(getCustomEvent(db, owner.id, event.id)).toMatchObject({ title: 'Studio' });
  });

  it('caps events per user', () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'a');
    const b = makeUser(db, 'b');

    for (let i = 0; i < MAX_CUSTOM_EVENTS_PER_USER; i++) {
      expect(typeof createCustomEvent(db, a.id, sampleEvent({ title: `E${i}` }))).toBe('object');
    }
    expect(createCustomEvent(db, a.id, sampleEvent({ title: 'Over' }))).toBe('limit');
    expect(listCustomEvents(db, a.id)).toHaveLength(MAX_CUSTOM_EVENTS_PER_USER);
    expect(typeof createCustomEvent(db, b.id, sampleEvent())).toBe('object');

    // Deleting one frees a slot
    const [first] = listCustomEvents(db, a.id);
    deleteCustomEvent(db, a.id, first!.id);
    expect(typeof createCustomEvent(db, a.id, sampleEvent({ title: 'Fits again' }))).toBe('object');
  });

  it('rejects a label the user does not own, on create and update', () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'a');
    const b = makeUser(db, 'b');
    const own = createEventLabel(db, a.id, { name: 'Mine', color: '#ff0000' });
    const foreign = createEventLabel(db, b.id, { name: 'Theirs', color: '#00ff00' });
    if (own === 'limit' || foreign === 'limit') throw new Error('unexpected limit');

    expect(createCustomEvent(db, a.id, sampleEvent({ labelId: foreign.id }))).toBe('invalid_label');
    expect(createCustomEvent(db, a.id, sampleEvent({ labelId: 99999 }))).toBe('invalid_label');
    expect(listCustomEvents(db, a.id)).toEqual([]);

    const event = createCustomEvent(db, a.id, sampleEvent({ labelId: own.id }));
    if (typeof event === 'string') throw new Error(event);
    expect(event.labelId).toBe(own.id);

    expect(updateCustomEvent(db, a.id, event.id, sampleEvent({ labelId: foreign.id }))).toBe('invalid_label');
    expect(getCustomEvent(db, a.id, event.id)?.labelId).toBe(own.id);

    const cleared = updateCustomEvent(db, a.id, event.id, sampleEvent({ labelId: null }));
    expect(cleared).toMatchObject({ labelId: null });
  });

  it('nulls the label on its events and prunes hiddenLabels from that user views only', () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'a');
    const b = makeUser(db, 'b');
    const doomed = createEventLabel(db, a.id, { name: 'Doomed', color: '#ff0000' });
    const kept = createEventLabel(db, a.id, { name: 'Kept', color: '#00ff00' });
    if (doomed === 'limit' || kept === 'limit') throw new Error('unexpected limit');

    const withDoomed = createCustomEvent(db, a.id, sampleEvent({ title: 'Doomed event', labelId: doomed.id }));
    const withKept = createCustomEvent(db, a.id, sampleEvent({ title: 'Kept event', labelId: kept.id }));
    if (typeof withDoomed === 'string' || typeof withKept === 'string') throw new Error('create failed');

    const settingsWith = (hiddenLabels: number[]) => ({
      ...defaultViewSettings(),
      customEvents: { show: true, hiddenLabels, shareInLink: false },
    });
    const viewBoth = createView(db, a.id, 'Both', settingsWith([doomed.id, kept.id]));
    const viewOnlyKept = createView(db, a.id, 'Only kept', settingsWith([kept.id]));
    // Same numeric id in someone else's settings must stay untouched
    const foreignView = createView(db, b.id, 'Foreign', settingsWith([doomed.id]));

    db.prepare("UPDATE views SET updated_at = '2000-01-01T00:00:00.000Z'").run();

    expect(deleteEventLabel(db, a.id, doomed.id)).toBe(true);

    expect(getEventLabel(db, a.id, doomed.id)).toBeUndefined();
    // The event survives, just unlabeled
    expect(getCustomEvent(db, a.id, withDoomed.id)).toMatchObject({ title: 'Doomed event', labelId: null });
    expect(getCustomEvent(db, a.id, withKept.id)?.labelId).toBe(kept.id);

    const afterBoth = getView(db, a.id, viewBoth.id)!;
    expect(afterBoth.settings.customEvents.hiddenLabels).toEqual([kept.id]);
    expect(afterBoth.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
    // Views that did not list the label are not rewritten
    const afterOnlyKept = getView(db, a.id, viewOnlyKept.id)!;
    expect(afterOnlyKept.settings.customEvents.hiddenLabels).toEqual([kept.id]);
    expect(afterOnlyKept.updatedAt).toBe('2000-01-01T00:00:00.000Z');
    const afterForeign = getView(db, b.id, foreignView.id)!;
    expect(afterForeign.settings.customEvents.hiddenLabels).toEqual([doomed.id]);
    expect(afterForeign.updatedAt).toBe('2000-01-01T00:00:00.000Z');
  });

  it('leaves a label and its events alone when another user tries to delete it', () => {
    const db = openDb(':memory:');
    const a = makeUser(db, 'a');
    const b = makeUser(db, 'b');
    const label = createEventLabel(db, a.id, { name: 'Mine', color: '#ff0000' });
    if (label === 'limit') throw new Error('unexpected limit');
    const event = createCustomEvent(db, a.id, sampleEvent({ labelId: label.id }));
    if (typeof event === 'string') throw new Error(event);

    expect(deleteEventLabel(db, b.id, label.id)).toBe(false);
    expect(getCustomEvent(db, a.id, event.id)?.labelId).toBe(label.id);
  });

  it('skips rows whose stored data is corrupted', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    const good = createCustomEvent(db, user.id, sampleEvent({ title: 'Good' }));
    if (typeof good === 'string') throw new Error(good);

    const badJson = insertRawEvent(db, user.id, '{not json');
    const badSchema = insertRawEvent(db, user.id, JSON.stringify({ title: 5 }));
    const secret = 'SECRET-NOTE-CONTENT';
    const badUrl = insertRawEvent(
      db,
      user.id,
      JSON.stringify({ ...sampleEvent({ notes: secret }), labelId: undefined, url: 'javascript:alert(1)' }),
    );
    const good2 = createCustomEvent(db, user.id, sampleEvent({ title: 'Good 2' }));
    if (typeof good2 === 'string') throw new Error(good2);

    expect(listCustomEvents(db, user.id).map((e) => e.id)).toEqual([good.id, good2.id]);
    expect(getCustomEvent(db, user.id, badJson)).toBeUndefined();
    expect(getCustomEvent(db, user.id, badSchema)).toBeUndefined();
    expect(getCustomEvent(db, user.id, badUrl)).toBeUndefined();

    // Only ids are logged, never stored content
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain(String(badJson));
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('javascript');

    // A broken row can still be replaced or removed by its owner
    expect(hasCustomEvent(db, user.id, badJson)).toBe(true);
    const replaced = updateCustomEvent(db, user.id, badJson, sampleEvent({ title: 'Repaired' }));
    expect(replaced).toMatchObject({ id: badJson, title: 'Repaired' });
    expect(deleteCustomEvent(db, user.id, badSchema)).toBe(true);
  });

  it('refuses to store more than 16 KB of event data', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    expect(() => insertRawEvent(db, user.id, 'x'.repeat(16385))).toThrow();
    expect(() => insertRawEvent(db, user.id, 'x'.repeat(16384))).not.toThrow();
  });

  it('removes events and labels together with their user', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    const label = createEventLabel(db, user.id, { name: 'L', color: '#ff0000' });
    if (label === 'limit') throw new Error('unexpected limit');
    createCustomEvent(db, user.id, sampleEvent({ labelId: label.id }));

    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM custom_events').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM custom_event_labels').get()).toEqual({ n: 0 });
  });
});

describe('guest import', () => {
  it('rolls everything back when a write fails midway', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    // Bypasses the schema on purpose: oversized data trips the table CHECK after labels and one event are in
    const oversized = { ...sampleEvent(), notes: 'x'.repeat(20_000) };
    const data: GuestImportData = {
      labels: [{ ref: 1, name: 'L', color: '#ff0000' }],
      events: [sampleEvent({ labelId: 1 }), oversized],
      views: [{ name: 'V', settings: defaultViewSettings() }],
    };

    expect(() => importGuestData(db, user.id, data)).toThrow();
    expect(listEventLabels(db, user.id)).toEqual([]);
    expect(listCustomEvents(db, user.id)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM views WHERE user_id = ?').get(user.id)).toEqual({ n: 0 });
    // The connection is usable afterwards, so the transaction was closed
    expect(importGuestData(db, user.id, { labels: [], events: [sampleEvent()], views: [] })).toBe('ok');
  });
});

describe('view settings parsing', () => {
  it('fills customEvents defaults for settings stored before the feature existed', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    const legacy = JSON.stringify({
      sources: [{ sourceId: 7, courseMode: 'exclude', courses: [] }],
      calendarMode: 'month',
      showCancelled: true,
      colors: {},
    });
    const id = insertRawView(db, user.id, legacy);

    const view = getView(db, user.id, id)!;
    expect(view.settings.customEvents).toEqual({ show: true, hiddenLabels: [], shareInLink: false });
    // Existing fields are preserved; a source gains an empty hidden list
    expect(view.settings.calendarMode).toBe('month');
    expect(view.settings.sources).toEqual([{ sourceId: 7, courseMode: 'exclude', courses: [], hidden: [] }]);
  });

  it('falls back to defaults for unreadable or invalid settings JSON', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    const badJson = insertRawView(db, user.id, '{oops');
    const badSchema = insertRawView(db, user.id, JSON.stringify({ calendarMode: 'decade' }));

    expect(getView(db, user.id, badJson)!.settings).toEqual(defaultViewSettings());
    expect(getView(db, user.id, badSchema)!.settings).toEqual(defaultViewSettings());
  });

  it('resolves a share token to its owner and parsed settings', () => {
    const db = openDb(':memory:');
    const user = makeUser(db, 'a');
    const legacyId = insertRawView(db, user.id, JSON.stringify({ calendarMode: 'list' }));
    setViewShareToken(db, user.id, legacyId, 'tok-legacy');

    const context = getSharedViewContext(db, 'tok-legacy');
    expect(context?.userId).toBe(user.id);
    expect(context?.settings.calendarMode).toBe('list');
    expect(context?.settings.customEvents).toEqual({ show: true, hiddenLabels: [], shareInLink: false });
    expect(getSharedViewContext(db, 'unknown')).toBeUndefined();
  });
});
