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
      } else {
        const handleRequest = unblocker(unblockerConfig)

        handleRequest(controller.request, controller.response)
      }
    },
  },
}

export { config }
