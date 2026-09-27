import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, request: requestMock };
});

const resolvePublicMock = vi.fn();
vi.mock('../src/cineca/ssrf.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cineca/ssrf.ts')>();
  return { ...actual, resolvePublic: resolvePublicMock };
});

const { fetchCinecaJson, CinecaFetchError } = await import('../src/cineca/client.ts');
const { SsrfError } = await import('../src/cineca/ssrf.ts');

const HOST = 'unito.prod.up.cineca.it';

function jsonResponse(statusCode: number, data: unknown) {
  const chunk = Buffer.from(JSON.stringify(data));
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: {
      [Symbol.asyncIterator]: async function* () {
        yield chunk;
      },
      destroy: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  requestMock.mockReset();
  resolvePublicMock.mockReset();
  resolvePublicMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchCinecaJson retry', () => {
  it('retries a transient network failure and succeeds', async () => {
    requestMock.mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const promise = fetchCinecaJson(HOST, '/api/x', { method: 'GET' });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ ok: true });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('retries a bad status code up to the attempt limit then throws', async () => {
    requestMock.mockResolvedValue(jsonResponse(503, {}));

    const promise = fetchCinecaJson(HOST, '/api/x', { method: 'GET' });
    const assertion = expect(promise).rejects.toBeInstanceOf(CinecaFetchError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry when the resolved address fails the SSRF check', async () => {
    resolvePublicMock.mockRejectedValue(new SsrfError('Refusing non-public address'));

    const promise = fetchCinecaJson(HOST, '/api/x', { method: 'GET' });
    const assertion = expect(promise).rejects.toBeInstanceOf(SsrfError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('does not retry an oversized response', async () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 'a');
    requestMock.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: {
        [Symbol.asyncIterator]: async function* () {
          yield big;
        },
        destroy: vi.fn(),
      },
    });

    const promise = fetchCinecaJson(HOST, '/api/x', { method: 'GET' });
    const assertion = expect(promise).rejects.toThrow('Response too large');
    await vi.runAllTimersAsync();
    await assertion;
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-allowlisted host without ever calling request', async () => {
    const promise = fetchCinecaJson('evil.example.com', '/api/x', { method: 'GET' });
    await expect(promise).rejects.toBeInstanceOf(CinecaFetchError);
    expect(requestMock).not.toHaveBeenCalled();
  });
});
