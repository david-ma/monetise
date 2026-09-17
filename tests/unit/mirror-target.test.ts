import { describe, expect, test } from 'bun:test'
import { mirrorTargetRawFromRequest, rejectMirrorRequest } from '../../config/mirror-target'

describe('mirrorTargetRawFromRequest', () => {
  test('extracts HTTPS SmugMug URL', () => {
    const url =
      'https://photos.smugmug.com/photos/i-k/0/hash/L/i-k-L.jpg'
    expect(mirrorTargetRawFromRequest(`/mirror/${url}`)).toBe(url)
  })

  test('prefixes https when scheme omitted', () => {
    expect(mirrorTargetRawFromRequest('/mirror/photos.smugmug.com/x.jpg')).toBe(
      'https://photos.smugmug.com/x.jpg',
    )
  })
})

describe('rejectMirrorRequest', () => {
  test('shares the proxy domain block', () => {
    expect(rejectMirrorRequest('/mirror/https://uob.academia.edu/image.jpg')).toBe('blocked domain')
    expect(rejectMirrorRequest('/mirror/https://ARXIV.ORG./image.jpg')).toBe('blocked domain')
    expect(rejectMirrorRequest('/mirror/arxiv.org/image.jpg')).toBe('blocked domain')
  })

  test('allows public CDN hosts', () => {
    expect(
      rejectMirrorRequest(
        '/mirror/https://photos.smugmug.com/photos/i-k/0/hash/L/i-k-L.jpg',
      ),
    ).toBeNull()
  })

  test('rejects localhost SSRF', () => {
    expect(rejectMirrorRequest('/mirror/https://127.0.0.1/secret')).toBe('blocked IP address')
  })

  test('requires mirror payload', () => {
    expect(rejectMirrorRequest('/mirror/')).toBe('missing mirror URL')
  })
})
