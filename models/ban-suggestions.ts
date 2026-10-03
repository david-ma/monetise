/**
 * Read-only ranking of proxied hosts that may deserve a domain ban.
 * Importing this module never connects to a database.
 */
import { BLOCKED_DOMAINS } from '../config/blocked-domains'

export type BanSuggestOptions = {
  days: number
  limit: number
  minVisits: number
  includeBlocked: boolean
}

export const DEFAULT_BAN_SUGGEST: BanSuggestOptions = {
  days: 14,
  limit: 40,
  minVisits: 200,
  includeBlocked: false,
}

export type HostTrafficStats = {
  host: string
  visits: number
  distinctVisitors: number
  distinctUrls: number
  blockedVisits: number
  documentVisits: number
  gotoVisits: number
  reports: number
  siteRows: number
}

export type BanCandidate = {
  suggestedDomain: string
  /** Exact site.host values that rolled into this domain tally. */
  hosts: string[]
  visits: number
  distinctVisitors: number
  distinctUrls: number
  blockedVisits: number
  documentVisits: number
  gotoVisits: number
  reports: number
  siteRows: number
  alreadyBlocked: boolean
  score: number
  reasons: string[]
}

export type BanSuggestConnection = {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
}

const SKIP_HOSTS = new Set(['', '(local)', '(invalid)'])

export function parseBanSuggestOptions(args: string[]): BanSuggestOptions {
  const options = { ...DEFAULT_BAN_SUGGEST }
  const seen = new Set<string>()
  for (const arg of args) {
    if (arg === '--help') continue
    const [key, value, extra] = arg.split('=')
    if (seen.has(key)) throw new Error(`Duplicate option: ${key}`)
    seen.add(key)
    if (arg === '--include-blocked') {
      options.includeBlocked = true
      continue
    }
    const field = {
      '--days': 'days',
      '--limit': 'limit',
      '--min-visits': 'minVisits',
    }[key] as keyof BanSuggestOptions | undefined
    if (!field || value === undefined || extra !== undefined || !/^[1-9]\d*$/.test(value)) {
      throw new Error(`Invalid option: ${arg}`)
    }
    const n = Number(value)
    const maximum = field === 'days' ? 36500 : field === 'limit' ? 500 : 1_000_000
    if (!Number.isSafeInteger(n) || n > maximum) throw new Error(`Out of range: ${arg}`)
    ;(options[field] as number) = n
  }
  return options
}

/** Whole UTC day boundary, matching traffic-retention cutoff style. */
export function banSuggestSince(now: Date, days: number): string {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  utc.setUTCDate(utc.getUTCDate() - days)
  return utc.toISOString().slice(0, 19).replace('T', ' ')
}

export function isAlreadyBlocked(host: string, blocked = BLOCKED_DOMAINS): boolean {
  const h = host.toLowerCase().replace(/\.+$/, '')
  return blocked.some((domain) => h === domain || h.endsWith(`.${domain}`))
}

/**
 * Suggest a BLOCKED_DOMAINS entry. Strips www.; otherwise keeps the host.
 * Multi-label hosts keep the full host so co.uk-style suffixes are not mangled.
 * Review before pasting — this is a hint, not a public-suffix lookup.
 */
export function suggestBanDomain(host: string): string {
  let h = host.toLowerCase().replace(/\.+$/, '')
  if (h.startsWith('www.')) h = h.slice(4)
  return h
}

export function scoreHost(stats: Pick<
  HostTrafficStats,
  | 'visits'
  | 'blockedVisits'
  | 'reports'
  | 'gotoVisits'
  | 'siteRows'
  | 'distinctUrls'
  | 'distinctVisitors'
  | 'documentVisits'
>): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0
  const visits = Math.max(stats.visits, 0)
  if (visits <= 0) return { score: 0, reasons }

  const blockedRatio = stats.blockedVisits / visits
  const reportRatio = stats.reports / visits
  const urlsPerVisitor =
    stats.distinctVisitors > 0 ? stats.distinctUrls / stats.distinctVisitors : stats.distinctUrls

  score += Math.log10(visits + 1) * 10

  if (blockedRatio >= 0.25 && stats.blockedVisits >= 20) {
    score += 25 + blockedRatio * 20
    reasons.push(`${pct(blockedRatio)} blocked (filetype/host)`)
  }

  if (visits >= 500 && reportRatio < 0.005) {
    score += 20
    reasons.push('almost no browser monetisation reports')
  } else if (visits >= 200 && stats.reports === 0) {
    score += 12
    reasons.push('zero monetisation reports')
  }

  if (stats.gotoVisits >= 200 && reportRatio < 0.01) {
    score += 15
    reasons.push('heavy homepage_goto open-proxy use')
  }

  if (stats.siteRows >= 5000 || (stats.distinctUrls >= 1000 && urlsPerVisitor >= 20)) {
    score += 18
    reasons.push('URL explosion / scraper-shaped traffic')
  }

  if (stats.documentVisits >= 1000 && reportRatio < 0.01) {
    score += 10
    reasons.push('many proxy_document hits without reports')
  }

  if (reasons.length === 0 && visits >= 1000) {
    reasons.push('high volume — review manually')
  }

  return { score, reasons }
}

type DomainBucket = {
  suggestedDomain: string
  hosts: string[]
  visits: number
  distinctVisitors: number
  distinctUrls: number
  blockedVisits: number
  documentVisits: number
  gotoVisits: number
  reports: number
  siteRows: number
}

/** Roll www/apex (and identical suggestions) together so tallies match a ban entry. */
export function aggregateBySuggestedDomain(rows: HostTrafficStats[]): DomainBucket[] {
  const byDomain = new Map<string, DomainBucket>()
  for (const row of rows) {
    if (SKIP_HOSTS.has(row.host)) continue
    const suggestedDomain = suggestBanDomain(row.host)
    const existing = byDomain.get(suggestedDomain)
    if (!existing) {
      byDomain.set(suggestedDomain, {
        suggestedDomain,
        hosts: [row.host],
        visits: row.visits,
        distinctVisitors: row.distinctVisitors,
        distinctUrls: row.distinctUrls,
        blockedVisits: row.blockedVisits,
        documentVisits: row.documentVisits,
        gotoVisits: row.gotoVisits,
        reports: row.reports,
        siteRows: row.siteRows,
      })
      continue
    }
    existing.hosts.push(row.host)
    existing.visits += row.visits
    // Distinct metrics summed across hosts are rough upper bounds (visitor/url overlap unknown).
    existing.distinctVisitors += row.distinctVisitors
    existing.distinctUrls += row.distinctUrls
    existing.blockedVisits += row.blockedVisits
    existing.documentVisits += row.documentVisits
    existing.gotoVisits += row.gotoVisits
    existing.reports += row.reports
    existing.siteRows += row.siteRows
  }
  for (const bucket of byDomain.values()) {
    bucket.hosts = uniquePreserveOrder(bucket.hosts).sort((a, b) => a.localeCompare(b))
  }
  return [...byDomain.values()]
}

export function rankBanCandidates(
  rows: HostTrafficStats[],
  options: Pick<BanSuggestOptions, 'includeBlocked' | 'limit' | 'minVisits'>,
  blocked = BLOCKED_DOMAINS,
): BanCandidate[] {
  const ranked: BanCandidate[] = []
  for (const bucket of aggregateBySuggestedDomain(rows)) {
    if (bucket.visits < options.minVisits) continue
    const alreadyBlocked = isAlreadyBlocked(bucket.suggestedDomain, blocked)
    if (alreadyBlocked && !options.includeBlocked) continue
    const { score, reasons } = scoreHost(bucket)
    if (score <= 0 || reasons.length === 0) continue
    ranked.push({
      ...bucket,
      alreadyBlocked,
      score,
      reasons,
    })
  }
  ranked.sort(
    (a, b) => b.score - a.score || b.visits - a.visits || a.suggestedDomain.localeCompare(b.suggestedDomain),
  )
  return ranked.slice(0, options.limit)
}

export async function loadHostTrafficStats(
  db: BanSuggestConnection,
  sinceUtc: string,
  minVisits: number,
): Promise<HostTrafficStats[]> {
  const [visitRows] = await db.query(
    `SELECT s.host AS host,
        COUNT(*) AS visits,
        COUNT(DISTINCT v.visitor_id) AS distinct_visitors,
        COUNT(DISTINCT v.site_id) AS distinct_urls,
        SUM(v.kind IN ('proxy_blocked', 'mirror_blocked')) AS blocked_visits,
        SUM(v.kind = 'proxy_document') AS document_visits,
        SUM(v.kind = 'homepage_goto') AS goto_visits
      FROM server_visits v
      INNER JOIN sites s ON s.id = v.site_id
      WHERE v.visited_at >= ?
        AND v.deleted_at IS NULL
        AND s.deleted_at IS NULL
        AND s.host NOT IN ('', '(local)', '(invalid)')
      GROUP BY s.host
      HAVING visits >= ?
      ORDER BY visits DESC
      LIMIT 1000`,
    // Host floor is deliberately lower than domain minVisits so www/apex rows can merge first.
    [sinceUtc, Math.max(1, Math.min(minVisits, 50))],
  )

  const hosts = (visitRows as Array<Record<string, unknown>>).map((row) => String(row.host))
  const reportByHost = new Map<string, number>()
  const siteRowsByHost = new Map<string, number>()

  if (hosts.length) {
    const placeholders = hosts.map(() => '?').join(', ')
    const [reportRows] = await db.query(
      `SELECT s.host AS host, COUNT(*) AS reports
        FROM monetisation_reports r
        INNER JOIN server_visits v ON v.id = r.server_visit_id
        INNER JOIN sites s ON s.id = v.site_id
        WHERE r.reported_at >= ?
          AND r.deleted_at IS NULL
          AND s.host IN (${placeholders})
        GROUP BY s.host`,
      [sinceUtc, ...hosts],
    )
    for (const row of reportRows as Array<Record<string, unknown>>) {
      reportByHost.set(String(row.host), Number(row.reports) || 0)
    }

    const [siteRows] = await db.query(
      `SELECT host, COUNT(*) AS site_rows
        FROM sites
        WHERE deleted_at IS NULL AND host IN (${placeholders})
        GROUP BY host`,
      hosts,
    )
    for (const row of siteRows as Array<Record<string, unknown>>) {
      siteRowsByHost.set(String(row.host), Number(row.site_rows) || 0)
    }
  }

  return (visitRows as Array<Record<string, unknown>>).map((row) => {
    const host = String(row.host)
    return {
      host,
      visits: Number(row.visits) || 0,
      distinctVisitors: Number(row.distinct_visitors) || 0,
      distinctUrls: Number(row.distinct_urls) || 0,
      blockedVisits: Number(row.blocked_visits) || 0,
      documentVisits: Number(row.document_visits) || 0,
      gotoVisits: Number(row.goto_visits) || 0,
      reports: reportByHost.get(host) ?? 0,
      siteRows: siteRowsByHost.get(host) ?? 0,
    }
  })
}

export function formatBanSuggestions(candidates: BanCandidate[], sinceUtc: string, days: number): string {
  const lines: string[] = [
    `Ban candidates from visits since ${sinceUtc} UTC (last ${days} whole days).`,
    'log hits = server_visits rows for that suggested ban domain (www rolled up). Distinct visitor/url tallies are rough when multiple hosts merge.',
    'Hints only — review before editing config/blocked-domains.ts. Domains block themselves and all subdomains.',
    '',
  ]

  if (!candidates.length) {
    lines.push('No hosts crossed the suggestion thresholds.')
    return `${lines.join('\n')}\n`
  }

  lines.push('Tally (highest log hits among scored candidates):')
  const byHits = [...candidates].sort(
    (a, b) => b.visits - a.visits || a.suggestedDomain.localeCompare(b.suggestedDomain),
  )
  for (const row of byHits) {
    const blockedNote = row.alreadyBlocked ? ' [already blocked]' : ''
    lines.push(
      `  ${formatCount(row.visits).padStart(10)}  ${row.suggestedDomain}${blockedNote}  (${row.hosts.length} host${row.hosts.length === 1 ? '' : 's'})`,
    )
  }
  lines.push('')

  for (const [index, row] of candidates.entries()) {
    const blockedNote = row.alreadyBlocked ? ' [already blocked]' : ''
    lines.push(
      `${String(index + 1).padStart(2, ' ')}. ${row.suggestedDomain}${blockedNote}  ~${formatCount(row.visits)} log hits  score=${row.score.toFixed(1)}`,
    )
    lines.push(`    hosts (${row.hosts.length}): ${summariseHosts(row.hosts)}`)
    lines.push(
      `    visitors≈${formatCount(row.distinctVisitors)}  urls≈${formatCount(row.distinctUrls)}  siteRows=${formatCount(row.siteRows)}`,
    )
    lines.push(
      `    blocked=${formatCount(row.blockedVisits)}  documents=${formatCount(row.documentVisits)}  goto=${formatCount(row.gotoVisits)}  reports=${formatCount(row.reports)}`,
    )
    lines.push(`    why: ${row.reasons.join('; ')}`)
    lines.push('')
  }

  const fresh = candidates.filter((row) => !row.alreadyBlocked)
  if (fresh.length) {
    lines.push('Suggested additions (paste into BLOCKED_DOMAINS after review):')
    for (const row of fresh) {
      lines.push(
        `  '${row.suggestedDomain}',  // ~${formatCount(row.visits)} log hits, ${row.hosts.length} host${row.hosts.length === 1 ? '' : 's'}`,
      )
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-GB')
}

function summariseHosts(hosts: string[], max = 6): string {
  if (hosts.length <= max) return hosts.join(', ')
  return `${hosts.slice(0, max).join(', ')}, … +${hosts.length - max} more`
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}
