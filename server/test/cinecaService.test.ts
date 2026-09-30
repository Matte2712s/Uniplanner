import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/index.ts';
import { insertSource, saveHostClienteId } from '../src/db/repo.ts';

const fetchMock = vi.fn();
vi.mock('../src/cineca/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cineca/client.ts')>();
  return { ...actual, fetchCinecaJson: fetchMock };
});

const { getEventsForSource, SourceDownError, SourceUnavailableError } = await import('../src/cineca/service.ts');

const HOST = 'unito.prod.up.cineca.it';
const SOURCE = { id: 1, host: HOST, linkCalendarioId: '613b9237d969e100173d4110' };
// Three weeks, fetched as one batch
const FROM = new Date('2026-11-02T00:00:00Z');
const TO = new Date('2026-11-23T00:00:00Z');

function db() {
  const d = openDb(':memory:');
  saveHostClienteId(d, HOST, 'cliente-1');
  // Fetched weeks are cached against the source row
  insertSource(d, { kind: 'default', host: HOST, link_calendario_id: SOURCE.linkCalendarioId, title: 'Canale A', title_en: null, created_by: null });
  return d;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('getEventsForSource failures', () => {
  it('reports the source as down when every week of the batch fails', async () => {
    fetchMock.mockRejectedValue(new Error('Connect Timeout Error'));

    const err = await getEventsForSource(db(), SOURCE, FROM, TO).catch((e) => e);

    expect(err).toBeInstanceOf(SourceDownError);
    expect(err.message).toContain('Connect Timeout Error');
  });

  it('reports a plain unavailable error when only some weeks fail', async () => {
    fetchMock.mockResolvedValueOnce([]).mockRejectedValue(new Error('Unexpected status 503'));

    const err = await getEventsForSource(db(), SOURCE, FROM, TO).catch((e) => e);

    expect(err).toBeInstanceOf(SourceUnavailableError);
    expect(err).not.toBeInstanceOf(SourceDownError);
  });
});
