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
var fs = require("fs");

const   app = express(),
        cookieParser = require('cookie-parser');

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



function ads(html) {
    var adscript = `<script type="text/javascript">
	atOptions = {
		'key' : 'b05796235dec6f7532f6a937b9445244',
		'format' : 'iframe',
		'height' : 60,
		'width' : 468,
		'params' : {}
	};
	document.write('<scr' + 'ipt type="text/javascript" src="http' + (location.protocol === 'https:' ? 's' : '') + '://www.madcpms.com/b05796235dec6f7532f6a937b9445244/invoke.js"></scr' + 'ipt>');

    setTimeout( function(d){
        console.log("hello");

        var images = document.getElementsByTagName('img');
        Object.keys(images).forEach(i => {
            images[i].removeAttribute("srcset");
            images[i].setAttribute("style", "opacity: 1;");
            images[i].setAttribute("src", "images/"+Math.random().toString(16).slice(5)+".png");
        });

    }, 2000);
    setInterval(function(d) {
        var sources = document.getElementsByTagName('source');
        Object.keys(sources).forEach(i => {
            if(sources[i]) sources[i].remove();
        });
    }, 3000);

</script>`
    html = html.replace("</body>", adscript + "\n\n</body>");
    return html;
}


function adsterraMiddleware(data) {
    if (data.contentType == 'text/html') {
console.log("Putting ads in..?");

        // https://nodejs.org/api/stream.html#stream_transform
        data.stream = data.stream.pipe(new Transform({
            decodeStrings: false,
            transform: function(chunk, encoding, next) {
                this.push(ads(chunk.toString()));
                next();
            }
        }));
    }
}


function monetiseImages(data) {
    if (data.contentType == 'text/html') {

        // var regex = /^image\/.*/
        // var regex = /<picture\b[^<]*(?:(?!<\/picture>)<[^<]*)*<\/picture>/g;
        var regex = /<img\b.*>/g;
        // if (regex.test(data.contentType)) {
            data.stream = data.stream.pipe(new Transform({
                decodeStrings: false,
                transform: function (chunk, encoding, next) {
                    var html = chunk.toString().replace(regex, "<img src='lol-replace-me.jpg'>");
                    this.push(html);
                    next();
                }
            }));
        // }
    }
}



app.use(cookieParser());
// Write middleware here which checks /proxy/ stuff if it has a cookie set.
// If no cookie, send to homepage.
function cookieChecker(data) {
    const host = data.clientRequest.headers.host;

    try {
        const ip = data.clientRequest.headers['x-real-ip'] || data.clientRequest.headers['x-forwarded-for'] || data.clientRequest.connection.remoteAddress || "Unknown";

        if( data.clientRequest.cookies.cookieName === `Cookie for ${ip}`) {
            console.log(`Valid request for: ${data.clientRequest.url} from ${ip}`);
        } else if ( data.clientRequest.cookies.cookieName ){
            console.log(`Bot from ${ip} using ${data.clientRequest.cookies.cookieName}`);
            data.clientResponse.writeHead(403);
            data.clientResponse.end("Go away");
        } else {
            console.log(`Bot request for: ${data.clientRequest.url} from ${ip}`);
            data.clientResponse.writeHead(303, {Location: `//${host}?goto=${data.clientRequest.url}`});
            data.clientResponse.end();
        }
    } catch (e) {
        data.clientResponse.writeHead(303, {Location: `//${host}?goto=${data.clientRequest.url}`});
        data.clientResponse.end();
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
    requestMiddleware: [
        cookieChecker
    ],
    responseMiddleware: [
        // monetiseImages, // This attempt didn't work. Don't use it.
        googleAnalyticsMiddleware,
        adsterraMiddleware
    ]
};

function randomImage(request, response){
    // 67 is the number of images in my library
    var image = Math.floor(Math.random() * 67);
    // console.log("fetching image: "+image);

    var filename = __dirname + "/assets/"+image+".jpg";

    fs.readFile(filename, "binary", function(err,file) {
        response.writeHead(200, {'Content-Type': 'image/jpeg'});
        response.end(file, "binary");
    });
}

// app.use(function (req, res, next) {
//     if(req.originalUrl.indexOf("webp") > 0) {
//         console.log("replacing an image");
//         console.log(req.originalUrl);
//         randomImage(req, res);
//     } else {
//         next()
//     }
//     // console.log(req.originalUrl);
//     // next()
// });
  

app.use(/.*\.([jJ][pP]([eE])?[gG])$/, randomImage);
app.use(/.*\.([pP][nN][gG])$/, randomImage);


// this line must appear before any express.static calls (or anything else that sends responses)
// ...otherwise the express engine will mess with it!!! Which is what I want! :) -DKGM
app.use(unblocker(unblockerConfig));

function allowCors(data) {
    try {
        const host = data.clientRequest.headers.host;
        const ip = data.clientRequest.headers['x-real-ip'] || data.clientRequest.headers['x-forwarded-for'] || data.clientRequest.connection.remoteAddress || "Unknown";
        console.log(`Bypassing CORS on ${data.clientRequest.url} for ${ip}`);
        data.clientResponse.setHeader('Access-Control-Allow-Origin', '*');
    } catch (e) {
        console.log("Error doing CORS!");
    }
}

const cors = {
    prefix: '/cors/',
    requestMiddleware: [
        allowCors
    ]
};
app.use(unblocker(cors));


// Set a cookie when visiting any page.
app.get('/', (req, res, next)=>{
    let options = {
        maxAge: 1000 * 60 * 15 // would expire after 15 minutes
    };

    const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress || "Unknown";

    try {
        console.log(`Setting cookies for: ${req.url} from ${ip}`);
    } catch (e) {
        console.log("Error", e);
    }

    // Set cookie
    res.cookie('cookieName', `Cookie for ${ip}`, options);
    next();
});





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















