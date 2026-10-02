import { describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/mysql-proxy'
import Handlebars from 'handlebars'
import { readFileSync } from 'node:fs'
import {
  getHeavyProxyVisitors, getMirrorVisitors, getRecentVisitSample,
  type MonetiseDb, type RecentVisitSampleRow,
} from '../../models/queries'

const earlier = new Date('2026-10-02T00:00:00Z')
const later = new Date('2026-10-02T01:00:00Z')
const sample: RecentVisitSampleRow[] = [
  { visitorId: 1, kind: 'mirror_request', visitedAt: earlier },
  { visitorId: 1, kind: 'mirror_blocked', visitedAt: later },
  { visitorId: 1, kind: 'proxy_document', visitedAt: later },
  { visitorId: 2, kind: 'proxy_document', visitedAt: later },
  { visitorId: 2, kind: 'mirror_request', visitedAt: earlier },
  { visitorId: 3, kind: 'proxy_document', visitedAt: later },
]

function fixtureDb() {
  return drizzle(async (query) => {
    if (query.includes('from `monetisation_reports`')) return { rows: [[2]] }
    expect(query).toContain('from `visitors`')
    expect(query).toContain('`visitors`.`deleted_at` is null')
    return { rows: [[1, '192.0.2.1', 'UA 1'], [2, '192.0.2.2', 'UA 2'], [3, '192.0.2.3', 'UA 3']] }
  }) as unknown as MonetiseDb
}

describe('mirror visitor dashboard', () => {
  test('includes mirror-only counts, blocked requests and visitors with browser reports', async () => {
    const result = await getMirrorVisitors(fixtureDb(), undefined, 50, undefined, sample)
    expect(result.map(({ visitorId, visitCount }) => ({ visitorId, visitCount }))).toEqual([
      { visitorId: 1, visitCount: 2 }, { visitorId: 2, visitCount: 1 },
    ])
    expect(result[0].lastSeen).toEqual(later)
    expect(result[1].lastSeen).toEqual(earlier)
  })

  test('keeps mirror requests out of heavy proxy counts', async () => {
    const result = await getHeavyProxyVisitors(fixtureDb(), undefined, 50, undefined, sample)
    expect(result.map(({ visitorId, visitCount }) => ({ visitorId, visitCount }))).toEqual([
      { visitorId: 1, visitCount: 1 }, { visitorId: 3, visitCount: 1 },
    ])
  })

  test('handles empty samples without querying visitors', async () => {
    const db = drizzle(async () => { throw new Error('Unexpected database call') }) as unknown as MonetiseDb
    expect(await getMirrorVisitors(db, undefined, undefined, undefined, [])).toEqual([])
  })

  test('retains a bounded newest-first sample and includes visit kinds', async () => {
    const db = drizzle(async (query, params) => {
      expect(query).toContain('`kind`')
      expect(query).toContain('order by `server_visits`.`visited_at` desc limit ?')
      expect(params.at(-1)).toBe(100)
      return { rows: [[1, '2026-10-02 01:00:00', 'mirror_request']] }
    }) as unknown as MonetiseDb
    const result = await getRecentVisitSample(db, 3600000, 100)
    expect(result[0].kind).toBe('mirror_request')
  })

  test('renders a separate mirror table, escaped user agents and IP detail links', () => {
    const render = Handlebars.compile(readFileSync(new URL('../../src/visitors.hbs', import.meta.url), 'utf8'))
    const html = render({ mirrorVisitors: [{ ip: '192.0.2.1', ipHref: '/visitors?ip=192.0.2.1', visitCount: 2, uaShort: '<script>bad</script>' }] })
    expect(html.match(/<table>/g)?.length).toBe(3)
    expect(html).toContain('Mirror usage')
    expect(html).toContain('href="/visitors?ip&#x3D;192.0.2.1"')
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;')
    expect(render({})).toContain('No mirror requests in this sample.')
  })
})
