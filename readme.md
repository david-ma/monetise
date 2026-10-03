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

## Traffic retention

The Operator-run `scripts/traffic-retention.ts` keeps 30 days of detailed traffic
and converts older events into permanent UTC daily totals. It archives report
counts, replacement totals and timing sums/sample counts, plus request counts by
kind. Summaries contain no IP addresses or full URLs and do not claim distinct
visitor counts. The existing visitor dashboard continues to show retained detail.

```sh
# Read-only database size estimates and latest 90 summary rows:
bun scripts/traffic-retention.ts
# Explicitly archive/delete, only after backup and migration review:
bun scripts/traffic-retention.ts --apply --days=30 --batch-size=1000 --max-batches=100
```

The batch budget applies to each table. Reports are processed before visits;
recent reports temporarily retain their older linked visit. Old unreferenced
sites/visitors are collected using resumable scans. Each archive/delete batch is
transactional, and overlapping jobs cannot both run. Summary days may be partial
until catch-up completes. Failed runs exit non-zero; `budgetReached` indicates
that another run may be needed, not an exact backlog measurement.

Migration `0004_traffic_retention.sql` and **all ingestion transaction changes**
must be deployed before enabling cleanup. Reviewed nightly systemd templates are
under `ops/`; check their account, paths, database routing and host timezone before
the Operator installs them. Nothing enables these automatically. Database deletes
make space reusable internally; filesystem reclamation is a separate maintenance
decision requiring fresh measurements and working space.

Local rollout/backup/recovery diary: `docs/2026-10-03_visitor-retention.md` (the
repository ignores `docs/`; explicitly include that file if publishing this work).
