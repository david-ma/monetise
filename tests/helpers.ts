/**
 * Test helpers shared across monetise suites.
 *
 * - **`SKIP_DATABASE_TESTS=1`** → skip HTTP integration tests that start Thalia
 *   against MariaDB (CI default).
 * - **`SKIP_DATABASE_TESTS=0`** → run integration tests (local dev with `docker compose up db -d`).
 */
import { describe } from 'bun:test'

export const skipDatabaseTests = process.env.SKIP_DATABASE_TESTS === '1'

export const describeDatabaseOnline = skipDatabaseTests ? describe.skip : describe
