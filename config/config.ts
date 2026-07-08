import { createRequire as nodeCreateRequire } from 'module'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Transform } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'

import type { RawWebsiteConfig, Controller, Website } from 'thalia'
import maxmind, { type CityResponse } from 'maxmind'
import Handlebars from 'handlebars'

import { monetPaintingUrl, parseMonetRequestPath } from './assets'
import { rejectProxyRequest } from './proxy-target'
import { downloadCitiesData } from './mmdb'
import { paintings, sites, siteVisitors, visitors as visitorsTable } from '../models/schema'
import { getAllSites, getVisitorsWithSites, recordSiteVisit, type MonetiseDb } from '../models/queries'

const nodeRequire = nodeCreateRequire(import.meta.url)
const unblocker = nodeRequire('unblocker')

const configDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(configDir, '..')
const srcDir = path.join(rootDir, 'src')

downloadCitiesData().then((message) => {
  console.log(message)
})

const unblockerConfig = {
  // Omit `host` so unblocker uses the request Host (www vs apex) for referer recovery.
  prefix: '/proxy/',
  responseMiddleware: [noStoreProxyMiddleware, googleAnalyticsMiddleware],
  clientScripts: true,
}
const handleRequest = unblocker(unblockerConfig)

function readView(name: string): string {
  return fs.readFileSync(path.join(srcDir, `${name}.hbs`), 'utf8')
}

function serveFile(res: ServerResponse, absolutePath: string): void {
  const ext = path.extname(absolutePath).toLowerCase()
  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  }
  res.setHeader('Content-Type', contentTypes[ext] ?? 'application/octet-stream')
  fs.createReadStream(absolutePath).pipe(res)
}

function setVisitorCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', 'monetiseVisitor=1; Path=/; SameSite=Lax')
}

function rejectBlockedProxyTarget(res: ServerResponse, reqUrl: string): boolean {
  const reason = rejectProxyRequest(reqUrl)
  if (!reason) return false
  console.log('Blocked proxy target:', reason, reqUrl)
  res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('403 Not allowed')
  return true
}

function monetiseDb(website: Website): MonetiseDb | null {
  return website.db?.drizzle ? (website.db.drizzle as unknown as MonetiseDb) : null
}

async function siteVisit(
  website: Website,
  req: IncomingMessage,
  ip: string,
  userAgent: string | undefined,
): Promise<void> {
  const db = monetiseDb(website)
  if (!db) return

  let url = req.url ?? ''

  const query = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).searchParams
  const goto = query.get('goto')
  if (goto) {
    url = goto
  } else if (url.indexOf('/proxy/') > -1) {
    url = url.split('/proxy/').pop() ?? url

    try {
      if (url.indexOf('http') !== 0) {
        url = `https://${url}`
      }
      const urlObject = new URL(url)
      url = urlObject.origin
    } catch {
      /* keep url as-is */
    }
  }

  await recordSiteVisit(db, url, ip, userAgent ?? '')
}

const homepage: Controller = (res, req, website, requestInfo) => {
  setVisitorCookie(res)

  if (requestInfo.query.goto) {
    const sections = requestInfo.query.goto.split('/proxy/')
    let url = sections.pop() ?? ''
    if (url.indexOf('http') !== 0) {
      url = `https://${url}`
    }

    if (rejectBlockedProxyTarget(res, `/proxy/${url}`)) return

    console.log('IP', requestInfo.ip)

    siteVisit(website, req, requestInfo.ip, req.headers['user-agent'])
      .catch((error) => console.error('siteVisit failed:', error))
      .then(() => {
        res.writeHead(302, { Location: `/proxy/${url}` })
        res.end()
      })
  } else {
    siteVisit(website, req, requestInfo.ip, req.headers['user-agent'])
      .catch((error) => console.error('siteVisit failed:', error))
      .then(() => {
        void website
          .asyncServeHandlebarsTemplate({
            res,
            templatePath: path.join(srcDir, 'index.hbs'),
            data: {
              title: 'Monetise your website',
              version: website.version,
              gaMeasurementId: gaMeasurementId || undefined,
            },
          })
          .catch((error) => {
            console.error('Failed to render homepage:', error)
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
              res.end('Error rendering homepage')
            }
          })
      })
  }
}

const proxy: Controller = (res, req, website, requestInfo) => {
  let url = req.url ?? ''
  const sections = url.split('/proxy/')
  url = req.url = `${sections[0]}/proxy/${sections.pop()}`

  if (rejectBlockedProxyTarget(res, url)) return

  const cookies = requestInfo.cookies

  if (url.indexOf('/proxy/client/') > -1) {
    serveFile(res, path.join(rootDir, 'public', 'proxy', 'client', 'unblocker-client.js'))
  } else if (sections.length > 2) {
    res.writeHead(302, { Location: url })
    res.end()
  } else if (!cookies?.monetiseVisitor && !cookies?.cookieName) {
    res.writeHead(303, {
      Location: `//${req.headers.host}/?goto=${encodeURIComponent(url)}`,
    })
    res.end()
  } else if (req.url?.match(/\.(jpeg|jpg|gif|png|webp|svg|bmp|avif)(\?.*)?$/i)) {
    monetAsset(res, req)
  } else {
    void siteVisit(website, req, requestInfo.ip, req.headers['user-agent']).catch((error) =>
      console.error('siteVisit failed:', error),
    )
    handleRequest(req, res, (err?: Error) => {
      if (!err) return
      console.error('Proxy error:', req.url, err)
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
        const detail =
          requestInfo.node_env === 'development' ? `: ${err.message}` : ''
        res.end(`Proxy error${detail}`)
      }
    })
  }
}

const websites: Controller = (res, _req, website, _requestInfo) => {
  const db = monetiseDb(website)
  if (!db) {
    res.end('Database unavailable')
    return
  }

  getAllSites(db)
    .then((siteRows) => {
      const domains: Record<string, unknown> = {}

      siteRows.forEach((site) => {
        const domain = site.url.match(/:\/+(.*?)\//)
        if (!domain) {
          console.log(site.url)
        }
      })

      website.handlebars.registerPartial('content', readView('websites'))
      const template = website.handlebars.compile(readView('base'))
      res.end(template({ sites: siteRows, domains }))
    })
    .catch((error) => {
      console.error(error)
      res.end('Error - Could not fetch websites')
    })
}

const visitorsPage: Controller = (res, _req, website, _requestInfo) => {
  const db = monetiseDb(website)
  if (!db) {
    res.end('Database unavailable')
    return
  }

  Promise.all([
    getVisitorsWithSites(db),
    maxmind.open<CityResponse>(path.join(rootDir, 'data', 'city.mmdb')),
  ])
    .then(([visitorRows, lookup]) => {
      const data = visitorRows.map((visitor) => {
        const blob = lookup.get(visitor.ip)
        const date = (visitor.createdAt ?? new Date()).toLocaleString()

        return {
          id: visitor.id,
          ip: visitor.ip,
          userAgent: visitor.userAgent,
          city: blob ? blob.city?.names?.en : 'Unknown',
          country: blob ? blob.country?.names?.en : 'Unknown',
          longitude: blob ? blob.location?.longitude : 'Unknown',
          latitude: blob ? blob.location?.latitude : 'Unknown',
          date,
          sites: visitor.sites,
          count: visitor.count,
        }
      })

      const sorted = data.sort((a, b) => b.count - a.count)
      const template = Handlebars.compile(readView('visitors'))
      res.end(template({ visitors: sorted }))
    })
    .catch((error) => {
      console.error(error)
      res.end("Error - We probably didn't download the city IP lookup database.")
    })
}

const geoip: Controller = (res, _req, _website, requestInfo) => {
  maxmind.open<CityResponse>(path.join(rootDir, 'data', 'city.mmdb')).then(
    (lookup) => {
      const ip = requestInfo.query.ip || requestInfo.ip
      const blob = lookup.get(ip)

      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.end(JSON.stringify(blob))
    },
    (error) => {
      console.error(error)
      res.end("Error - We probably didn't download the city IP lookup database.")
    },
  )
}

function monetAsset(res: ServerResponse, req: IncomingMessage): void {
  const parsed = parseMonetRequestPath(req.url ?? '')
  const location = monetPaintingUrl(
    parsed
      ? { width: parsed.width, height: parsed.height, seed: parsed.seed }
      : {},
  )
  res.writeHead(302, { Location: location })
  res.end()
}

const monetAssetController: Controller = (res, req) => monetAsset(res, req)

const config: RawWebsiteConfig = {
  domains: ['monetiseyourwebsite.com', 'www.monetiseyourwebsite.com'],
  database: {
    schemas: {
      sites,
      visitors: visitorsTable,
      siteVisitors,
      paintings,
    },
  },
  controllers: {
    '': homepage,
    homepage,
    proxy,
    _next: monetAssetController,
    assets: monetAssetController,
    monet: monetAssetController,
    websites,
    visitors: visitorsPage,
    geoip,
  },
  routes: [
    {
      path: '/visitors',
      password: process.env.VISITORS_PASSWORD || 'hunter2',
    }
  ]
}

export { config }

const gaMeasurementId = process.env.GA_MEASUREMENT_ID || process.env.GA_ID || 'G-CCBVZ1JTY7'

/** Stop Cloudflare/nginx caching proxied pages (empty-body cache poison broke prod HTML). */
function noStoreProxyMiddleware(data: {
  headers?: Record<string, string | string[] | undefined>
}) {
  if (!data.headers) return
  data.headers['cache-control'] = 'no-store, no-cache, must-revalidate'
  data.headers['pragma'] = 'no-cache'
  delete data.headers['expires']
}

function gaSnippet(): string {
  if (!gaMeasurementId) return ''
  return [
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}"></script>`,
    '<script>',
    'window.dataLayer = window.dataLayer || [];',
    'function gtag(){dataLayer.push(arguments);}',
    'gtag("js", new Date());',
    `gtag("config", "${gaMeasurementId}");`,
    '</script>',
  ].join('\n')
}

/** Stream HTML through — buffering the whole body broke nginx chunked encoding on large pages. */
function googleAnalyticsMiddleware(data: { contentType?: string; stream: NodeJS.ReadWriteStream }) {
  if (!data.contentType?.includes('text/html')) {
    return
  }

  const ga = gaSnippet()
  if (!ga) return

  const closing = '</body>'
  let pending = ''

  data.stream = data.stream.pipe(
    new Transform({
      decodeStrings: false,
      transform(chunk, _encoding, next) {
        let text = pending + chunk.toString()
        pending = ''

        if (text.includes(closing)) {
          text = text.replace(closing, `${ga}\n\n${closing}`)
        } else {
          for (let i = closing.length - 1; i > 0; i--) {
            const suffix = text.slice(-i)
            if (closing.startsWith(suffix)) {
              pending = suffix
              text = text.slice(0, -i)
              break
            }
          }
        }

        if (text) this.push(text, 'utf8')
        next()
      },
      flush(done) {
        if (pending) this.push(pending, 'utf8')
        done()
      },
    }),
  ) as NodeJS.ReadWriteStream
}
