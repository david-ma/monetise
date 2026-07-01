import { and, eq, isNull } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import { mysqlInsertIdFromDrizzleMysql2Result } from '../node_modules/thalia/models/util'
import { siteVisitors, sites, visitors, type Site, type Visitor } from './schema'

export function isSiteDescribed(description: string | null | undefined): boolean {
  return Boolean(description && description.length > 0)
}

type MonetiseDb = MySql2Database<any>

export type { MonetiseDb }

export async function findOrCreateSite(db: MonetiseDb, url: string): Promise<Site> {
  const existing = await db
    .select()
    .from(sites)
    .where(and(eq(sites.url, url), isNull(sites.deletedAt)))
    .limit(1)

  if (existing[0]) {
    return existing[0]
  }

  const insertResult = await db.insert(sites).values({
    url,
    title: 'title',
    description: 'description',
    keywords: 'keywords',
  })

  const insertId = mysqlInsertIdFromDrizzleMysql2Result(insertResult)
  if (insertId !== undefined) {
    const created = await db.select().from(sites).where(eq(sites.id, insertId)).limit(1)
    if (created[0]) {
      return created[0]
    }
  }

  const fallback = await db.select().from(sites).where(eq(sites.url, url)).limit(1)
  if (!fallback[0]) {
    throw new Error(`Failed to find or create site for ${url}`)
  }
  return fallback[0]
}

export async function findOrCreateVisitor(
  db: MonetiseDb,
  ip: string,
  userAgent: string,
): Promise<Visitor> {
  const existing = await db
    .select()
    .from(visitors)
    .where(and(eq(visitors.ip, ip), isNull(visitors.deletedAt)))
    .limit(1)

  if (existing[0]) {
    return existing[0]
  }

  const insertResult = await db.insert(visitors).values({
    ip,
    userAgent,
  })

  const insertId = mysqlInsertIdFromDrizzleMysql2Result(insertResult)
  if (insertId !== undefined) {
    const created = await db.select().from(visitors).where(eq(visitors.id, insertId)).limit(1)
    if (created[0]) {
      return created[0]
    }
  }

  const fallback = await db.select().from(visitors).where(eq(visitors.ip, ip)).limit(1)
  if (!fallback[0]) {
    throw new Error(`Failed to find or create visitor for ${ip}`)
  }
  return fallback[0]
}

export async function recordSiteVisit(
  db: MonetiseDb,
  url: string,
  ip: string,
  userAgent: string,
): Promise<void> {
  const site = await findOrCreateSite(db, url)
  const visitor = await findOrCreateVisitor(db, ip, userAgent)

  if (site.id == null || visitor.id == null) {
    throw new Error('Site or visitor row is missing an id')
  }

  const existingLink = await db
    .select()
    .from(siteVisitors)
    .where(and(eq(siteVisitors.siteId, site.id), eq(siteVisitors.visitorId, visitor.id)))
    .limit(1)

  if (!existingLink[0]) {
    await db.insert(siteVisitors).values({
      siteId: site.id,
      visitorId: visitor.id,
    })
  }
}

export async function getAllSites(db: MonetiseDb): Promise<Site[]> {
  return db.select().from(sites).where(isNull(sites.deletedAt))
}

export type VisitorWithSites = Visitor & {
  sites: Site[]
  count: number
}

export async function getVisitorsWithSites(db: MonetiseDb): Promise<VisitorWithSites[]> {
  const allVisitors = await db.select().from(visitors).where(isNull(visitors.deletedAt))

  return Promise.all(
    allVisitors.map(async (visitor) => {
      if (visitor.id == null) {
        return { ...visitor, sites: [], count: 0 }
      }

      const visitorSites = await db
        .select({
          id: sites.id,
          createdAt: sites.createdAt,
          updatedAt: sites.updatedAt,
          deletedAt: sites.deletedAt,
          url: sites.url,
          title: sites.title,
          description: sites.description,
          keywords: sites.keywords,
        })
        .from(siteVisitors)
        .innerJoin(sites, eq(siteVisitors.siteId, sites.id))
        .where(and(eq(siteVisitors.visitorId, visitor.id), isNull(sites.deletedAt)))

      return {
        ...visitor,
        sites: visitorSites,
        count: visitorSites.length,
      }
    }),
  )
}
