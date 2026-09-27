// Cineca occasionally times out or errors under load; retry a few times
// with exponential backoff before surfacing an error to the user.
export const CINECA_QUERY_RETRY = 3;

export function cinecaRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 8000);
}
