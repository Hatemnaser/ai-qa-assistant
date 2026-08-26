export const DEFAULT_MAX_TRACKED_RATE_LIMIT_KEYS = 10_000;

export interface FixedWindowRateLimitResult {
  limited: boolean;
  resetAt: number;
}

export interface FixedWindowRateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
  maxTrackedKeys?: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface Expiration {
  key: string;
  resetAt: number;
}

/**
 * Process-local fixed-window storage for coarse application abuse controls.
 *
 * The entry map has a hard cardinality bound. Expirations are kept in a
 * min-heap, so ordinary consumes do not scan every tracked identity and each
 * expiration is inserted and removed once. When the store is full, an unseen
 * identity is rejected without evicting an active identity's abuse history.
 */
export class InMemoryFixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly expirations: Expiration[] = [];
  private readonly maxTrackedKeys: number;

  constructor(private readonly options: FixedWindowRateLimiterOptions) {
    assertPositiveSafeInteger(options.maxAttempts, "maxAttempts");
    assertPositiveSafeInteger(options.windowMs, "windowMs");

    this.maxTrackedKeys =
      options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_RATE_LIMIT_KEYS;
    assertPositiveSafeInteger(this.maxTrackedKeys, "maxTrackedKeys");
  }

  consume(key: string, now = Date.now()): FixedWindowRateLimitResult {
    this.evictExpired(now);

    const current = this.entries.get(key);
    if (current) {
      current.count += 1;
      return {
        limited: current.count > this.options.maxAttempts,
        resetAt: current.resetAt,
      };
    }

    const resetAt = now + this.options.windowMs;
    if (this.entries.size >= this.maxTrackedKeys) {
      return { limited: true, resetAt };
    }

    this.entries.set(key, { count: 1, resetAt });
    pushExpiration(this.expirations, { key, resetAt });

    return { limited: false, resetAt };
  }

  reset() {
    this.entries.clear();
    this.expirations.length = 0;
  }

  get trackedKeyCount() {
    return this.entries.size;
  }

  private evictExpired(now: number) {
    while (this.expirations[0] && this.expirations[0].resetAt <= now) {
      const expiration = popExpiration(this.expirations);
      if (!expiration) {
        return;
      }

      const current = this.entries.get(expiration.key);
      if (current?.resetAt === expiration.resetAt) {
        this.entries.delete(expiration.key);
      }
    }
  }
}

function assertPositiveSafeInteger(value: number, optionName: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${optionName} must be a positive safe integer.`);
  }
}

function pushExpiration(heap: Expiration[], expiration: Expiration) {
  heap.push(expiration);
  let index = heap.length - 1;

  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    const parent = heap[parentIndex];
    if (!parent || parent.resetAt <= expiration.resetAt) {
      break;
    }

    heap[index] = parent;
    index = parentIndex;
  }

  heap[index] = expiration;
}

function popExpiration(heap: Expiration[]) {
  const earliest = heap[0];
  if (!earliest) {
    return undefined;
  }

  const last = heap.pop();
  if (!last || heap.length === 0) {
    return earliest;
  }

  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    const left = heap[leftIndex];
    const right = heap[rightIndex];

    if (!left) {
      break;
    }

    const childIndex = right && right.resetAt < left.resetAt
      ? rightIndex
      : leftIndex;
    const child = heap[childIndex];
    if (!child || child.resetAt >= last.resetAt) {
      break;
    }

    heap[index] = child;
    index = childIndex;
  }

  heap[index] = last;
  return earliest;
}
