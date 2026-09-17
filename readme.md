# Monetise Your Website

This is the source code for [monetiseyourwebsite.com](http://monetiseyourwebsite.com) a joke project by [@frostickle](http://twitter.com/frostickle).

This service will monetise any website... by replacing the images with paintings by [Monet](https://en.wikipedia.org/wiki/Claude_Monet).

All the heavy lifting is done by [nfriedly](http://nfriedly.com/)'s [unblocker](https://github.com/nfriedly/node-unblocker), which proxies websites. I've just added a few lines to mess with the images.

## Blocked destinations

Edit `config/blocked-domains.ts` to add or remove blocked domains. Each lowercase
domain blocks itself and all its subdomains on both `/proxy/` and `/mirror/`.
Use domain names only (for example, `academia.edu`), without schemes or paths.
Commit and deploy the change, restarting the application to load the updated list.
