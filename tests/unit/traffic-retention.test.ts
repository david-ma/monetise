import { describe, expect, test } from 'bun:test'
import { archiveEventBatch, parseRetentionOptions, pruneOrphanBatch, retentionCutoff, runRetention, type RetentionConnection } from '../../models/traffic-retention'
import { withTrafficTransaction, type MonetiseDb } from '../../models/queries'

/** Transaction fault fixture: exercises commit/rollback and retry boundaries offline.
 * This does not emulate MariaDB's SQL parser or locking; restored-copy checks remain required. */
function eventFixture(failDelete = false, mismatch = false) {
  let state = { ids: [10, 11], summary: 0 }
  let before = structuredClone(state)
  const commands: { sql: string; values?: any[] }[] = []
  const calls: string[] = []
  const db: RetentionConnection = {
    async beginTransaction() { calls.push('begin'); before = structuredClone(state) },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback'); state = before },
    async query(sql, values) {
      commands.push({ sql, values })
      if (sql.startsWith('SELECT id')) return [state.ids.map((id) => ({ id })), []]
      if (sql.startsWith('INSERT INTO traffic_daily_summaries')) { state.summary += state.ids.length; return [{}, []] }
      if (sql.startsWith('DELETE FROM')) {
        if (failDelete) { failDelete = false; throw new Error('Simulated deletion failure') }
        const affectedRows = state.ids.length - Number(mismatch)
        state.ids = []
        return [{ affectedRows }, []]
      }
      throw new Error(`Unexpected fixture statement: ${sql}`)
    },
  }
  return { db, commands, calls, state: () => state }
}

describe('traffic retention boundaries', () => {
  test('defaults to a read-only 30-day run; rejects malformed and excessive budgets', () => {
    expect(parseRetentionOptions([])).toEqual({ apply: false, days: 30, batchSize: 1000, maxBatches: 100 })
    expect(parseRetentionOptions(['--apply', '--days=7', '--batch-size=5', '--max-batches=2']).apply).toBe(true)
    for (const arg of ['--days=0', '--days=-1', '--days=1.5', '--batch-size=5001', '--max-batches=10001', '--apply=false', '--wat', '--days=2=3']) {
      expect(() => parseRetentionOptions([arg])).toThrow()
    }
    expect(() => parseRetentionOptions(['--days=7', '--days=30'])).toThrow()
  })

  test('cutoff uses complete UTC days through Sydney daylight-saving and leap days', () => {
    expect(retentionCutoff(new Date('2026-10-03T23:59:59Z'), 30)).toBe('2026-09-03 00:00:00')
    expect(retentionCutoff(new Date('2026-10-05T00:30:00+11:00'), 30)).toBe('2026-09-04 00:00:00')
    expect(retentionCutoff(new Date('2024-03-01T12:00:00Z'), 1)).toBe('2024-02-29 00:00:00')
  })

  test('a failed deletion restores both detail and summary; retry counts each event once', async () => {
    const fixture = eventFixture(true)
    await expect(archiveEventBatch(fixture.db, 'server_visits', '2026-09-03 00:00:00', 1000)).rejects.toThrow()
    expect(fixture.state()).toEqual({ ids: [10, 11], summary: 0 })
    expect(await archiveEventBatch(fixture.db, 'server_visits', '2026-09-03 00:00:00', 1000)).toBe(2)
    expect(await archiveEventBatch(fixture.db, 'server_visits', '2026-09-03 00:00:00', 1000)).toBe(0)
    expect(fixture.state()).toEqual({ ids: [], summary: 2 })
    expect(fixture.calls).toEqual(['begin', 'rollback', 'begin', 'commit', 'begin', 'commit'])
    const select = fixture.commands[0]
    expect(select.sql).toContain('NOT EXISTS') // A recent report keeps its parent visit.
    expect(select.sql).toContain('LIMIT ? FOR UPDATE')
    expect(select.values).toEqual(['2026-09-03 00:00:00', 1000])
    expect(fixture.commands.find((q) => q.sql.startsWith('DELETE'))?.values).toEqual([10, 11])
  })

  test('an unexpected delete count aborts the summary as well', async () => {
    const fixture = eventFixture(false, true)
    await expect(archiveEventBatch(fixture.db, 'server_visits', '2026-09-03 00:00:00', 1000)).rejects.toThrow('row count mismatch')
    expect(fixture.state()).toEqual({ ids: [10, 11], summary: 0 })
  })

  test('report summary uses report day and separate timing sample counts, without visitor identity', async () => {
    const fixture = eventFixture()
    await archiveEventBatch(fixture.db, 'monetisation_reports', '2026-09-03 00:00:00', 1000)
    const summary = fixture.commands.find((q) => q.sql.startsWith('INSERT'))!
    expect(summary.sql).toContain('DATE(reported_at)')
    expect(summary.sql).toContain('CASE WHEN page_load_ms >= 0 THEN 1 ELSE 0 END')
    expect(summary.sql).toContain('deleted_at IS NULL')
    expect(summary.sql).not.toMatch(/page_url|visit_token|visitor_id|document_title/)
    expect(summary.values).toEqual([10, 11])
  })

  test('orphan scan advances past retained rows and resets only at end of table', async () => {
    let cursor = 0
    let phase = 0
    const commands: string[] = []
    const db: RetentionConnection = {
      async beginTransaction() {}, async commit() {}, async rollback() {},
      async query(sql, values) {
        commands.push(sql)
        if (sql.startsWith('SELECT last_id')) return [[{ last_id: cursor }], []]
        if (sql.startsWith('SELECT id')) return [phase++ === 0 ? [{ id: 20 }, { id: 21 }] : [], []]
        if (sql.startsWith('DELETE')) return [{ affectedRows: 0 }, []]
        if (sql.startsWith('UPDATE')) cursor = sql.includes('= 0') ? 0 : values![0]
        return [{}, []]
      },
    }
    expect(await pruneOrphanBatch(db, 'sites', '2026-09-03 00:00:00', 2)).toEqual({ scanned: 2, deleted: 0 })
    expect(cursor).toBe(21)
    expect(commands.find((q) => q.startsWith('DELETE'))).toContain('created_at < ? AND NOT EXISTS')
    expect(await pruneOrphanBatch(db, 'sites', '2026-09-03 00:00:00', 2)).toEqual({ scanned: 0, deleted: 0 })
    expect(cursor).toBe(0)
  })

  test('apply is explicit and contention never starts maintenance', async () => {
    let queries = 0
    const db = { async query() { queries++; return [[{ acquired: 0 }], []] } } as unknown as RetentionConnection
    await expect(runRetention(db, parseRetentionOptions([]), '')).rejects.toThrow('Apply mode')
    expect(queries).toBe(0)
    await expect(runRetention(db, parseRetentionOptions(['--apply']), '')).rejects.toThrow('holds the lock')
    expect(queries).toBe(1)
  })

  test('maintenance releases its connection lock after a failed batch', async () => {
    const fixture = eventFixture(true)
    const query = fixture.db.query.bind(fixture.db)
    let released = false
    fixture.db.query = async (sql, values) => {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []]
      if (sql.includes('RELEASE_LOCK')) { released = true; return [[{}], []] }
      if (sql.includes('information_schema.TABLES')) return [Array.from({ length: 6 }, () => ({ engine: 'InnoDB' })), []]
      if (sql.startsWith('SET SESSION')) return [{}, []]
      return query(sql, values)
    }
    await expect(runRetention(fixture.db, parseRetentionOptions(['--apply']), '')).rejects.toThrow()
    expect(released).toBe(true)
    expect(fixture.state().summary).toBe(0)
  })

  test('missing or non-transactional tables fail before any deletion', async () => {
    let began = false
    let released = false
    const db = {
      async beginTransaction() { began = true },
      async query(sql: string) {
        if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []]
        if (sql.includes('RELEASE_LOCK')) { released = true; return [[], []] }
        return [[{ name: 'server_visits', engine: 'MyISAM' }], []]
      },
    } as unknown as RetentionConnection
    await expect(runRetention(db, parseRetentionOptions(['--apply']), '')).rejects.toThrow('InnoDB')
    expect(began).toBe(false)
    expect(released).toBe(true)
  })

  test('ingestion retries only transient locking errors and bounds retry attempts', async () => {
    let attempts = 0
    const db = { async transaction(work: () => Promise<string>) {
      attempts++
      if (attempts < 3) throw { cause: { errno: 1213 } }
      return work()
    } } as unknown as MonetiseDb
    expect(await withTrafficTransaction(db, async () => 'logged')).toBe('logged')
    expect(attempts).toBe(3)
    let errors = 0
    const failing = { async transaction() { errors++; throw { errno: 1205 } } } as unknown as MonetiseDb
    await expect(withTrafficTransaction(failing, async () => 'no')).rejects.toEqual({ errno: 1205 })
    expect(errors).toBe(3)
    errors = 0
    const permanent = { async transaction() { errors++; throw { errno: 1452 } } } as unknown as MonetiseDb
    await expect(withTrafficTransaction(permanent, async () => 'no')).rejects.toEqual({ errno: 1452 })
    expect(errors).toBe(1)
  })
})
