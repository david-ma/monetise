const unblocker = require('unblocker')
import { Thalia } from 'thalia'
var Transform = require('stream').Transform

var unblockerConfig = {
  prefix: '/proxy/',
  responseMiddleware: [googleAnalyticsMiddleware],
}

const botIpAddresses = {}

async function siteVisit(controller) {
  let url = controller.request.url

  if (controller.query.goto) {
    url = controller.query.goto
  } else if (url.indexOf('/proxy/') > -1) {
    url = url.split('/proxy/').pop()

    if (url === 'client/unblocker-client.js') {
      return
    } else {
      const urlObject = new URL(url)

      url = urlObject.origin
    }
  }

  return Promise.all([
    controller.db.Site.findOrCreate({
      where: { url },
      defaults: {
        title: 'title',
        description: 'description',
        keywords: 'keywords',
      },
    }),
    controller.db.Visitor.findOrCreate({
      where: { ip: controller.ip },
      defaults: { userAgent: controller.request.headers['user-agent'] },
    }),
  ]).then(([site, visitor]) => {
    site[0].addVisitor(visitor[0])
    return [site, visitor]
  })
}

let config: Thalia.WebsiteConfig = {
  controllers: {
    '': function (controller) {
      controller.res.setCookie({ cookieName: controller.ip })

      // TODO: Should probably be reset after some time..?
      // This would break a class of students visiting the website
      if (botIpAddresses[controller.ip] > 10) {
        // send to robots.txt
        controller.response.writeHead(302, {
          Location: '/robots.txt',
        })
      } else {
        if (controller.query.goto) {
          const sections = controller.query.goto.split('/proxy/')
          let url = sections.pop()
          if (url.indexOf('http') !== 0) {
            // Assume https, if no protocol provided?
            url = `https://${url}`
          }

          console.log('IP', controller.ip)

          siteVisit(controller).then(() => {
            controller.response.writeHead(302, {
              Location: `/proxy/${url}`,
            })

            controller.response.end()
          })
        } else {
          controller.routeFile(`${__dirname}/../public/index.html`)
        }
      }
    },
    proxy: function (controller) {
      let url = controller.request.url
      const sections = url.split('/proxy/')
      url = controller.request.url = `${sections[0]}/proxy/${sections.pop()}`

      const cookies = controller.cookies

      if (sections.length > 2) {
        controller.response.writeHead(302, {
          Location: url,
        })
        controller.response.end()
        return
      } else if (
        !cookies ||
        !cookies.cookieName ||
        cookies.cookieName !== controller.ip
      ) {
        botIpAddresses[controller.ip] ? botIpAddresses[controller.ip]++ : 1

        controller.response.writeHead(303, {
          Location: `//${controller.request.headers.host}/?goto=${url}`,
        })
        controller.response.end()
        return
      } else if (
        // Check if it's an image
        controller.request.url.match(/\.(jpeg|jpg|gif|png|webp|svg|bmp)$/i)
      ) {
        controller.response.writeHead(302, {
          Location: '/monet',
        })
        controller.response.end()
        return
      } else {
        siteVisit(controller).then(() => {
          const handleRequest = unblocker(unblockerConfig)

          handleRequest(controller.request, controller.response)
        })
      }
    },
    monet: function (controller) {
      var image = Math.floor(Math.random() * 67)

      // serve a random image by Monet
      controller.response.writeHead(302, {
        Location: `/images/assets/${image}.jpg`,
      })
      controller.response.end()
    },
  },
}

export { config }

var google_analytics_id = process.env.GA_ID || 'UA-49861162-2'

function addGa(html) {
  if (google_analytics_id) {
    var ga = [
      '<script type="text/javascript">',
      'var _gaq = []; // overwrite the existing one, if any',
      "_gaq.push(['_setAccount', '" + google_analytics_id + "']);",
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

function googleAnalyticsMiddleware(data) {
  if (data.contentType == 'text/html') {
    // https://nodejs.org/api/stream.html#stream_transform
    data.stream = data.stream.pipe(
      new Transform({
        decodeStrings: false,
        transform: function (chunk, encoding, next) {
          this.push(addGa(chunk.toString()))
          next()
        },
      })
    )
  }
}
