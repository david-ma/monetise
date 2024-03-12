"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const unblocker = require('unblocker');
var Transform = require('stream').Transform;
var unblockerConfig = {
    prefix: '/proxy/',
    responseMiddleware: [googleAnalyticsMiddleware],
};
const botIpAddresses = {};
let config = {
    controllers: {
        '': function (controller) {
            controller.res.setCookie({ cookieName: controller.ip });
            if (botIpAddresses[controller.ip] > 10) {
                controller.response.writeHead(302, {
                    Location: '/robots.txt',
                });
            }
            else {
                if (controller.query.goto) {
                    const sections = controller.query.goto.split('/proxy/');
                    let url = sections.pop();
                    if (url.indexOf('http') !== 0) {
                        url = `https://${url}`;
                    }
                    controller.response.writeHead(302, {
                        Location: `/proxy/${url}`,
                    });
                    controller.response.end();
                    return;
                }
                else {
                    controller.routeFile(`${__dirname}/../public/index.html`);
                }
            }
        },
        proxy: function (controller) {
            const url = controller.request.url;
            const sections = url.split('/proxy/');
            controller.request.url = `${sections[0]}/proxy/${sections.pop()}`;
            const cookies = controller.cookies;
            if (sections.length > 3) {
                controller.response.writeHead(302, {
                    Location: controller.request.url,
                });
                controller.response.end();
                return;
            }
            else if (!cookies ||
                !cookies.cookieName ||
                cookies.cookieName !== controller.ip) {
                botIpAddresses[controller.ip] ? botIpAddresses[controller.ip]++ : 1;
                controller.response.writeHead(303, {
                    Location: `//${controller.request.headers.host}/?goto=${url}`,
                });
                controller.response.end();
                return;
            }
            else if (controller.request.url.match(/\.(jpeg|jpg|gif|png|webp|svg|bmp)$/i)) {
                controller.response.writeHead(302, {
                    Location: '/monet',
                });
                controller.response.end();
                return;
            }
            else {
                const handleRequest = unblocker(unblockerConfig);
                handleRequest(controller.request, controller.response);
            }
        },
        monet: function (controller) {
            var image = Math.floor(Math.random() * 67);
            controller.response.writeHead(302, {
                Location: `/images/assets/${image}.jpg`,
            });
            controller.response.end();
        },
    },
};
exports.config = config;
var google_analytics_id = process.env.GA_ID || 'UA-49861162-2';
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
        ].join('\n');
        html = html.replace('</body>', ga + '\n\n</body>');
    }
    return html;
}
function googleAnalyticsMiddleware(data) {
    if (data.contentType == 'text/html') {
        data.stream = data.stream.pipe(new Transform({
            decodeStrings: false,
            transform: function (chunk, encoding, next) {
                this.push(addGa(chunk.toString()));
                next();
            },
        }));
    }
}
