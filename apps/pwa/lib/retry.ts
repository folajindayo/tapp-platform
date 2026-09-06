// Generic retry with full-jitter exponential backoff.
//
// Use for any IO call that has a non-trivial chance of transient
// failure (rate-limit, 5xx, brief network blip). Per AWS's
// "Exponential Backoff and Jitter" guidance, full jitter is the
// least-bad pattern for thundering-herd avoidance — sleep a random
// duration uniformly in [0, base * 2^attempt].

export interface RetryOptions {
  /** Maximum number of attempts including the first. Default 3. */
  attempts?: number;
  /** Base delay in ms — first retry sleeps in [0, base]. Default 250ms. */
  baseDelayMs?: number;
  /** Cap on a single sleep, to bound worst-case latency. Default 4000ms. */
  maxDelayMs?: number;
  /** Predicate: should we retry on this error? Default: always. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Called before each retry (logging, metrics). */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const base = options.baseDelayMs ?? 250;
  const cap = options.maxDelayMs ?? 4000;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !shouldRetry(err, attempt)) throw err;
      const exp = Math.min(cap, base * Math.pow(2, attempt - 1));
      const sleep = Math.floor(Math.random() * exp); // full jitter
      options.onRetry?.(err, attempt, sleep);
      await new Promise((r) => setTimeout(r, sleep));
    }
  }
  // Unreachable — the loop either returns or throws — but TypeScript
  // can't infer that from the structure.
  throw lastErr;
}
