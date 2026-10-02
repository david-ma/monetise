# Monetise Your Website

This is the source code for [monetiseyourwebsite.com](http://monetiseyourwebsite.com) a joke project by [@frostickle](http://twitter.com/frostickle).

This service will monetise any website... by replacing the images with paintings by [Monet](https://en.wikipedia.org/wiki/Claude_Monet).

All the heavy lifting is done by [nfriedly](http://nfriedly.com/)'s [unblocker](https://github.com/nfriedly/node-unblocker), which proxies websites. I've just added a few lines to mess with the images.

## Blocked destinations

Edit `config/blocked-domains.ts` to add or remove blocked domains. Each lowercase
domain blocks itself and all its subdomains on both `/proxy/` and `/mirror/`.
Use domain names only (for example, `academia.edu`), without schemes or paths.
Commit and deploy the change, restarting the application to load the updated list.

## Blocked downloads

`config/proxy-target.ts` contains the `BLOCK_FILETYPES` toggle (enabled by default)
and `BLOCKED_FILETYPES`. Each entry maps an extension without its dot to its MIME
types, for example `pdf: ['application/pdf', 'application/x-pdf']`. Add or remove
entries to change the policy; set `BLOCK_FILETYPES = false` to disable it entirely.
Restart the application after changing either setting.

`/proxy/` rejects matching URL extensions, response MIME types and download
filenames with HTTP 403. `/mirror/` remains exempt from filetype blocking but
still applies the shared hostname and domain restrictions. Content deliberately
mislabelled with neither a matching extension, MIME type nor download filename
is not detected; the proxy does not inspect file bytes.

Mirror GET/HEAD target requests are logged, including downloads, resources and
blocked targets. Local mirror client scripts and OPTIONS preflights are excluded.
The separate **Mirror usage** table on `/visitors` shows counts and last-seen times
from the dashboard's shared recent sample; IP links show target URLs and block
reasons. Logging starts with this change and does not backfill past mirror use.
