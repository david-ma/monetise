/** Operator-run maintenance. Importing this module never connects to a database. */
export interface RetentionConnection {
  query(sql: string, values?: any[]): Promise<[any, any]>
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export type RetentionOptions = { days: number; batchSize: number; maxBatches: number; apply: boolean }
export const DEFAULT_RETENTION: RetentionOptions = { days: 30, batchSize: 1000, maxBatches: 100, apply: false }

export function parseRetentionOptions(args: string[]): RetentionOptions {
  const options = { ...DEFAULT_RETENTION }
  const seen = new Set<string>()
  for (const arg of args) {
    const [key, value, extra] = arg.split('=')
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`)
    seen.add(key)
    if (arg === '--apply') { options.apply = true; continue }
    const field = { '--days': 'days', '--batch-size': 'batchSize', '--max-batches': 'maxBatches' }[key]
    if (!field || !value || extra !== undefined || !/^[1-9]\d*$/.test(value)) throw new Error(`Invalid option: ${key}`)
    const n = Number(value)
    const maximum = field === 'days' ? 36500 : field === 'batchSize' ? 5000 : 10000
    if (!Number.isSafeInteger(n) || n > maximum) throw new Error(`Out of range: ${key}`)
    options[field as 'days' | 'batchSize' | 'maxBatches'] = n
  }
  return options
}

/** Whole UTC days; retains at least the requested number of 24-hour periods. */
export function retentionCutoff(now: Date, days: number): string {
  if (!Number.isInteger(days) || days < 1 || !Number.isFinite(now.getTime())) throw new Error('Invalid retention cutoff')
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - days * 86400000)
  return `${cutoff.toISOString().slice(0, 10)} 00:00:00`
}

async function transaction<T>(db: RetentionConnection, work: () => Promise<T>): Promise<T> {
  await db.beginTransaction()
  try {
    const result = await work()
    await db.commit()
    return result
  } catch (error) {
    await db.rollback()
    throw error
  }
}

const reportMetrics: Record<string, string> = {
  reports: 'COUNT(*)',
  images_scanned: 'SUM(GREATEST(images_scanned, 0))',
  images_replaced: 'SUM(GREATEST(images_replaced, 0))',
  backgrounds_replaced: 'SUM(GREATEST(backgrounds_replaced, 0))',
  canvases_replaced: 'SUM(GREATEST(canvases_replaced, 0))',
  skipped_already_monetised: 'SUM(GREATEST(skipped_already_monetised, 0))',
  page_load_ms_sum: 'SUM(GREATEST(COALESCE(page_load_ms, 0), 0))',
  page_load_samples: 'SUM(CASE WHEN page_load_ms >= 0 THEN 1 ELSE 0 END)',
  dom_content_loaded_ms_sum: 'SUM(GREATEST(COALESCE(dom_content_loaded_ms, 0), 0))',
  dom_content_loaded_samples: 'SUM(CASE WHEN dom_content_loaded_ms >= 0 THEN 1 ELSE 0 END)',
}

type EventTable = 'monetisation_reports' | 'server_visits'

/** Locks and summarises exactly the rows deleted, in one transaction. */
export async function archiveEventBatch(db: RetentionConnection, table: EventTable, cutoff: string, size: number): Promise<number> {
  return transaction(db, async () => {
    const reports = table === 'monetisation_reports'
    const time = reports ? 'reported_at' : 'visited_at'
    const unreferenced = reports ? '' : 'AND NOT EXISTS (SELECT 1 FROM monetisation_reports r WHERE r.server_visit_id = server_visits.id)'
    const [rows] = await db.query(
      `SELECT id FROM ${table} WHERE ${time} < ? ${unreferenced} ORDER BY ${time}, id LIMIT ? FOR UPDATE`, [cutoff, size],
    )
    if (!rows.length) return 0
    const ids = rows.map((row: { id: number }) => row.id)
    const placeholders = ids.map(() => '?').join(', ')
    const metrics = reports ? reportMetrics : { visits: 'COUNT(*)' }
    const columns = Object.keys(metrics)
    await db.query(`INSERT INTO traffic_daily_summaries (day, kind, ${columns.join(', ')})
      SELECT DATE(${time}), ${reports ? "'monetisation_report'" : 'kind'}, ${Object.values(metrics).join(', ')}
      FROM ${table} WHERE id IN (${placeholders}) AND deleted_at IS NULL
      GROUP BY DATE(${time})${reports ? '' : ', kind'}
      ON DUPLICATE KEY UPDATE ${columns.map((column) => `${column} = ${column} + VALUES(${column})`).join(', ')}`, ids)
    const [deleted] = await db.query(`DELETE FROM ${table} WHERE id IN (${placeholders})`, ids)
    if (deleted.affectedRows !== ids.length) throw new Error('Archive/delete row count mismatch')
    return ids.length
  })
}

/** Scan a bounded ID range; retained parents do not starve later orphan rows. */
export async function pruneOrphanBatch(db: RetentionConnection, table: 'sites' | 'visitors', cutoff: string, size: number): Promise<{ scanned: number; deleted: number }> {
  return transaction(db, async () => {
    await db.query('INSERT IGNORE INTO traffic_retention_cursors (table_name, last_id) VALUES (?, 0)', [table])
    const [cursor] = await db.query('SELECT last_id FROM traffic_retention_cursors WHERE table_name = ? FOR UPDATE', [table])
    const [rows] = await db.query(`SELECT id FROM ${table} WHERE id > ? ORDER BY id LIMIT ? FOR UPDATE`, [cursor[0].last_id, size])
    if (!rows.length) {
      await db.query('UPDATE traffic_retention_cursors SET last_id = 0 WHERE table_name = ?', [table])
      return { scanned: 0, deleted: 0 }
    }
    const ids = rows.map((row: { id: number }) => row.id)
    const foreignKey = table === 'sites' ? 'site_id' : 'visitor_id'
    const [deleted] = await db.query(`DELETE FROM ${table} WHERE id IN (${ids.map(() => '?').join(', ')})
      AND created_at < ? AND NOT EXISTS (SELECT 1 FROM server_visits v WHERE v.${foreignKey} = ${table}.id)`, [...ids, cutoff])
    await db.query('UPDATE traffic_retention_cursors SET last_id = ? WHERE table_name = ?', [ids.at(-1), table])
    return { scanned: ids.length, deleted: deleted.affectedRows }
  })
}

/** Caller owns one dedicated connection. Never use a pool-level advisory lock. */
export async function runRetention(db: RetentionConnection, options: RetentionOptions, cutoff: string) {
  if (!options.apply) throw new Error('Apply mode required')
  const [lock] = await db.query("SELECT GET_LOCK('monetise:traffic-retention', 0) AS acquired")
  if (Number(lock[0]?.acquired) !== 1) throw new Error('Another retention job holds the lock')
  const counts = { monetisation_reports: 0, server_visits: 0, sites: 0, visitors: 0 }
  const budgetReached: string[] = []
  try {
    const [engines] = await db.query(`SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('monetisation_reports', 'server_visits', 'sites', 'visitors', 'traffic_daily_summaries', 'traffic_retention_cursors')`)
    if (engines.length !== 6 || engines.some((table: { engine: string }) => table.engine !== 'InnoDB')) {
      throw new Error('Retention requires all six tables to exist and use InnoDB')
    }
    await db.query("SET SESSION time_zone = '+00:00'")
    await db.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED')
    await db.query('SET SESSION innodb_lock_wait_timeout = 5')
    for (const table of ['monetisation_reports', 'server_visits', 'sites', 'visitors'] as const) {
      for (let batch = 0; batch < options.maxBatches; batch++) {
        const result = table === 'sites' || table === 'visitors'
          ? await pruneOrphanBatch(db, table, cutoff, options.batchSize)
          : await archiveEventBatch(db, table, cutoff, options.batchSize).then((n) => ({ scanned: n, deleted: n }))
        counts[table] += result.deleted
        if (!result.scanned) break
        if (batch === options.maxBatches - 1) budgetReached.push(table)
      }
    }
    return { cutoffUtc: cutoff, deleted: counts, budgetReached }
  } finally {
    await db.query("SELECT RELEASE_LOCK('monetise:traffic-retention')")
  }
}
