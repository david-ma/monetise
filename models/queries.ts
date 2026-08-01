import { and, count, desc, eq, gte, isNull, max, notInArray, sql } from 'drizzle-orm'
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

/**
 * True when an error (or any error in its `cause` chain) is MySQL
 * `ER_DUP_ENTRY` (errno 1062). Used for check-then-insert races on unique keys.
 */
export function isMysqlDuplicateEntryError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 6 && current != null; depth++) {
    if (typeof current === 'object') {
      const obj = current as { errno?: unknown; code?: unknown; message?: unknown; cause?: unknown }
      if (obj.errno === 1062 || obj.code === 'ER_DUP_ENTRY') return true
      if (
        typeof obj.message === 'string' &&
        /ER_DUP_ENTRY|Duplicate entry/i.test(obj.message)
      ) {
        return true
      }
      if ('cause' in obj && obj.cause != null) {
        current = obj.cause
        continue
      }
    }
    break
  }
  return false
}

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

async function maybeUpdateVisitorUserAgent(
  db: MonetiseDb,
  visitor: Visitor,
  userAgent: string,
): Promise<Visitor> {
  if (visitor.userAgent === userAgent || !userAgent || visitor.id == null) {
    return visitor
  }
  await db.update(visitors).set({ userAgent }).where(eq(visitors.id, visitor.id))
  return { ...visitor, userAgent }
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

  try {
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
  } catch (error) {
    if (!isMysqlDuplicateEntryError(error)) {
      throw error
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
    return maybeUpdateVisitorUserAgent(db, existing[0], userAgent)
  }

  try {
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
  } catch (error) {
    if (!isMysqlDuplicateEntryError(error)) {
      throw error
    }
  }

  const fallback = await db.select().from(visitors).where(eq(visitors.ip, ip)).limit(1)
  if (!fallback[0]) {
    throw new Error(`Failed to find or create visitor for ${ip}`)
  }
  return maybeUpdateVisitorUserAgent(db, fallback[0], userAgent)
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

export type VisitorDashboardStats = {
  visitsInWindow: number
  distinctVisitorsInWindow: number
  reportsInWindow: number
  windowHours: number
}

export type LikelyRealVisitorRow = {
  visitorId: number
  ip: string
  userAgent: string
  reportCount: number
  lastReportAt: Date | null
  createdAt: Date | null
}

export type HeavyProxyVisitorRow = {
  visitorId: number
  ip: string
  userAgent: string
  visitCount: number
  lastSeen: Date | null
}

/** Headline counters for the limiter window (default 12h). */
export async function getVisitorDashboardStats(
  db: MonetiseDb,
  windowMs: number = 12 * 60 * 60 * 1000,
): Promise<VisitorDashboardStats> {
  const since = new Date(Date.now() - windowMs)

  const [visitRow] = await db
    .select({
      visits: count(serverVisits.id),
      distinctVisitors: sql<number>`count(distinct ${serverVisits.visitorId})`,
    })
    .from(serverVisits)
    .where(and(gte(serverVisits.visitedAt, since), isNull(serverVisits.deletedAt)))

  const [reportRow] = await db
    .select({ reports: count(monetisationReports.id) })
    .from(monetisationReports)
    .where(gte(monetisationReports.reportedAt, since))

  return {
    visitsInWindow: Number(visitRow?.visits ?? 0),
    distinctVisitorsInWindow: Number(visitRow?.distinctVisitors ?? 0),
    reportsInWindow: Number(reportRow?.reports ?? 0),
    windowHours: Math.round(windowMs / (60 * 60 * 1000)),
  }
}

/** Visitors who ran the Monetise client (have ≥1 monetisation report). */
export async function getLikelyRealVisitors(
  db: MonetiseDb,
  limit: number = 50,
): Promise<LikelyRealVisitorRow[]> {
  const rows = await db
    .select({
      visitorId: visitors.id,
      ip: visitors.ip,
      userAgent: visitors.userAgent,
      createdAt: visitors.createdAt,
      reportCount: count(monetisationReports.id),
      lastReportAt: max(monetisationReports.reportedAt),
    })
    .from(monetisationReports)
    .innerJoin(serverVisits, eq(monetisationReports.serverVisitId, serverVisits.id))
    .innerJoin(visitors, eq(serverVisits.visitorId, visitors.id))
    .where(and(isNull(visitors.deletedAt), isNull(serverVisits.deletedAt)))
    .groupBy(visitors.id, visitors.ip, visitors.userAgent, visitors.createdAt)
    .orderBy(desc(max(monetisationReports.reportedAt)))
    .limit(limit)

  return rows
    .filter((row) => row.visitorId != null)
    .map((row) => ({
      visitorId: row.visitorId!,
      ip: row.ip,
      userAgent: row.userAgent,
      reportCount: Number(row.reportCount),
      lastReportAt: row.lastReportAt,
      createdAt: row.createdAt,
    }))
}

/**
 * Top talkers in the window with no monetisation report — likely scrapers / non-JS clients.
 */
export async function getHeavyProxyVisitors(
  db: MonetiseDb,
  windowMs: number = 12 * 60 * 60 * 1000,
  limit: number = 50,
): Promise<HeavyProxyVisitorRow[]> {
  const since = new Date(Date.now() - windowMs)

  const realRows = await db
    .selectDistinct({ visitorId: serverVisits.visitorId })
    .from(monetisationReports)
    .innerJoin(serverVisits, eq(monetisationReports.serverVisitId, serverVisits.id))

  const realIds = realRows
    .map((row) => row.visitorId)
    .filter((id): id is number => id != null)

  const whereClause =
    realIds.length > 0
      ? and(
          gte(serverVisits.visitedAt, since),
          isNull(serverVisits.deletedAt),
          isNull(visitors.deletedAt),
          notInArray(visitors.id, realIds),
        )
      : and(
          gte(serverVisits.visitedAt, since),
          isNull(serverVisits.deletedAt),
          isNull(visitors.deletedAt),
        )

  const rows = await db
    .select({
      visitorId: visitors.id,
      ip: visitors.ip,
      userAgent: visitors.userAgent,
      visitCount: count(serverVisits.id),
      lastSeen: max(serverVisits.visitedAt),
    })
    .from(serverVisits)
    .innerJoin(visitors, eq(serverVisits.visitorId, visitors.id))
    .where(whereClause)
    .groupBy(visitors.id, visitors.ip, visitors.userAgent)
    .orderBy(desc(count(serverVisits.id)))
    .limit(limit)

  return rows
    .filter((row) => row.visitorId != null)
    .map((row) => ({
      visitorId: row.visitorId!,
      ip: row.ip,
      userAgent: row.userAgent,
      visitCount: Number(row.visitCount),
      lastSeen: row.lastSeen,
    }))
}

/** Recent visits for one IP (detail drill-down). */
export async function getRecentVisitsForIp(
  db: MonetiseDb,
  ip: string,
  limit: number = 50,
): Promise<{ visitor: Visitor | null; visits: VisitorVisitRow[] }> {
  const visitorRows = await db
    .select()
    .from(visitors)
    .where(and(eq(visitors.ip, ip), isNull(visitors.deletedAt)))
    .limit(1)

  const visitor = visitorRows[0] ?? null
  if (!visitor?.id) {
    return { visitor: null, visits: [] }
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
    .limit(limit)

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

  return { visitor, visits }
}

/**
 * @deprecated Unbounded visitor fan-out — throws so callers migrate to dashboard queries.
 */
export async function getVisitorsWithVisits(_db: MonetiseDb): Promise<VisitorWithVisits[]> {
  throw new Error(
    'getVisitorsWithVisits is retired (unbounded). Use getLikelyRealVisitors / getHeavyProxyVisitors / getRecentVisitsForIp.',
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
