import { sql } from 'drizzle-orm'
import { bigint, boolean, date, index, int, mysqlTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/mysql-core'
import { baseTableConfig, vc } from '../node_modules/thalia/models/util'

export const sites = mysqlTable(
  'sites',
  {
    ...baseTableConfig,
    url: vc('url', 2048).notNull().unique(),
    origin: vc('origin', 2048).notNull().default(''),
    host: vc('host', 255).notNull().default(''),
  },
  (table) => [
    // Keep full-URL uniqueness and equality; the prefix only narrows reads.
    // MariaDB's long UNIQUE HASH key did not serve these lookups.
    index('sites_url_lookup_idx').on(sql`${table.url}(191)`).using('btree'),
  ],
)

export const visitors = mysqlTable('visitors', {
  ...baseTableConfig,
  ip: vc('ip', 64).notNull().unique(),
  userAgent: text('user_agent').notNull().default(''),
})

export const serverVisits = mysqlTable(
  'server_visits',
  {
    ...baseTableConfig,
    visitorId: int('visitor_id')
      .notNull()
      .references(() => visitors.id),
    siteId: int('site_id')
      .notNull()
      .references(() => sites.id),
    kind: vc('kind', 64).notNull(),
    requestPath: vc('request_path', 2048).notNull().default(''),
    blockReason: vc('block_reason', 255),
    visitToken: vc('visit_token', 64).unique(),
    visitedAt: timestamp('visited_at').notNull().defaultNow(),
  },
  (table) => [
    index('server_visits_visited_at_idx').on(table.visitedAt),
    index('server_visits_visitor_visited_idx').on(table.visitorId, table.visitedAt),
  ],
)

export const monetisationReports = mysqlTable(
  'monetisation_reports',
  {
    ...baseTableConfig,
    serverVisitId: int('server_visit_id').references(() => serverVisits.id),
    visitToken: vc('visit_token', 64),
    reportedAt: timestamp('reported_at').notNull().defaultNow(),
    pageUrl: vc('page_url', 2048).notNull().default(''),
    pageLoadMs: int('page_load_ms'),
    domContentLoadedMs: int('dom_content_loaded_ms'),
    imagesScanned: int('images_scanned').notNull().default(0),
    imagesReplaced: int('images_replaced').notNull().default(0),
    backgroundsReplaced: int('backgrounds_replaced').notNull().default(0),
    canvasesReplaced: int('canvases_replaced').notNull().default(0),
    skippedAlreadyMonetised: int('skipped_already_monetised').notNull().default(0),
    documentTitle: vc('document_title', 512),
    viewportW: int('viewport_w'),
    viewportH: int('viewport_h'),
    clientScriptVersion: vc('client_script_version', 64).notNull().default(''),
    webdriver: boolean('webdriver'),
  },
  (table) => [index('monetisation_reports_reported_at_idx').on(table.reportedAt)],
)

export const paintings = mysqlTable('paintings', {
  ...baseTableConfig,
  title: vc('title', 512).notNull(),
  yearStart: int('year_start'),
  yearEnd: int('year_end'),
  url: text('url'),
  imageKey: vc('image_key', 255),
  filename: vc('filename', 512),
})

/** Additive event totals only: these are not distinct visitor/person counts. */
export const trafficDailySummaries = mysqlTable('traffic_daily_summaries', {
  day: date('day', { mode: 'string' }).notNull(),
  kind: varchar('kind', { length: 64 }).notNull(),
  visits: bigint('visits', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
  reports: bigint('reports', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
  imagesScanned: bigint('images_scanned', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
  imagesReplaced: bigint('images_replaced', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
  backgroundsReplaced: bigint('backgrounds_replaced', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
  canvasesReplaced: bigint('canvases_replaced', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
  skippedAlreadyMonetised: bigint('skipped_already_monetised', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
  pageLoadMsSum: bigint('page_load_ms_sum', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
  pageLoadSamples: bigint('page_load_samples', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
  domContentLoadedMsSum: bigint('dom_content_loaded_ms_sum', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
  domContentLoadedSamples: bigint('dom_content_loaded_samples', { mode: 'bigint', unsigned: true }).notNull().default(sql`0`),
}, (table) => [primaryKey({ columns: [table.day, table.kind] })])

/** Two bounded keyset scans, resumed across scheduled runs. */
export const trafficRetentionCursors = mysqlTable('traffic_retention_cursors', {
  tableName: varchar('table_name', { length: 32 }).primaryKey(),
  lastId: int('last_id').notNull().default(0),
})

export type Site = typeof sites.$inferSelect
export type Visitor = typeof visitors.$inferSelect
export type ServerVisit = typeof serverVisits.$inferSelect
export type MonetisationReport = typeof monetisationReports.$inferSelect
export type Painting = typeof paintings.$inferSelect
