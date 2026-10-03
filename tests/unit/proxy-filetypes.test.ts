import { describe, expect, test } from 'bun:test'
import {
  blockedFiletypeFromFilename,
  blockedFiletypeFromHeaders,
  rejectProxyRequest,
} from '../../config/proxy-target'
import { rejectMirrorRequest } from '../../config/mirror-target'

describe('filetype blocking', () => {
  test('rejects PDF paths including encoded, uppercase and query variants', () => {
    for (const path of ['paper.pdf', 'PAPER.PDF?download=1', 'paper%2Epdf', 'paper.%70%64%66', 'paper%252epdf']) {
      expect(rejectProxyRequest(`/proxy/https://example.com/${path}`)).toBe('blocked filetype: pdf')
      expect(rejectMirrorRequest(`/mirror/https://example.com/${path}`)).toBeNull()
    }
    expect(rejectProxyRequest('/proxy/example.com/paper.pdf#page=2')).toBe('blocked filetype: pdf')
  })

  test('does not mistake URL queries, hosts or directories for a file extension', () => {
    for (const path of ['paper.pdf/view', 'paper.pdf.html', '?filename=paper.pdf', '#paper.pdf']) {
      expect(rejectProxyRequest(`/proxy/https://example.com/${path}`)).toBeNull()
    }
    expect(rejectProxyRequest('/proxy/https://example.pdf/')).toBeNull()
    expect(rejectProxyRequest('/proxy/client/unblocker-client.js')).toBeNull()
  })

  test('the toggle allows PDF downloads without disabling hostname guards', () => {
    expect(rejectProxyRequest('/proxy/https://example.com/paper.pdf', false)).toBeNull()
    expect(rejectProxyRequest('/proxy/https://localhost/paper.pdf', false)).toBe('blocked hostname')
    expect(blockedFiletypeFromHeaders({ 'content-type': 'application/pdf' }, false)).toBeNull()
    expect(blockedFiletypeFromHeaders({ 'content-disposition': 'attachment; filename="x.pdf"' }, false)).toBeNull()
  })

  test('detects MIME types independently of a URL extension', () => {
    for (const mime of ['application/pdf', 'Application/PDF; charset=binary', 'application/x-pdf']) {
      expect(blockedFiletypeFromHeaders({ 'content-type': mime })).toBe('pdf')
    }
    expect(blockedFiletypeFromHeaders({ 'content-type': 'text/html' })).toBeNull()
    expect(blockedFiletypeFromHeaders({})).toBeNull()
  })

  test('detects attachment and inline filenames, including RFC 5987', () => {
    for (const disposition of [
      'attachment; filename="Report.PDF"',
      'inline; filename=paper.pdf',
      "attachment; filename*=UTF-8''paper%2Epdf",
      "attachment; filename=download; filename*=UTF-8'en'paper.pdf",
      'attachment; filename="a;b.pdf"; size=123',
    ]) {
      expect(blockedFiletypeFromHeaders({ 'content-disposition': disposition })).toBe('pdf')
    }
    expect(blockedFiletypeFromHeaders({ 'content-disposition': 'attachment; filename="paper.pdf.txt"' })).toBeNull()
  })

  test('adding or removing a filetype changes both extension and MIME policy', () => {
    const filetypes = { zip: ['application/zip'] }
    expect(blockedFiletypeFromFilename('archive.zip', true, filetypes)).toBe('zip')
    expect(blockedFiletypeFromHeaders({ 'content-type': 'application/zip' }, true, filetypes)).toBe('zip')
    expect(blockedFiletypeFromHeaders({ 'content-disposition': 'attachment; filename=archive.zip' }, true, filetypes)).toBe('zip')
    expect(blockedFiletypeFromFilename('paper.pdf', true, filetypes)).toBeNull()
    expect(blockedFiletypeFromHeaders({ 'content-type': 'application/pdf' }, true, filetypes)).toBeNull()
    expect(blockedFiletypeFromFilename('paper.pdf', true, {})).toBeNull()
  })
})
