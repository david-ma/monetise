import { and, desc, eq, isNull } from 'drizzle-orm'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import { mysqlInsertIdFromDrizzleMysql2Result } from '../node_modules/thalia/models/util'
import type { VisitKind } from '../config/visit-log'
import {
  monetisationReports,
  serverVisits,
  sites,
  visitors,
  type MonetisationReport,
  type ServerVisit,
  type Site,
  type Visitor,
} from './schema'

export type MonetiseDb = MySql2Database<any>

export type RecordServerVisitInput = {
  targetUrl: string
  origin: string
  host: string
  kind: VisitKind
  requestPath: string
  blockReason?: string
  visitToken?: string
}

export type MonetisationReportInput = {
  visitToken: string
  pageUrl: string
  pageLoadMs?: number | null
  domContentLoadedMs?: number | null
  imagesScanned: number
  imagesReplaced: number
  backgroundsReplaced: number
  canvasesReplaced: number
  skippedAlreadyMonetised: number
  documentTitle?: string | null
  viewportW?: number | null
  viewportH?: number | null
  clientScriptVersion: string
  webdriver?: boolean | null
}

export async function findOrCreateSite(
  db: MonetiseDb,
  targetUrl: string,
  origin: string,
  host: string,
): Promise<Site> {
  const existing = await db
    .select()
    .from(sites)
    .where(and(eq(sites.url, targetUrl), isNull(sites.deletedAt)))
    .limit(1)

  if (existing[0]) {
    return existing[0]
  }

  const insertResult = await db.insert(sites).values({
    url: targetUrl,
    origin,
    host,
  })

  const insertId = mysqlInsertIdFromDrizzleMysql2Result(insertResult)
  if (insertId !== undefined) {
    const created = await db.select().from(sites).where(eq(sites.id, insertId)).limit(1)
    if (created[0]) {
      return created[0]
    }
  }

  const fallback = await db.select().from(sites).where(eq(sites.url, targetUrl)).limit(1)
  if (!fallback[0]) {
    throw new Error(`Failed to find or create site for ${targetUrl}`)
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
    if (existing[0].userAgent !== userAgent && userAgent) {
      await db
        .update(visitors)
        .set({ userAgent })
        .where(eq(visitors.id, existing[0].id!))
    }
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

export async function recordServerVisit(
  db: MonetiseDb,
  input: RecordServerVisitInput,
  ip: string,
  userAgent: string,
): Promise<{ visitToken?: string; serverVisitId?: number }> {
  const site = await findOrCreateSite(db, input.targetUrl, input.origin, input.host)
  const visitor = await findOrCreateVisitor(db, ip, userAgent)

  if (site.id == null || visitor.id == null) {
    throw new Error('Site or visitor row is missing an id')
  }

  const visitToken = input.visitToken

  const insertResult = await db.insert(serverVisits).values({
    siteId: site.id,
    visitorId: visitor.id,
    kind: input.kind,
    requestPath: input.requestPath,
    blockReason: input.blockReason ?? null,
    visitToken: visitToken ?? null,
  })

  const serverVisitId = mysqlInsertIdFromDrizzleMysql2Result(insertResult)
  return { visitToken, serverVisitId }
}

export async function recordMonetisationReport(
  db: MonetiseDb,
  input: MonetisationReportInput,
): Promise<MonetisationReport | null> {
  const visitRows = await db
    .select()
    .from(serverVisits)
    .where(and(eq(serverVisits.visitToken, input.visitToken), isNull(serverVisits.deletedAt)))
    .limit(1)

  const serverVisit = visitRows[0]
  if (!serverVisit?.id) {
    return null
  }

  const insertResult = await db.insert(monetisationReports).values({
    serverVisitId: serverVisit.id,
    visitToken: input.visitToken,
    pageUrl: input.pageUrl,
    pageLoadMs: input.pageLoadMs ?? null,
    domContentLoadedMs: input.domContentLoadedMs ?? null,
    imagesScanned: input.imagesScanned,
    imagesReplaced: input.imagesReplaced,
    backgroundsReplaced: input.backgroundsReplaced,
    canvasesReplaced: input.canvasesReplaced,
    skippedAlreadyMonetised: input.skippedAlreadyMonetised,
    documentTitle: input.documentTitle ?? null,
    viewportW: input.viewportW ?? null,
    viewportH: input.viewportH ?? null,
    clientScriptVersion: input.clientScriptVersion,
    webdriver: input.webdriver ?? null,
  })

  const insertId = mysqlInsertIdFromDrizzleMysql2Result(insertResult)
  if (insertId === undefined) return null

  const created = await db
    .select()
    .from(monetisationReports)
    .where(eq(monetisationReports.id, insertId))
    .limit(1)
  return created[0] ?? null
}

export async function getAllSites(db: MonetiseDb): Promise<Site[]> {
  return db.select().from(sites).where(isNull(sites.deletedAt))
}

export type VisitorVisitRow = {
  visitId: number
  visitedAt: Date | null
  kind: string
  targetUrl: string
  origin: string
  host: string
  requestPath: string
  blockReason: string | null
  hasReport: boolean
  imagesReplaced: number | null
  pageLoadMs: number | null
  documentTitle: string | null
  badge: 'browser' | 'request' | 'probe' | 'blocked'
}

export type VisitorWithVisits = Visitor & {
  visits: VisitorVisitRow[]
  count: number
}

function visitBadge(kind: string, hasReport: boolean): VisitorVisitRow['badge'] {
  if (kind === 'homepage_probe' || kind === 'proxy_blocked') return kind === 'proxy_blocked' ? 'blocked' : 'probe'
  if (hasReport) return 'browser'
  return 'request'
}

export async function getVisitorsWithVisits(db: MonetiseDb): Promise<VisitorWithVisits[]> {
  const allVisitors = await db.select().from(visitors).where(isNull(visitors.deletedAt))

  return Promise.all(
    allVisitors.map(async (visitor) => {
      if (visitor.id == null) {
        return { ...visitor, visits: [], count: 0 }
      }

      const rows = await db
        .select({
          visitId: serverVisits.id,
          visitedAt: serverVisits.visitedAt,
          kind: serverVisits.kind,
          targetUrl: sites.url,
          origin: sites.origin,
          host: sites.host,
          requestPath: serverVisits.requestPath,
          blockReason: serverVisits.blockReason,
          reportId: monetisationReports.id,
          imagesReplaced: monetisationReports.imagesReplaced,
          pageLoadMs: monetisationReports.pageLoadMs,
          documentTitle: monetisationReports.documentTitle,
        })
        .from(serverVisits)
        .innerJoin(sites, eq(serverVisits.siteId, sites.id))
        .leftJoin(monetisationReports, eq(monetisationReports.serverVisitId, serverVisits.id))
        .where(and(eq(serverVisits.visitorId, visitor.id), isNull(serverVisits.deletedAt)))
        .orderBy(desc(serverVisits.visitedAt))

      const visits: VisitorVisitRow[] = rows.map((row) => {
        const hasReport = row.reportId != null
        return {
          visitId: row.visitId!,
          visitedAt: row.visitedAt,
          kind: row.kind,
          targetUrl: row.targetUrl,
          origin: row.origin,
          host: row.host,
          requestPath: row.requestPath,
          blockReason: row.blockReason,
          hasReport,
          imagesReplaced: row.imagesReplaced,
          pageLoadMs: row.pageLoadMs,
          documentTitle: row.documentTitle,
          badge: visitBadge(row.kind, hasReport),
        }
      })

      return {
        ...visitor,
        visits,
        count: visits.length,
      }
    }),
  )
}

/** @deprecated use getVisitorsWithVisits */
export const getVisitorsWithSites = getVisitorsWithVisits

/** @deprecated use recordServerVisit */
export async function recordSiteVisit(
  db: MonetiseDb,
  url: string,
  ip: string,
  userAgent: string,
): Promise<void> {
  await recordServerVisit(
    db,
    {
      targetUrl: url,
      origin: '',
      host: '(legacy)',
      kind: 'homepage',
      requestPath: url,
    },
    ip,
    userAgent,
  )
}
