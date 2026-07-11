# GitHub issue draft — Monetise `/mirror/`

Create at: https://github.com/david-ma/monetise/issues/new

**Title:** Add /mirror/ to passthrough external URLs with permissive CORS

---

## Summary

Add a **`GET /mirror/https://…`** route that fetches an upstream URL and streams the bytes back **unchanged**, with permissive CORS headers so browser clients (e.g. Three.js `TextureLoader`) can use cross-origin images in WebGL.

Unlike `/proxy/`, this route must **not** rewrite HTML or replace images with Monet paintings.

## Motivation

SmugMug CDN URLs (`photos.smugmug.com`, custom domains) work in `<img>` tags but **do not** send `Access-Control-Allow-Origin`. WebGL textures require CORS approval, so 3D viewers on other origins see black artwork unless images are served through a CORS-enabled mirror.

The **Parallel Horizons / gallery** project needs this for `/view` artwork textures. Prefer a shared Monetise endpoint over a gallery-local proxy.

## Proposed behaviour

```
GET /mirror/https://photos.smugmug.com/photos/i-…/L/i-…-L.jpg
→ 200, Content-Type from upstream, Access-Control-Allow-Origin: *
```

- Same SSRF guards as `/proxy/` (`config/proxy-target.ts` hostname blocklist)
- `OPTIONS` support for preflight
- `Cache-Control: public, max-age=86400` on success
- Skip visit logging (like `/monet`)

## Non-goals

- Not a full site proxy (use existing `/proxy/` for that)
- Not storing/mirroring files to disk — streaming passthrough only

## Implementation (done locally)

- `config/mirror-target.ts` — parse `/mirror/` URLs + SSRF validation
- `config/mirror.ts` — fetch upstream + CORS response headers
- `config/config.ts` — `mirror` controller
- Tests: `tests/unit/mirror-target.test.ts`, integration OPTIONS check

## Gallery integration

Gallery reads `MONETISE_MIRROR_ORIGIN` and rewrites floorplan artwork URLs to:

```
{MONETISE_MIRROR_ORIGIN}/mirror/{originalSmugMugUrl}
```

Local dev: run Monetise (`bun run dev`) and set e.g. `MONETISE_MIRROR_ORIGIN=http://localhost:3000` in gallery `.env`.

## References

- [SmugMug Image API](https://api.smugmug.com/api/v2/doc/reference/image.html) — CDN URLs; no CORS configuration
- [SmugMug method overrides](https://api.smugmug.com/api/v2/doc/advanced/overrides.html) — JSON API only; unrelated to CDN CORS
