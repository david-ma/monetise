import { int, mysqlTable, primaryKey, text } from 'drizzle-orm/mysql-core'
import { baseTableConfig, vc } from '../node_modules/thalia/models/util'

export const sites = mysqlTable('sites', {
  ...baseTableConfig,
  url: vc('url', 2048).notNull().unique(),
  title: vc('title', 255).notNull().default('title'),
  description: text('description').notNull(),
  keywords: text('keywords').notNull(),
})

export const visitors = mysqlTable('visitors', {
  ...baseTableConfig,
  ip: vc('ip', 64).notNull().unique(),
  userAgent: text('user_agent').notNull().default(''),
})

export const siteVisitors = mysqlTable(
  'site_visitors',
  {
    siteId: int('site_id')
      .notNull()
      .references(() => sites.id),
    visitorId: int('visitor_id')
      .notNull()
      .references(() => visitors.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.siteId, table.visitorId] }),
  }),
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

export type Site = typeof sites.$inferSelect
export type Visitor = typeof visitors.$inferSelect
export type Painting = typeof paintings.$inferSelect
