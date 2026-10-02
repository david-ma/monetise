import type { IncomingMessage, ServerResponse } from 'http'
import { blockedFiletypeFromHeaders, blockedFiletypeFromUrl } from './proxy-target'

export type FiletypeLoggedRequest = IncomingMessage & {
  onBlockedFiletype?: (reason: string, upstreamUrl: string) => void
}

/** /proxy/ response middleware; deliberately absent from the /mirror/ middleware chain. */
export function blockFiletypeResponse(data: {
  url: string
  headers: Record<string, string | string[] | undefined>
  remoteResponse: IncomingMessage
  clientRequest: FiletypeLoggedRequest
  clientResponse: ServerResponse
}): void {
  const filetype = blockedFiletypeFromUrl(data.url) ?? blockedFiletypeFromHeaders(data.headers)
  if (!filetype) return

  data.clientResponse.writeHead(403, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  data.clientResponse.end('403 Not allowed')
  // Stop reading the download; unblocker stops its middleware chain once headers are sent.
  data.remoteResponse.destroy()
  data.clientRequest.onBlockedFiletype?.(`blocked filetype: ${filetype}`, data.url)
}
