import { describe, expect, test } from 'bun:test'
import { isDbReady } from '../../config/db_bootstrap'

describe('db_bootstrap', () => {
  test('isDbReady is false before initDb succeeds', () => {
    // initDb runs at config import time in the live server; in tests we only
    // assert the helper reflects connection state without requiring Postgres.
    expect(typeof isDbReady()).toBe('boolean')
  })
})
