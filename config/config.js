"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const unblocker = require('unblocker');
const thalia_1 = require("thalia");
const maxmind_1 = __importDefault(require("maxmind"));
const handlebars_1 = __importDefault(require("handlebars"));
const mmdb_1 = require("./mmdb");
(0, mmdb_1.downloadCitiesData)().then((message) => {
    console.log(message);
});
var Transform = require('stream').Transform;
var unblockerConfig = {
    host: 'monetiseyourwebsite.com',
    prefix: '/proxy/',
    responseMiddleware: [googleAnalyticsMiddleware],
    clientScripts: true,
};
const handleRequest = unblocker(unblockerConfig);
const botIpAddresses = {};
async function siteVisit(controller) {
    let url = controller.request.url;
    if (controller.query.goto) {
        url = controller.query.goto;
    }
    else if (url.indexOf('/proxy/') > -1) {
        url = url.split('/proxy/').pop();
        try {
            if (url.indexOf('http') !== 0) {
                url = `https://${url}`;
            }
            const urlObject = new URL(url);
            url = urlObject.origin;
        }
        catch (e) { }
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
        return site[0].addVisitor(visitor[0]);
    });
}
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
                    console.log('IP', controller.ip);
                    siteVisit(controller).then(() => {
                        controller.response.writeHead(302, {
                            Location: `/proxy/${url}`,
                        });
                        controller.response.end();
                    });
                }
                else {
                    siteVisit(controller).then(() => {
                        controller.routeFile(`${__dirname}/../public/index.html`);
                    });
                }
            }
        },
        proxy: function (controller) {
            let url = controller.request.url;
            const sections = url.split('/proxy/');
            url = controller.request.url = `${sections[0]}/proxy/${sections.pop()}`;
            var base = url;
            try {
                base = url.split('//')[1];
                base = base.split('/')[0];
                base = base.split(':')[0];
            }
            catch (e) {
                controller.response.end("500 Error, couldn't read target host");
                return;
            }
            const ipAddressRegex = /(\d+\.?){4}/;
            if (ipAddressRegex.test(base)) {
                console.log('IP Address found!', base);
                console.log("Full URL", url);
                controller.response.end('401 Error, Not allowed to visit IP addresses');
                return;
            }
            const cookies = controller.cookies;
            if (url.indexOf('/proxy/client/') > -1) {
                controller.routeFile(`${__dirname}/../public/proxy/client/unblocker-client.js`);
            }
            else if (sections.length > 2) {
                controller.response.writeHead(302, {
                    Location: url,
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
            else if (controller.request.url.match(/\.(jpeg|jpg|gif|png|webp|svg|bmp|avif)(\?.*)?$$/i)) {
                monetAsset(controller);
            }
            else {
                siteVisit(controller).then(() => {
                    handleRequest(controller.request, controller.response);
                });
            }
        },
        _next: monetAsset,
        assets: monetAsset,
        monet: monetAsset,
        visitors: function (controller) {
            Promise.all([
                controller.db.Visitor.findAll(),
                maxmind_1.default.open(`${__dirname}/../data/city.mmdb`),
                new Promise(controller.readAllViews),
            ]).then(([visitors, lookup, views]) => {
                Promise.all(visitors.map((visitor) => {
                    const blob = lookup.get(visitor.ip);
                    return visitor.getSites().then((sites) => {
                        const createdAt = visitor.createdAt;
                        const date = createdAt.toLocaleString();
                        return {
                            ...visitor.dataValues,
                            city: blob ? blob.city.names.en : 'Unknown',
                            country: blob ? blob.country.names.en : 'Unknown',
                            longitude: blob ? blob.location.longitude : 'Unknown',
                            latitude: blob ? blob.location.latitude : 'Unknown',
                            date,
                            sites,
                            count: sites.length,
                        };
                    });
                })).then((data) => {
                    data = data.sort((a, b) => b.count - a.count);
                    const template = handlebars_1.default.compile(views.visitors);
                    controller.response.end(template({ visitors: data }));
                }, (error) => {
                    console.error(error);
                    controller.response.end('Error - Could not fetch visitors');
                });
            }, (error) => {
                console.error(error);
                controller.response.end("Error - We probably didn't download the city IP lookup database.");
            });
        },
        geoip: function (controller) {
            maxmind_1.default.open(`${__dirname}/../data/city.mmdb`).then((lookup) => {
                const ip = controller.query.ip || controller.ip;
                const blob = lookup.get(ip);
                controller.response.setHeader('Content-Type', 'application/json');
                controller.response.setHeader('Access-Control-Allow-Origin', '*');
                controller.response.end(JSON.stringify(blob));
            }, (error) => {
                console.error(error);
                controller.response.end("Error - We probably didn't download the city IP lookup database.");
            });
        },
    },
};
exports.config = config;
function monetAsset(controller) {
    var image = Math.floor(Math.random() * 67);
    controller.response.writeHead(302, {
        Location: `/images/assets/${image}.jpg`,
    });
    controller.response.end();
}
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
