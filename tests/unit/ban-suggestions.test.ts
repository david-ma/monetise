import { describe, expect, test } from 'bun:test'
import {
  banSuggestSince,
  formatBanSuggestions,
  isAlreadyBlocked,
  parseBanSuggestOptions,
  rankBanCandidates,
  scoreHost,
  suggestBanDomain,
  type HostTrafficStats,
} from '../../models/ban-suggestions'

function stats(partial: Partial<HostTrafficStats> & Pick<HostTrafficStats, 'host'>): HostTrafficStats {
  return {
    visits: 0,
    distinctVisitors: 0,
    distinctUrls: 0,
    blockedVisits: 0,
    documentVisits: 0,
    gotoVisits: 0,
    reports: 0,
    siteRows: 0,
    ...partial,
  }
}

describe('parseBanSuggestOptions', () => {
  test('defaults and overrides', () => {
    expect(parseBanSuggestOptions([])).toEqual({
      days: 14,
      limit: 40,
      minVisits: 200,
      includeBlocked: false,
    })
    expect(parseBanSuggestOptions(['--days=7', '--limit=10', '--min-visits=50', '--include-blocked'])).toEqual({
      days: 7,
      limit: 10,
      minVisits: 50,
      includeBlocked: true,
    })
  })

  test('rejects bad options', () => {
    expect(() => parseBanSuggestOptions(['--days=0'])).toThrow('Invalid option')
    expect(() => parseBanSuggestOptions(['--days=14', '--days=7'])).toThrow('Duplicate option')
  })
})

describe('suggestBanDomain / isAlreadyBlocked', () => {
  test('strips www and trailing dots', () => {
    expect(suggestBanDomain('WWW.Example.COM.')).toBe('example.com')
  })

  test('detects blocked domains and subdomains', () => {
    expect(isAlreadyBlocked('arxiv.org', ['arxiv.org'])).toBe(true)
    expect(isAlreadyBlocked('export.arxiv.org', ['arxiv.org'])).toBe(true)
    expect(isAlreadyBlocked('example.com', ['arxiv.org'])).toBe(false)
  })
})

describe('scoreHost / rankBanCandidates', () => {
  test('promotes blocked download farms and open-proxy goto hosts', () => {
    const blockedFarm = scoreHost(
      stats({
        host: 'files.example.com',
        visits: 2000,
        blockedVisits: 900,
        distinctVisitors: 40,
        distinctUrls: 1500,
        siteRows: 8000,
      }),
    )
    const quietSite = scoreHost(
      stats({
        host: 'quiet.example.com',
        visits: 50,
        reports: 10,
        documentVisits: 40,
        distinctVisitors: 20,
        distinctUrls: 10,
      }),
    )
    expect(blockedFarm.score).toBeGreaterThan(quietSite.score)
    expect(blockedFarm.reasons.some((reason) => /blocked/i.test(reason))).toBe(true)

    const ranked = rankBanCandidates(
      [
        stats({
          host: 'www.arxiv.org',
          visits: 5000,
          documentVisits: 4000,
          distinctVisitors: 100,
          distinctUrls: 200,
        }),
        stats({
          host: 'pdf-farm.test',
          visits: 3000,
          blockedVisits: 1200,
          gotoVisits: 800,
          distinctVisitors: 30,
          distinctUrls: 2000,
          siteRows: 9000,
        }),
      ],
      { includeBlocked: false, limit: 10 },
      ['arxiv.org'],
    )
    expect(ranked.map((row) => row.suggestedDomain)).toEqual(['pdf-farm.test'])
    expect(ranked[0].reasons.length).toBeGreaterThan(0)
  })

  test('can include already-blocked hosts when asked', () => {
    const ranked = rankBanCandidates(
      [stats({ host: 'arxiv.org', visits: 5000, documentVisits: 4000, distinctVisitors: 10, distinctUrls: 10 })],
      { includeBlocked: true, limit: 5 },
      ['arxiv.org'],
    )
    expect(ranked).toHaveLength(1)
    expect(ranked[0].alreadyBlocked).toBe(true)
  })
})

describe('banSuggestSince / formatBanSuggestions', () => {
  test('uses whole UTC days', () => {
    expect(banSuggestSince(new Date('2026-10-03T15:30:00Z'), 14)).toBe('2026-09-19 00:00:00')
  })

  test('prints suggested BLOCKED_DOMAINS lines', () => {
    const text = formatBanSuggestions(
      [
        {
          ...stats({
            host: 'www.pdf-farm.test',
            visits: 3000,
            blockedVisits: 1000,
            distinctVisitors: 20,
            distinctUrls: 1000,
            siteRows: 6000,
          }),
          suggestedDomain: 'pdf-farm.test',
          alreadyBlocked: false,
          score: 50,
          reasons: ['URL explosion / scraper-shaped traffic'],
        },
      ],
      '2026-09-19 00:00:00',
      14,
    )
    expect(text).toContain("'pdf-farm.test',")
    expect(text).toContain('why: URL explosion / scraper-shaped traffic')
  })
})
