import { boolean, int, mysqlTable, text, timestamp, varchar } from 'drizzle-orm/mysql-core'
import { baseTableConfig, vc } from '../node_modules/thalia/models/util'

export const sites = mysqlTable('sites', {
  ...baseTableConfig,
  url: vc('url', 2048).notNull().unique(),
  origin: vc('origin', 2048).notNull().default(''),
  host: vc('host', 255).notNull().default(''),
})

export const visitors = mysqlTable('visitors', {
  ...baseTableConfig,
  ip: vc('ip', 64).notNull().unique(),
  userAgent: text('user_agent').notNull().default(''),
})

export const serverVisits = mysqlTable('server_visits', {
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
})

export const monetisationReports = mysqlTable('monetisation_reports', {
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
})

export const paintings = mysqlTable('paintings', {
  ...baseTableConfig,
  title: vc('title', 512).notNull(),
  yearStart: int('year_start'),
  yearEnd: int('year_end'),
  url: text('url'),
  imageKey: vc('image_key', 255),
  filename: vc('filename', 512),
})

export type Site = typeof sites.$inferSelect
export type Visitor = typeof visitors.$inferSelect
export type ServerVisit = typeof serverVisits.$inferSelect
export type MonetisationReport = typeof monetisationReports.$inferSelect
export type Painting = typeof paintings.$inferSelect
