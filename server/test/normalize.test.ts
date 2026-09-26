import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { impegniResponseSchema, impegnoSchema } from '../src/cineca/rawSchema.ts';
import { normalizeEvent } from '../src/cineca/normalize.ts';

const fixturePath = path.join(import.meta.dirname, 'fixtures/impegni.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('normalizeEvent with real Cineca data', () => {
  it('parses the fixture and extracts readable fields', () => {
    const parsed = impegniResponseSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const events = parsed.data.map((raw) => normalizeEvent(1, raw));
    expect(events.length).toBeGreaterThan(0);

    const first = events[0]!;
    expect(first.courseCode).toBe('INF0351');
    expect(first.courseName.length).toBeGreaterThan(0);
    expect(first.teachers.length).toBeGreaterThan(0);
    expect(first.rooms.length).toBeGreaterThan(0);
    expect(first.status).toBe('ok');
    expect(new Date(first.start).getTime()).toBeLessThan(new Date(first.end).getTime());
  });
});

function baseImpegno() {
  return {
    eventoId: 'e1',
    dataInizio: '2026-10-01T08:00:00.000Z',
    dataFine: '2026-10-01T10:00:00.000Z',
    stato: 'P',
  };
}

describe('normalizeEvent hardening against hostile input', () => {
  it('strips control characters but keeps notes as inert text', () => {
    const raw = {
      ...baseImpegno(),
      notePubbliche: '<script>alert(1)</script>\u0000\u0007 note',
      codiceAttivita: 'X',
      nome: 'Course',
    };
    const parsed = impegnoSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const event = normalizeEvent(1, parsed.data);
    expect(event.notes).toBe('<script>alert(1)</script> note');
  });

  it('rejects a javascript: teledidattica link', () => {
    const raw = { ...baseImpegno(), linkTeledidattica: 'javascript:alert(document.cookie)' };
    const parsed = impegnoSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const event = normalizeEvent(1, parsed.data);
    expect(event.onlineUrl).toBeNull();
  });

  it('rejects a data: teledidattica link', () => {
    const raw = { ...baseImpegno(), linkTeledidattica: 'data:text/html,<script>alert(1)</script>' };
    const parsed = impegnoSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const event = normalizeEvent(1, parsed.data);
    expect(event.onlineUrl).toBeNull();
  });

  it('accepts a genuine https teledidattica link', () => {
    const raw = { ...baseImpegno(), linkTeledidattica: 'https://meet.example.com/room' };
    const parsed = impegnoSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const event = normalizeEvent(1, parsed.data);
    expect(event.onlineUrl).toBe('https://meet.example.com/room');
  });

  it('falls back to the course code when the name is oversized', () => {
    const raw = { ...baseImpegno(), codiceAttivita: 'X', nome: 'A'.repeat(1000) };
    const parsed = impegnoSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.nome).toBeNull();
    const event = normalizeEvent(1, parsed.data);
    expect(event.courseName).toBe('X');
  });

  it('drops oversized teacher/room lists instead of accepting unbounded arrays', () => {
    const raw = {
      ...baseImpegno(),
      docenti: Array.from({ length: 100 }, (_, i) => ({ nome: 'A', cognome: String(i) })),
      aule: Array.from({ length: 50 }, () => ({ descrizione: 'Aula' })),
    };
    const parsed = impegnoSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // Over the cap: the field falls back to empty rather than failing the whole event
    expect(parsed.data.docenti).toEqual([]);
    expect(parsed.data.aule).toEqual([]);
  });

  it('maps annullato/sospeso status codes', () => {
    const cancelled = impegnoSchema.parse({ ...baseImpegno(), stato: 'A' });
    const suspended = impegnoSchema.parse({ ...baseImpegno(), stato: 'S' });
    expect(normalizeEvent(1, cancelled).status).toBe('cancelled');
    expect(normalizeEvent(1, suspended).status).toBe('suspended');
  });

  it('rejects a malformed impegno missing required dates', () => {
    const parsed = impegnoSchema.safeParse({ eventoId: 'e1', stato: 'P' });
    expect(parsed.success).toBe(false);
  });
});
