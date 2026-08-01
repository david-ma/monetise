import { describe, expect, test } from 'bun:test'
import {
  ProxyRateLimiter,
  proxyRateLimitConfigFromEnv,
} from '../../config/proxy-rate-limit'

describe('proxyRateLimitConfigFromEnv', () => {
  test('defaults to 30 / 12h', () => {
    const cfg = proxyRateLimitConfigFromEnv({})
    expect(cfg.maxRequests).toBe(30)
    expect(cfg.windowMs).toBe(12 * 60 * 60 * 1000)
  })

  test('reads PROXY_RATE_MAX and PROXY_RATE_WINDOW_MS', () => {
    const cfg = proxyRateLimitConfigFromEnv({
      PROXY_RATE_MAX: '10',
      PROXY_RATE_WINDOW_MS: '60000',
    })
    expect(cfg.maxRequests).toBe(10)
    expect(cfg.windowMs).toBe(60_000)
  })
})

describe('ProxyRateLimiter', () => {
  test('allows under the limit and denies at capacity', () => {
    let clock = 1_000_000
    const limiter = new ProxyRateLimiter({
      maxRequests: 3,
      windowMs: 60_000,
      pruneEveryMs: 60_000,
      now: () => clock,
    })

    expect(limiter.check('1.1.1.1').allowed).toBe(true)
    expect(limiter.check('1.1.1.1').allowed).toBe(true)
    expect(limiter.check('1.1.1.1').allowed).toBe(true)
    const denied = limiter.check('1.1.1.1')
    expect(denied.allowed).toBe(false)
    if (!denied.allowed) {
      expect(denied.retryAfterMs).toBeGreaterThan(0)
    }
    expect(limiter.stats().denied).toBe(1)
    expect(limiter.stats().allowed).toBe(3)
  })

  test('tracks IPs independently', () => {
    const limiter = new ProxyRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      pruneEveryMs: 60_000,
    })
    expect(limiter.check('1.1.1.1').allowed).toBe(true)
    expect(limiter.check('2.2.2.2').allowed).toBe(true)
    expect(limiter.check('1.1.1.1').allowed).toBe(false)
    expect(limiter.stats().keyCount).toBe(2)
  })

  test('pruneStaleKeys drops idle IPs after the window', () => {
    let clock = 1_000_000
    const limiter = new ProxyRateLimiter({
      maxRequests: 5,
      windowMs: 1_000,
      pruneEveryMs: 1,
      now: () => clock,
    })

    expect(limiter.check('9.9.9.9').allowed).toBe(true)
    expect(limiter.stats().keyCount).toBe(1)

    clock += 2_000
    const removed = limiter.pruneStaleKeys()
    expect(removed).toBe(1)
    expect(limiter.stats().keyCount).toBe(0)
  })
})
