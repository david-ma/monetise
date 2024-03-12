const unblocker = require('unblocker')
import { Thalia } from 'thalia'

var unblockerConfig = {
  prefix: '/proxy/',
  requestMiddleware: [
    // cookieChecker
  ],
  responseMiddleware: [
    // googleAnalyticsMiddleware
  ],
}

let config: Thalia.WebsiteConfig = {
  controllers: {
    proxy: function (controller) {
      const url = controller.request.url
      const sections = url.split('/proxy/')
      controller.request.url = `${sections[0]}/proxy/${sections.pop()}`

      if (sections.length > 3) {
        controller.response.writeHead(302, {
          Location: controller.request.url,
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
