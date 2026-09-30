/** FIFO limiter: runs at most `max` tasks at once, the rest wait in arrival order. */
export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await fn();
    } finally {
      // Hand the slot straight to the next waiter, else free it
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
