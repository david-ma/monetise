import { describe, expect, test } from 'bun:test'
import { isSiteDescribed } from '../../models/queries'
import { paintings, sites, siteVisitors, visitors } from '../../models/schema'

describe('monetise schema', () => {
  test('exports sites, visitors, siteVisitors, and paintings tables', () => {
    expect(sites).toBeDefined()
    expect(visitors).toBeDefined()
    expect(siteVisitors).toBeDefined()
    expect(paintings).toBeDefined()
  })
})

describe('monetise queries', () => {
  test('isSiteDescribed returns false for empty description', () => {
    expect(isSiteDescribed('')).toBe(false)
    expect(isSiteDescribed(null)).toBe(false)
  })

  test('isSiteDescribed returns true when description is set', () => {
    expect(isSiteDescribed('A Monet landscape')).toBe(true)
  })
})
