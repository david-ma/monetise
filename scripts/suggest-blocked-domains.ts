/**
 * Read-only Operator report: hosts that look worth adding to config/blocked-domains.ts.
 * Does not mutate the database or edit the block list.
 */
import { createConnection } from 'mysql2/promise'
import { DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE } from '../drizzle.config'
import {
  banSuggestSince,
  formatBanSuggestions,
  loadHostTrafficStats,
  parseBanSuggestOptions,
  rankBanCandidates,
} from '../models/ban-suggestions'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(`Usage: bun scripts/suggest-blocked-domains.ts [--days=14] [--limit=40] [--min-visits=200] [--include-blocked]
Read-only. Ranks proxied hosts by volume, block rate, open-proxy goto use, URL explosion and missing monetisation reports.
Review suggestions before editing config/blocked-domains.ts.`)
} else {
  let db: Awaited<ReturnType<typeof createConnection>> | undefined
  try {
    const options = parseBanSuggestOptions(args)
    db = await createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USERNAME,
      password: DB_PASSWORD,
      database: DB_DATABASE,
      timezone: 'Z',
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectTimeout: 10000,
    })
    await db.query("SET SESSION time_zone = '+00:00'")
    const [clock] = await db.query<any[]>('SELECT UTC_TIMESTAMP() AS now')
    const sinceUtc = banSuggestSince(new Date(clock[0].now), options.days)
    const stats = await loadHostTrafficStats(db, sinceUtc, options.minVisits)
    const candidates = rankBanCandidates(stats, options)
    process.stdout.write(formatBanSuggestions(candidates, sinceUtc, options.days))
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'BAN_SUGGEST_FAILED'
    const safe =
      /^[A-Z0-9_]+$/.test(code) || code.startsWith('Invalid option') || code.startsWith('Out of range') || code.startsWith('Duplicate option')
        ? code
        : 'BAN_SUGGEST_FAILED'
    console.error(
      `Blocked-domain suggestion failed (${safe}). Check options and database connectivity. No data was modified.`,
    )
    process.exitCode = 1
  } finally {
    await db?.end()
  }
}
