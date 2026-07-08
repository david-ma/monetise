# SPA / client-router links escape the proxy

_2026-07-08_

## Symptom

While viewing a proxied page, e.g.

```
https://www.monetiseyourwebsite.com/proxy/https://www.jaffleagency.com/
```

clicking an in-page link to `/need-a-website` navigates to

```
https://www.monetiseyourwebsite.com/need-a-website/
```

instead of the expected

```
https://www.monetiseyourwebsite.com/proxy/https://www.jaffleagency.com/need-a-website
```

The proxy prefix and upstream host are dropped, so you land on our own origin and get a 404.

## Investigation

Reproduced against the live dev server (`bun dev` on :1337).

1. **Server-side rewriting is correct.** In the HTML we actually serve, the anchor is
   already prefixed:

   ```html
   <animated-link><a href="/proxy/https://www.jaffleagency.com/need-a-website" ...>
   ```

   49 of 53 `href`s on the page carry the `/proxy/https://www.jaffleagency.com/` prefix.
   unblocker's `url-prefixer` did its job.

2. **The target site navigates in JavaScript, not via the plain anchor.** jaffleagency.com
   is an **Astro** site: the page has `astro-island` hydration markers and 80 custom
   `<animated-link>` elements whose logic lives in the `_astro/*.js` bundles. On click, the
   site's own router handles navigation and computes the destination from *its own* route
   table (it believes it is running on `www.jaffleagency.com`), yielding a bare
   `/need-a-website` that resolves against our origin.

3. **Our client-side patches don't cover this path.** `src/proxy/client/unblocker-client.ts`
   wraps `fetch`, `XMLHttpRequest`, `history.pushState/replaceState`, and
   `document.createElement` (src/href). It did **not** wrap `window.location` assignments
   (`location.assign` / `location.replace` / `location.href =`) — unblocker upstream lists
   this as a TODO too. A framework that hard-navigates via `location` therefore escapes.

4. **The referer-recovery safety net that stock unblocker has is not wired up here.**
   Verified: `GET /need-a-website` with `Referer: .../proxy/https://www.jaffleagency.com/`
   returns **404**, not a redirect. Stock unblocker runs as top-level middleware and
   `recoverTargetUrl()` would read that `Referer`, rebuild
   `https://www.jaffleagency.com/need-a-website`, and 307-redirect back into `/proxy/`. In
   this app unblocker is mounted **only under the `proxy` controller**, so any non-`/proxy/`
   request is routed by Thalia's normal chain (controller lookup → static/markdown → 404).
   The recovery never runs.

## Options considered

- **Top-level referer recovery (the robust fix).** Mirror unblocker's `recoverTargetUrl`
  for any otherwise-404 request. Would recover most escaped navigations. **Rejected for now:**
  Thalia has no catch-all/404 hook exposed to a project config, so this needs changes to
  Thalia core — too large for the value.
- **Capture-phase click interception.** Intercept anchor clicks before the framework's
  handler. **Rejected:** high risk of breaking legitimate SPA behaviour across many sites,
  and can double-navigate.
- **Wrap `window.location` assignments (the small fix).** Route `location.assign` and
  `location.replace` through `fixUrl`, best-effort and guarded. Small, self-contained in a
  file we already own and inject, low risk. Closes the one documented gap in our client.
  Note: the `location.href` **setter** cannot be reliably redefined (the `Location` object
  is non-configurable in modern browsers), so that path is still uncovered.

## Decision

This is a minor edge case: the overwhelming majority of visitors to a monetised page never
click a link — the joke has already landed. Not worth a large change.

Applied the **small fix** only: wrap `location.assign` / `location.replace` in the injected
client (`initLocation`). It catches hard navigations that go through those methods. It will
**not** fix every SPA router (including possibly this exact Astro case, whose navigation
happens inside a minified bundle), and that is an accepted limitation. If this ever becomes
worth more, the real fix is top-level referer recovery in Thalia.
