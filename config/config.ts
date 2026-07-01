import { createRequire as nodeCreateRequire } from 'module'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Transform } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'

import type { RawWebsiteConfig, Controller, Website } from 'thalia'
import type { RequestInfo } from 'thalia/server'
import maxmind, { type CityResponse } from 'maxmind'
import Handlebars from 'handlebars'

import { downloadCitiesData } from './mmdb'
import { seq, initDb, isDbReady } from './db_bootstrap'

const nodeRequire = nodeCreateRequire(import.meta.url)
const unblocker = nodeRequire('unblocker')

const configDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(configDir, '..')
const srcDir = path.join(rootDir, 'src')

initDb()

downloadCitiesData().then((message) => {
  console.log(message)
})

const unblockerConfig = {
  host: 'monetiseyourwebsite.com',
  prefix: '/proxy/',
  responseMiddleware: [googleAnalyticsMiddleware],
  clientScripts: true,
}
const handleRequest = unblocker(unblockerConfig)

const botIpAddresses: Record<string, number> = {}

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

function setVisitorCookie(res: ServerResponse, ip: string): void {
  res.setHeader('Set-Cookie', `cookieName=${ip}; Path=/`)
}

async function siteVisit(
  req: IncomingMessage,
  ip: string,
  userAgent: string | undefined,
): Promise<void> {
  if (!isDbReady()) return

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

  return Promise.all([
    seq.Site.findOrCreate({
      where: { url },
      defaults: {
        title: 'title',
        description: 'description',
        keywords: 'keywords',
      },
    }),
    seq.Visitor.findOrCreate({
      where: { ip },
      defaults: { userAgent: userAgent ?? '' },
    }),
  ]).then(([site, visitor]) => {
    visitor[0].getSites().then((sites) => {
      if (!sites.find((s) => s.id === site[0].id)) {
        visitor[0].addSite(site[0])
      } else {
        console.log('Visitor already visited site')
      }
    })
  })
}

const homepage: Controller = (res, req, _website, requestInfo) => {
  setVisitorCookie(res, requestInfo.ip)

  if ((botIpAddresses[requestInfo.ip] ?? 0) > 10) {
    res.writeHead(302, { Location: '/robots.txt' })
    res.end()
    return
  }

  if (requestInfo.query.goto) {
    const sections = requestInfo.query.goto.split('/proxy/')
    let url = sections.pop() ?? ''
    if (url.indexOf('http') !== 0) {
      url = `https://${url}`
    }

    console.log('IP', requestInfo.ip)

    siteVisit(req, requestInfo.ip, req.headers['user-agent'])
      .catch((error) => console.error('siteVisit failed:', error))
      .then(() => {
      res.writeHead(302, { Location: `/proxy/${url}` })
      res.end()
    })
  } else {
    siteVisit(req, requestInfo.ip, req.headers['user-agent'])
      .catch((error) => console.error('siteVisit failed:', error))
      .then(() => {
      serveFile(res, path.join(rootDir, 'public', 'index.html'))
    })
  }
}

const proxy: Controller = (res, req, _website, requestInfo) => {
  let url = req.url ?? ''
  const sections = url.split('/proxy/')
  url = req.url = `${sections[0]}/proxy/${sections.pop()}`

  let base: string
  try {
    base = url.split('//')[1] ?? ''
    base = base.split('/')[0] ?? ''
    base = base.split(':')[0] ?? ''
  } catch {
    res.end("500 Error, couldn't read target host")
    return
  }

  const ipAddressRegex = /(\d+\.?){4}/

  if (ipAddressRegex.test(base)) {
    console.log('IP Address found!', base)
    console.log('Full URL', url)
    res.end('401 Error, Not allowed to visit IP addresses')
    return
  }

  const cookies = requestInfo.cookies

  if (url.indexOf('/proxy/client/') > -1) {
    serveFile(res, path.join(rootDir, 'public', 'proxy', 'client', 'unblocker-client.js'))
  } else if (sections.length > 2) {
    res.writeHead(302, { Location: url })
    res.end()
  } else if (!cookies?.cookieName || cookies.cookieName !== requestInfo.ip) {
    botIpAddresses[requestInfo.ip] = (botIpAddresses[requestInfo.ip] ?? 0) + 1

    res.writeHead(303, {
      Location: `//${req.headers.host}/?goto=${encodeURIComponent(url)}`,
    })
    res.end()
  } else if (req.url?.match(/\.(jpeg|jpg|gif|png|webp|svg|bmp|avif)(\?.*)?$/i)) {
    monetAsset(res)
  } else {
    siteVisit(req, requestInfo.ip, req.headers['user-agent'])
      .catch((error) => console.error('siteVisit failed:', error))
      .then(() => {
      handleRequest(req, res)
    })
  }
}

const websites: Controller = (res, _req, website, _requestInfo) => {
  if (!isDbReady()) {
    res.end('Database unavailable')
    return
  }

  Promise.all([seq.Site.findAll()])
    .then(
      ([sites]) => {
        const domains: Record<string, unknown> = {}

        sites.forEach((site) => {
          const domain = site.url.match(/:\/+(.*?)\//)
          if (!domain) {
            console.log(site.url)
          }
        })

        website.handlebars.registerPartial('content', readView('websites'))
        const template = website.handlebars.compile(readView('base'))
        res.end(template({ sites, domains }))
      },
      (error) => {
        console.error(error)
        res.end('Error - Could not fetch websites')
      },
    )
}

const visitors: Controller = (res, _req, _website, _requestInfo) => {
  if (!isDbReady()) {
    res.end('Database unavailable')
    return
  }

  Promise.all([
    seq.Visitor.findAll(),
    maxmind.open<CityResponse>(path.join(rootDir, 'data', 'city.mmdb')),
  ]).then(
    ([visitors, lookup]) => {
      Promise.all(
        visitors.map((visitor) => {
          const blob = lookup.get(visitor.ip)

          return visitor.getSites().then((sites) => {
            const createdAt: Date = visitor.createdAt
            const date = createdAt.toLocaleString()

            return {
              ...visitor.dataValues,
              city: blob ? blob.city?.names?.en : 'Unknown',
              country: blob ? blob.country?.names?.en : 'Unknown',
              longitude: blob ? blob.location?.longitude : 'Unknown',
              latitude: blob ? blob.location?.latitude : 'Unknown',
              date,
              sites,
              count: sites.length,
            }
          })
        }),
      ).then(
        (data) => {
          const sorted = data.sort((a, b) => b.count - a.count)
          const template = Handlebars.compile(readView('visitors'))
          res.end(template({ visitors: sorted }))
        },
        (error) => {
          console.error(error)
          res.end('Error - Could not fetch visitors')
        },
      )
    },
    (error) => {
      console.error(error)
      res.end("Error - We probably didn't download the city IP lookup database.")
    },
  )
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

function monetAsset(res: ServerResponse): void {
  const image = Math.floor(Math.random() * 67)
  res.writeHead(302, { Location: `/images/assets/${image}.jpg` })
  res.end()
}

const monetAssetController: Controller = (res) => monetAsset(res)

const config: RawWebsiteConfig = {
  domains: ['monetiseyourwebsite.com', 'www.monetiseyourwebsite.com'],
  controllers: {
    '': homepage,
    homepage,
    proxy,
    _next: monetAssetController,
    assets: monetAssetController,
    monet: monetAssetController,
    websites,
    visitors,
    geoip,
  },
}

export { config }

const google_analytics_id = process.env.GA_ID || 'UA-49861162-2'

function addGa(html: string): string {
  if (google_analytics_id) {
    const ga = [
      '<script type="text/javascript">',
      'var _gaq = []; // overwrite the existing one, if any',
      `_gaq.push(['_setAccount', '${google_analytics_id}']);`,
      "_gaq.push(['_trackPageview']);",
      '(function() {',
      "  var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;",
      "  ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';",
      "  var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);",
      '})();',
      '</script>',
    ].join('\n')
    html = html.replace('</body>', ga + '\n\n</body>')
  }
  return html
}

function googleAnalyticsMiddleware(data: { contentType?: string; stream: NodeJS.ReadWriteStream }) {
  if (data.contentType == 'text/html') {
    data.stream = data.stream.pipe(
      new Transform({
        decodeStrings: false,
        transform(chunk, _encoding, next) {
          this.push(addGa(chunk.toString()))
          next()
        },
      }),
    )
  }
}
