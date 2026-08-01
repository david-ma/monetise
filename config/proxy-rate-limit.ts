/**
 * Per-IP rate limit for Monetise `/proxy/` unblocker fetches.
 *
 * Counts every request that reaches the unblocker branch (HTML/CSS/JS/XHR…).
 * Does not count `/proxy/client/`, cookie-gate `/?goto=`, or image→monet diversions.
 *
 * Uses Thalia sliding-window helpers (`recordSlidingWindowHit`) with a Map we own so
 * we can prune stale keys and report `keyCount` (stock `IpRateLimiter` never deletes keys).
 */
import { recordSlidingWindowHit } from 'thalia/util'

const DEFAULT_MAX = 300
const DEFAULT_WINDOW_MS = 12 * 60 * 60 * 1000

export type ProxyRateLimitStats = {
  keyCount: number
  allowed: number
  denied: number
  maxRequests: number
  windowMs: number
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function proxyRateLimitConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { maxRequests: number; windowMs: number } {
  return {
    maxRequests: parsePositiveInt(env.PROXY_RATE_MAX, DEFAULT_MAX),
    windowMs: parsePositiveInt(env.PROXY_RATE_WINDOW_MS, DEFAULT_WINDOW_MS),
  }
}

/**
 * In-memory limiter with stale-key cleanup and counters.
 * Single-process safe; multi-worker ⇒ effective limit ≈ N × max.
 */
export class ProxyRateLimiter {
  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly pruneEveryMs: number
  private readonly now: () => number
  private readonly hits = new Map<string, number[]>()
  private allowed = 0
  private denied = 0
  private lastPruneAt = 0

  constructor(
    options?: {
      maxRequests?: number
      windowMs?: number
      pruneEveryMs?: number
      now?: () => number
    },
  ) {
    const fromEnv = proxyRateLimitConfigFromEnv()
    this.maxRequests = options?.maxRequests ?? fromEnv.maxRequests
    this.windowMs = options?.windowMs ?? fromEnv.windowMs
    this.pruneEveryMs = options?.pruneEveryMs ?? 10 * 60 * 1000
    this.now = options?.now ?? Date.now
  }

  check(ip: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
    this.maybePrune()
    const key = ip || 'unknown-ip'
    const now = this.now()
    const current = this.hits.get(key) ?? []
    const result = recordSlidingWindowHit(current, now, this.windowMs, this.maxRequests)
    this.hits.set(key, result.timestampsMs)

    if (!result.allowed) {
      this.denied += 1
      return { allowed: false, retryAfterMs: result.retryAfterMs }
    }
    this.allowed += 1
    return { allowed: true }
  }

  private maybePrune(): void {
    const now = this.now()
    if (now - this.lastPruneAt < this.pruneEveryMs) return
    this.lastPruneAt = now
    this.pruneStaleKeys()
  }

  /** Drop keys with no timestamps left inside the window. */
  pruneStaleKeys(): number {
    const now = this.now()
    const cutoff = now - this.windowMs
    let removed = 0
    for (const [key, stamps] of this.hits) {
      const live = stamps.filter((t) => t > cutoff && t <= now)
      if (live.length === 0) {
        this.hits.delete(key)
        removed += 1
      } else if (live.length !== stamps.length) {
        this.hits.set(key, live)
      }
    }
    return removed
  }

  stats(): ProxyRateLimitStats {
    this.maybePrune()
    return {
      keyCount: this.hits.size,
      allowed: this.allowed,
      denied: this.denied,
      maxRequests: this.maxRequests,
      windowMs: this.windowMs,
    }
  }

  reset(key?: string): void {
    if (key === undefined) {
      this.hits.clear()
      this.allowed = 0
      this.denied = 0
      return
    }
    this.hits.delete(key)
  }
}

/** Process-wide limiter for the proxy controller. */
export const proxyRateLimiter = new ProxyRateLimiter()

/** IPs we've already emitted a prod-level rate-limit line for in this process. */
const rateLimitLoggedIps = new Set<string>()

export function respondProxyRateLimited(
  res: {
    writeHead: (code: number, headers?: Record<string, string>) => void
    end: (body?: string) => void
  },
  retryAfterMs: number,
  ip: string,
): void {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000))
  const key = ip || 'unknown-ip'
  const stats = proxyRateLimiter.stats()
  const summary = `proxy_rate_limited ip=${key} retryAfter=${retryAfterSec}s denied=${stats.denied} max=${stats.maxRequests}`

  // First deny for this IP: one quiet prod line. Further denies only in non-prod
  // (Node's console.debug still writes to stdout — do not rely on it for silence).
  if (!rateLimitLoggedIps.has(key)) {
    rateLimitLoggedIps.add(key)
    console.log(summary)
  } else if (process.env.NODE_ENV !== 'production') {
    console.debug(summary)
  }

  res.writeHead(429, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Retry-After': String(retryAfterSec),
  })
  res.end('Too many proxy requests. Please try again later.')
}
