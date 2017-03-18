/***************
 * node-unblocker: Web Proxy for evading firewalls and content filters,
 * similar to CGIProxy or PHProxy
 *
 *
 * This project is hosted on github:  https://github.com/nfriedly/node-unblocker
 *
 * By Nathan Friedly - http://nfriedly.com
 * Released under the terms of the GPL v3
 */

var url = require('url');
var querystring = require('querystring');
var express = require('express');
var unblocker = require('unblocker');
var Transform = require('stream').Transform;
// var fs = require("fs");

var app = express();

var google_analytics_id = process.env.GA_ID || "UA-49861162-2";

function addGa(html) {
    if (google_analytics_id) {
        var ga = [
            "<script type=\"text/javascript\">",
            "var _gaq = []; // overwrite the existing one, if any",
            "_gaq.push(['_setAccount', '" + google_analytics_id + "']);",
            "_gaq.push(['_trackPageview']);",
            "(function() {",
            "  var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;",
            "  ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';",
            "  var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);",
            "})();",
            "</script>"
            ].join("\n");
        html = html.replace("</body>", ga + "\n\n</body>");
    }
    return html;
}

function googleAnalyticsMiddleware(data) {
    if (data.contentType == 'text/html') {

        // https://nodejs.org/api/stream.html#stream_transform
        data.stream = data.stream.pipe(new Transform({
            decodeStrings: false,
            transform: function(chunk, encoding, next) {
                this.push(addGa(chunk.toString()));
                next();
            }
        }));
    }
}


// This attempt did not work, caused a memory leak somehow
// function monetiseImages (data) {
//   var regex = /^image\/.*/
//   if (regex.test(data.contentType)) {  
//       // https://nodejs.org/api/stream.html#stream_transform
//       data.stream = data.stream.pipe(new Transform({
//           decodeStrings: false,
//           transform: function(chunk, encoding, next) {
//             var that = this;
//             fs.readFile('public/images/1.jpeg', function(err,file) {
//               that.push(file);
//               next();
//             })
//           }
//       }));
//   }
// }

var unblockerConfig = {
    prefix: '/proxy/',
    responseMiddleware: [
//         monetiseImages, // This attempt didn't work. Don't use it.
        googleAnalyticsMiddleware
    ]
};

var seed = Math.floor(Math.random() * 1000);
console.log("Ok, this thread is seeded with: "+seed);
function random() {
    var x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
}

function randomImage(){
  var image = Math.floor(random() * 27);
  console.log("fetching image: "+image);
  return __dirname + "/assets/"+image+".jpg";
}

app.use(/.*\.([jJ][pP]([eE])?[gG])$/, express.static(randomImage()));
app.use(/.*\.([pP][nN][gG])$/, express.static(randomImage()));


// this line must appear before any express.static calls (or anything else that sends responses)
// ...otherwise the express engine will mess with it!!! Which is what I want! :) -DKGM
app.use(unblocker(unblockerConfig));

// serve up static files *after* the proxy is run
app.use('/', express.static(__dirname + '/public'));




// this is for users who's form actually submitted due to JS being disabled or whatever
app.get("/no-js", function(req, res) {
    // grab the "url" parameter from the querystring
    var site = querystring.parse(url.parse(req.url).query).url;
    // and redirect the user to /proxy/url
    res.redirect(unblockerConfig.prefix + site);
});

// for compatibility with gatlin and other servers, export the app rather than passing it directly to http.createServer
module.exports = app;















