/**
 * Custom unblocker client-script injection.
 *
 * Stock unblocker matches `/<head[^>]*>/i`, which also hits `<header>` and can
 * splice script tags into inline JS (e.g. Reddit/shreddit) — SyntaxError +
 * "unblockerInit is not defined" on the second bogus injection.
 */
import { Transform } from 'stream'

/** Match `<head>` or `<head …>` but not `<header>`. */
export const HEAD_OPEN_RE = /<head(?:\s[^>]*)?>/i
export const BODY_OPEN_RE = /<body(?:\s[^>]*)?>/i

export function clientScriptsSnippet(prefix: string, upstreamUrl: string | undefined): string {
  const clientScriptPath = `${prefix}client/unblocker-client.js`
  const config = JSON.stringify({ prefix, url: upstreamUrl ?? '' })
  return [
    `<script src="${clientScriptPath}"></script>`,
    `<script>unblockerInit(${config}, window);</script>`,
  ].join('\n')
}

export function injectClientScriptsIntoHtml(
  html: string,
  prefix: string,
  upstreamUrl: string | undefined,
  alreadyInjected = false,
): { html: string; injected: boolean } {
  if (alreadyInjected || !html) {
    return { html, injected: alreadyInjected }
  }

  const snippet = `\n${clientScriptsSnippet(prefix, upstreamUrl)}\n`

  if (HEAD_OPEN_RE.test(html)) {
    return {
      html: html.replace(HEAD_OPEN_RE, (match) => `${match}${snippet}`),
      injected: true,
    }
  }

  if (BODY_OPEN_RE.test(html)) {
    return {
      html: html.replace(BODY_OPEN_RE, (match) => `${match}${snippet}`),
      injected: true,
    }
  }

  return { html, injected: false }
}

export function clientScriptsInjector(prefix: string) {
  return function injector(data: {
    contentType?: string
    stream: NodeJS.ReadWriteStream
    url?: string
  }): void {
    if (!data.contentType?.includes('text/html')) {
      return
    }

    let injected = false

    data.stream = data.stream.pipe(
      new Transform({
        decodeStrings: false,
        transform(chunk, _encoding, next) {
          let text = chunk.toString()
          if (!injected) {
            const result = injectClientScriptsIntoHtml(text, prefix, data.url, injected)
            text = result.html
            injected = result.injected
          }
          if (text) this.push(text, 'utf8')
          next()
        },
      }),
    ) as NodeJS.ReadWriteStream
  }
}
