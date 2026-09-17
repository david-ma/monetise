import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/mysql-proxy'
import { findOrCreateSite, type MonetiseDb } from '../../models/queries'

const origin = 'https://example.com'
const host = 'example.com'
const prefix = `${origin}/${'a'.repeat(200)}`

function siteRow(id: number, url: string, deletedAt: string | null = null) {
  return [id, '2026-09-17 00:00:00', '2026-09-17 00:00:00', deletedAt, url, origin, host]
}

describe('site URL lookup index compatibility', () => {
  test('migration adds only a non-unique prefix index, retaining full URL uniqueness', () => {
    // Guard the generated SQL: accidentally making the prefix UNIQUE would
    // reject distinct long URLs. No database is contacted by these tests.
    const migration = readFileSync(
      new URL('../../drizzle/0003_sites_url_lookup_index.sql', import.meta.url), 'utf8',
    )
    expect(migration.trim()).toBe(
      'CREATE INDEX `sites_url_lookup_idx` ON `sites` (`url`(191));',
    )
  })

  test('URLs sharing the indexed prefix are still looked up using their full values', async () => {
    const urls = [`${prefix}/one`, `${prefix}/two`]
    const seen: string[] = []
    const db = drizzle(async (query, params) => {
      expect(query).toContain('`sites`.`url` = ?')
      expect(query).toContain('`sites`.`deleted_at` is null')
      expect(query).not.toMatch(/left\(|substring\(/i)
      seen.push(params[0])
      return { rows: [siteRow(urls.indexOf(params[0]) + 1, params[0])] }
    }) as unknown as MonetiseDb

    const first = await findOrCreateSite(db, urls[0], origin, host)
    const second = await findOrCreateSite(db, urls[1], origin, host)
    expect(seen).toEqual(urls)
    expect(first.id).toBe(1)
    expect(second.id).toBe(2)
  })

  test('duplicate insert fallback retains full URL comparison and soft-deleted row handling', async () => {
    const url = `${prefix}/deleted`
    let calls = 0
    const db = drizzle(async (query, params) => {
      calls++
      if (calls === 1) {
        expect(query).toContain('`sites`.`deleted_at` is null')
        return { rows: [] }
      }
      if (calls === 2) {
        expect(query).toMatch(/^insert into `sites`/)
        throw { code: 'ER_DUP_ENTRY', errno: 1062 }
      }
      expect(query).toContain('`sites`.`url` = ?')
      expect(query).not.toContain('`sites`.`deleted_at` is null')
      expect(params[0]).toBe(url)
      return { rows: [siteRow(7, url, '2026-09-16 00:00:00')] }
    }) as unknown as MonetiseDb

    const result = await findOrCreateSite(db, url, origin, host)
    expect(calls).toBe(3)
    expect(result.id).toBe(7)
    expect(result.deletedAt).toBeInstanceOf(Date)
  })
})
