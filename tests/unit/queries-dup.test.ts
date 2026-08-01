import { describe, expect, test } from 'bun:test'
import { isMysqlDuplicateEntryError } from '../../models/queries'

describe('isMysqlDuplicateEntryError', () => {
  test('detects mysql2-shaped ER_DUP_ENTRY', () => {
    expect(
      isMysqlDuplicateEntryError({
        errno: 1062,
        code: 'ER_DUP_ENTRY',
        sqlMessage: "Duplicate entry 'https://example.com/' for key 'sites_url_unique'",
      }),
    ).toBe(true)
  })

  test('walks DrizzleQueryError cause chain', () => {
    const cause = { errno: 1062, code: 'ER_DUP_ENTRY', message: 'Duplicate entry' }
    expect(
      isMysqlDuplicateEntryError({
        message: 'Failed query: insert into `sites`',
        cause,
      }),
    ).toBe(true)
  })

  test('rejects unrelated errors', () => {
    expect(isMysqlDuplicateEntryError(new Error('Pool is closed'))).toBe(false)
    expect(isMysqlDuplicateEntryError({ errno: 1045, code: 'ER_ACCESS_DENIED_ERROR' })).toBe(
      false,
    )
    expect(isMysqlDuplicateEntryError(null)).toBe(false)
  })
})
