const unblocker = require('unblocker')
import { Thalia } from 'thalia'
var Transform = require('stream').Transform

var unblockerConfig = {
  prefix: '/proxy/',
  responseMiddleware: [googleAnalyticsMiddleware],
}

const botIpAddresses = {}

import { Site, Visitor, VisitorStatic, SiteStatic } from '../models'

async function siteVisit(controller) {
  const url = controller.request.url
  return controller.db.Site.findOne({
    where: {
      id: 1,
    },
    // defaults: {
    //   url: url,
    //   title: 'default',
    //   description: 'default',
    //   keywords: 'default',
    // },
  }).then((site) => {
    if (!site) {
      return 'no site'
    }
    // console.log('site', site)
    // console.log("data", site.dataValues)
    // console.log('site', site.sayHello())

    // controller.response.writeHead(302, {
    //   Location: `/proxy/${url}`,
    // })
    // controller.response.end("ok...")
    return site
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

          siteVisit(controller).then((thing) => {
            // controller.response.writeHead(302, {
            //   Location: `/proxy/${url}`,
            // })
            console.log(thing)

            // thing.sayHello()
            console.log('described?', thing.isDescribed())
            console.log("ok we're doing stuff..?", thing.sayHello())
            controller.response.end(thing.toString())
          })

          // Log this visitor
          // const visitors: VisitorStatic = controller.db.Visitor
          // const sites: SiteStatic = controller.db.Site
          // Visitor.findOrBuild({
          //   where: {
          //     ip: "default"
          //     // ip: controller.ip,
          //   },
          //   defaults: {
          //     ip: "default",
          //     userAgent: controller.request.headers['user-agent'],
          //   },
          // }).then((visitor) => {
          //   console.log('Visitor recorded!', visitor)
          // })

          // controller.db.Site.findOrCreate({
          //   where: {
          //     url: url,
          //   },
          //   defaults: {
          //     url: url,
          //     title: 'default',
          //     description: 'default',
          //     keywords: 'default',
          //   },
          // }).then(([site, created]: [Site, Boolean]) => {
          //   controller.db.Site.findOne({
          //     where: {
          //       url: url,
          //     },
          //   }).then((site) => {
          //     console.log('site', site)
          //     console.log("data", site.dataValues)
          //     console.log('site', site.sayHello())

          //     // controller.response.writeHead(302, {
          //     //   Location: `/proxy/${url}`,
          //     // })
          //     controller.response.end("ok...")
          //     return
          //   })
          // })
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
        const handleRequest = unblocker(unblockerConfig)

        handleRequest(controller.request, controller.response)
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
