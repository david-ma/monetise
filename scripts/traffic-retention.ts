import { createConnection } from 'mysql2/promise'
import { DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE } from '../drizzle.config'
import { parseRetentionOptions, retentionCutoff, runRetention } from '../models/traffic-retention'

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: bun scripts/traffic-retention.ts [--apply] [--days=30] [--batch-size=1000] [--max-batches=100]')
  console.log('Default: read-only size report. Apply: archive then delete old traffic in bounded transactions. Budget is per table. UTC days; no table rebuilds.')
} else {
  let db: Awaited<ReturnType<typeof createConnection>> | undefined
  try {
    const options = parseRetentionOptions(args)
    db = await createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USERNAME, password: DB_PASSWORD,
      database: DB_DATABASE, timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 10000 })
    await db.query("SET SESSION time_zone = '+00:00'")
    const [clock] = await db.query<any[]>('SELECT UTC_TIMESTAMP() AS now')
    const cutoff = retentionCutoff(new Date(clock[0].now), options.days)
    if (options.apply) {
      console.log(JSON.stringify(await runRetention(db, options, cutoff), null, 2))
    } else {
      const [tables] = await db.query<any[]>(`SELECT TABLE_NAME AS table_name, ENGINE AS engine, TABLE_ROWS AS estimated_rows,
        DATA_LENGTH AS data_bytes, INDEX_LENGTH AS index_bytes, DATA_FREE AS internally_free_bytes
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY DATA_LENGTH + INDEX_LENGTH DESC`)
      const oldest: Record<string, unknown> = {}
      for (const [table, time] of [['server_visits', 'visited_at'], ['monetisation_reports', 'reported_at']]) {
        const [rows] = await db.query<any[]>(`SELECT ${time} AS oldest FROM ${table} ORDER BY ${time} LIMIT 1`)
        oldest[table] = rows[0]?.oldest ?? null
      }
      const [settings] = await db.query('SELECT @@version AS version, @@innodb_file_per_table AS file_per_table')
      const latestSummaries = tables.some((table) => table.table_name === 'traffic_daily_summaries')
        ? (await db.query('SELECT * FROM traffic_daily_summaries ORDER BY day DESC, kind LIMIT 90'))[0] : []
      console.log(JSON.stringify({ mode: 'read-only', cutoffUtc: cutoff, settings, tables, oldest,
        latestSummaries, note: 'Latest 90 summary rows only; summaries cover archived events, so a day may be partial while catching up. Metadata sizes/row estimates are not reclaimable bytes. No full-table eligibility COUNT is performed.' }, null, 2))
    }
  } catch (error) {
    // Driver messages/SQL may contain URLs, IPs or credentials; never print them.
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'RETENTION_FAILED'
    console.error(`Traffic retention failed (${/^[A-Z0-9_]+$/.test(code) ? code : 'RETENTION_FAILED'}). Check options, migration, connection and job lock. Completed batches remain committed; the failed batch rolls back. Safe to rerun.`)
    process.exitCode = 1
  } finally { await db?.end() }
}
