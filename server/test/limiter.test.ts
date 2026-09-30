import { describe, expect, it } from 'vitest';
import { createLimiter } from '../src/limiter.ts';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createLimiter', () => {
  it('caps concurrency and starts waiting tasks in arrival order', async () => {
    const run = createLimiter(2);
    const started: number[] = [];
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const task = (n: number) =>
      run(async () => {
        started.push(n);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      });

    const all = [1, 2, 3, 4].map(task);
    await flush();
    expect(started).toEqual([1, 2]);

    releases[0]!();
    await flush();
    expect(started).toEqual([1, 2, 3]);

    releases[1]!();
    await flush();
    expect(started).toEqual([1, 2, 3, 4]);

    releases[2]!();
    releases[3]!();
    await Promise.all(all);
    expect(peak).toBe(2);
  });

  it('frees the slot when a task fails', async () => {
    const run = createLimiter(1);
    await expect(
      run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(run(async () => 'ok')).resolves.toBe('ok');
  });
});
