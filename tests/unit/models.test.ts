import { describe, expect, test } from 'bun:test'
import { monetisationReports, paintings, serverVisits, sites, visitors } from '../../models/schema'

describe('monetise schema', () => {
  test('exports visit logging tables', () => {
    expect(sites).toBeDefined()
    expect(visitors).toBeDefined()
    expect(serverVisits).toBeDefined()
    expect(monetisationReports).toBeDefined()
    expect(paintings).toBeDefined()
  })
})
