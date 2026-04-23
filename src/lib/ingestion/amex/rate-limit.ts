const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 10;

interface Bucket {
  timestamps: number[];
}

type Store = Map<string, Bucket>;

const globalKey = "__fdf_amex_csv_rate_limit__";
const g = globalThis as unknown as Record<string, Store | undefined>;
if (!g[globalKey]) g[globalKey] = new Map<string, Bucket>();
const store: Store = g[globalKey] as Store;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function hitRateLimit(
  key: string,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = store.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < WINDOW_MS);
  if (bucket.timestamps.length >= LIMIT) {
    const oldest = bucket.timestamps[0];
    store.set(key, bucket);
    return { ok: false, remaining: 0, resetAt: oldest + WINDOW_MS };
  }
  bucket.timestamps.push(now);
  store.set(key, bucket);
  return {
    ok: true,
    remaining: LIMIT - bucket.timestamps.length,
    resetAt: now + WINDOW_MS,
  };
}

export function resetRateLimit(): void {
  store.clear();
}
