import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, type Connection } from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { archiveEventBatch, parseRetentionOptions, pruneOrphanBatch, runRetention } from '../../models/traffic-retention'
import {
  convertServerVisitToBlocked,
  recordMonetisationReport,
  recordServerVisit,
  type MonetiseDb,
} from '../../models/queries'

// Explicit opt-in. No env database URLs, default option files, TCP or existing
// datadirs are used. Only an already installed server and a fresh temp directory.
const enabled = process.env.RUN_RETENTION_DB_TESTS === '1'
describe.skipIf(!enabled)('traffic retention in an isolated MariaDB', () => {
  let directory: string
  let server: ReturnType<typeof Bun.spawn> | undefined
  let db: Connection | undefined
  const cutoff = '2026-09-03 00:00:00'
  const options = parseRetentionOptions(['--apply', '--batch-size=2', '--max-batches=10'])

  beforeAll(async () => {
    const installer = Bun.which('mariadb-install-db')
    const daemon = Bun.which('mariadbd')
    if (!installer || !daemon) throw new Error('Operator must provide existing MariaDB tools for this opt-in test')
    directory = await mkdtemp(join(tmpdir(), 'monetise-retention-test-'))
    const init = Bun.spawn([installer, '--no-defaults', `--datadir=${directory}/data`, '--auth-root-authentication-method=normal', '--skip-test-db'], { stdout: 'ignore', stderr: 'ignore' })
    if (await init.exited !== 0) throw new Error('Ephemeral MariaDB initialisation failed')
    server = Bun.spawn([daemon, '--no-defaults', `--datadir=${directory}/data`, `--socket=${directory}/mysql.sock`, '--skip-networking', `--pid-file=${directory}/mysql.pid`, `--log-error=${directory}/mysql.log`, '--innodb-buffer-pool-size=32M'], { stdout: 'ignore', stderr: 'ignore' })
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        db = await createConnection({ socketPath: `${directory}/mysql.sock`, user: 'root', timezone: 'Z' })
        break
      } catch { await Bun.sleep(100) }
    }
    if (!db) throw new Error(`Ephemeral server did not start: ${await readFile(`${directory}/mysql.log`, 'utf8')}`)
    await db.query('CREATE DATABASE retention_fixture')
    await db.query('USE retention_fixture')
    await db.query("SET SESSION time_zone = '+00:00'")
    const migrations = new URL('../../drizzle/', import.meta.url)
    for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(file, migrations), 'utf8')
      for (const statement of sql.split('--> statement-breakpoint').filter((part) => part.trim())) await db.query(statement)
    }
  }, 30000)

  afterAll(async () => {
    await db?.end()
    if (server) { server.kill('SIGTERM'); await server.exited }
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  beforeEach(async () => {
    for (const table of ['monetisation_reports', 'server_visits', 'sites', 'visitors', 'traffic_daily_summaries', 'traffic_retention_cursors', 'paintings']) await db!.query(`DELETE FROM ${table}`)
    await db!.query("INSERT INTO sites (id, url, created_at) VALUES (1, 'https://example.test/old', '2026-09-01'), (2, 'https://example.test/recent', '2026-10-02'), (3, 'https://example.test/orphan', '2026-09-01')")
    await db!.query("INSERT INTO visitors (id, ip, created_at) VALUES (1, '192.0.2.1', '2026-09-01'), (2, '192.0.2.2', '2026-10-02'), (3, '192.0.2.3', '2026-09-01')")
    await db!.query("INSERT INTO server_visits (id, site_id, visitor_id, kind, visited_at, visit_token) VALUES (1, 1, 1, 'proxy_document', '2026-09-01', 'old-one'), (2, 1, 1, 'proxy_document', '2026-09-01', 'old-two'), (3, 2, 2, 'mirror_request', '2026-10-02', 'recent')")
    await db!.query("INSERT INTO paintings (title) VALUES ('Keep this painting')")
  })

  async function count(table: string) { return Number((await db!.query<any[]>(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n) }

  test('real migrations, aggregation, retention boundary, orphans and reruns', async () => {
    await db!.query("INSERT INTO monetisation_reports (server_visit_id, reported_at, page_load_ms, images_replaced) VALUES (1, '2026-09-01', 100, 2), (2, '2026-09-01', NULL, 3), (3, '2026-10-02', 200, 4)")
    const first = await runRetention(db!, options, cutoff)
    expect(first.deleted).toEqual({ monetisation_reports: 2, server_visits: 2, sites: 2, visitors: 2 })
    expect(await count('paintings')).toBe(1)
    expect(await count('server_visits')).toBe(1)
    const [rows] = await db!.query<any[]>('SELECT * FROM traffic_daily_summaries ORDER BY kind')
    const report = rows.find((row) => row.kind === 'monetisation_report')
    expect([Number(report.reports), Number(report.images_replaced), Number(report.page_load_ms_sum), Number(report.page_load_samples)]).toEqual([2, 5, 100, 1])
    expect(Number(rows.find((row) => row.kind === 'proxy_document').visits)).toBe(2)
    expect((await runRetention(db!, options, cutoff)).deleted).toEqual({ monetisation_reports: 0, server_visits: 0, sites: 0, visitors: 0 })
    expect((await db!.query('SELECT * FROM traffic_daily_summaries ORDER BY kind'))[0]).toEqual(rows)
  })

  test('a recent report pins an older visit until both become eligible', async () => {
    await db!.query("INSERT INTO monetisation_reports (server_visit_id, reported_at) VALUES (1, '2026-10-02')")
    expect((await runRetention(db!, options, cutoff)).deleted.server_visits).toBe(1)
    expect(await count('server_visits')).toBe(2)
    await runRetention(db!, options, '2026-11-01 00:00:00')
    expect(await count('server_visits')).toBe(0)
    expect(Number((await db!.query<any[]>("SELECT visits FROM traffic_daily_summaries WHERE kind = 'proxy_document'"))[0][0].visits)).toBe(2)
  })

  test('per-table budget stops catch-up and the cutoff instant is retained', async () => {
    await db!.query("INSERT INTO server_visits (id, site_id, visitor_id, kind, visited_at) VALUES (4, 1, 1, 'homepage', '2026-09-03')")
    const result = await runRetention(db!, parseRetentionOptions(['--apply', '--batch-size=1', '--max-batches=1']), cutoff)
    expect(result.deleted.server_visits).toBe(1)
    expect(result.budgetReached).toContain('server_visits')
    await runRetention(db!, options, cutoff)
    expect((await db!.query<any[]>('SELECT id FROM server_visits ORDER BY id'))[0].map((row) => row.id)).toEqual([3, 4])
  })

  test('SQL deletion failure rolls back summary writes and detail deletion', async () => {
    await db!.query("CREATE TRIGGER retention_failure BEFORE DELETE ON server_visits FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fixture failure'")
    try {
      await expect(archiveEventBatch(db!, 'server_visits', cutoff, 2)).rejects.toThrow()
      expect(await count('server_visits')).toBe(3)
      expect(await count('traffic_daily_summaries')).toBe(0)
    } finally { await db!.query('DROP TRIGGER retention_failure') }
    expect(await archiveEventBatch(db!, 'server_visits', cutoff, 2)).toBe(2)
  })

  test('ingestion and report transactions work with the actual schema', async () => {
    const orm = drizzle(db!) as MonetiseDb
    const visit = await recordServerVisit(orm, { targetUrl: 'https://example.test/new', origin: 'https://example.test', host: 'example.test', kind: 'homepage', requestPath: '/', visitToken: 'writer-test' }, '192.0.2.9', 'Fixture browser')
    expect(visit.serverVisitId).toBeGreaterThan(0)
    const report = await recordMonetisationReport(orm, { visitToken: 'writer-test', pageUrl: 'https://example.test/new', imagesScanned: 2, imagesReplaced: 1, backgroundsReplaced: 0, canvasesReplaced: 0, skippedAlreadyMonetised: 0, clientScriptVersion: 'test' })
    expect(report?.serverVisitId).toBe(visit.serverVisitId)
  })

  test('convertServerVisitToBlocked flips proxy_document and clears the visit token', async () => {
    const orm = drizzle(db!) as MonetiseDb
    const visit = await recordServerVisit(
      orm,
      {
        targetUrl: 'https://cdn.example.test/api/proxy/file.pdf',
        origin: 'https://cdn.example.test',
        host: 'cdn.example.test',
        kind: 'proxy_document',
        requestPath: '/proxy/https://cdn.example.test/api/proxy/file.pdf',
        visitToken: 'blocked-convert-token',
      },
      '192.0.2.10',
      'Fixture browser',
    )
    expect(visit.serverVisitId).toBeGreaterThan(0)
    expect(await convertServerVisitToBlocked(orm, 'blocked-convert-token', 'blocked filetype: pdf')).toBe(true)
    expect(await convertServerVisitToBlocked(orm, 'blocked-convert-token', 'blocked filetype: pdf')).toBe(false)

    const [rows] = await db!.query<any[]>(
      'SELECT kind, block_reason, visit_token FROM server_visits WHERE id = ?',
      [visit.serverVisitId],
    )
    expect(rows[0].kind).toBe('proxy_blocked')
    expect(rows[0].block_reason).toBe('blocked filetype: pdf')
    expect(rows[0].visit_token).toBeNull()
  })

  test('locked parent survives orphan collection when an in-flight writer adds a visit', async () => {
    const writer = await createConnection({ socketPath: `${directory}/mysql.sock`, user: 'root', database: 'retention_fixture' })
    try {
      await db!.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED')
      await writer.beginTransaction()
      await writer.query('SELECT id FROM sites WHERE id = 3 FOR UPDATE')
      const cleanup = pruneOrphanBatch(db!, 'sites', cutoff, 100)
      await Bun.sleep(30)
      await writer.query("INSERT INTO server_visits (site_id, visitor_id, kind) VALUES (3, 1, 'homepage')")
      await writer.commit()
      expect((await cleanup).deleted).toBe(0)
      expect((await db!.query<any[]>('SELECT id FROM sites WHERE id = 3'))[0]).toHaveLength(1)
    } finally { await writer.end() }
  })
})
