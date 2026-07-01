import { describe, expect, test } from 'bun:test'
import {
  buildSmugMugPhotoUrl,
  monetAlbumKey,
  monetPaintingUrl,
  monetPaintings,
  paintingForSeed,
  paintingUrl,
  parseMonetRequestPath,
  parseSmugMugPhotoUrl,
  smugMugSizeForBox,
  smugMugSizeForLongEdge,
} from '../../config/assets'

describe('monet painting catalog', () => {
  test('loads paintings from smugmug-monet.json', () => {
    expect(monetPaintings.length).toBeGreaterThan(100)
    expect(monetAlbumKey).toBe('2qwT3k')
  })

  test('every painting has SmugMug URL parts parsed from thumbnailUrl', () => {
    for (const painting of monetPaintings) {
      expect(painting.photoId).toMatch(/^i-[A-Za-z0-9]+$/)
      expect(painting.revision).toMatch(/^[0-9A-Fa-f]$/)
      expect(painting.hash.length).toBeGreaterThan(10)
      expect(painting.ext).toBe('jpg')
      expect(painting.alt.length).toBeGreaterThan(0)
    }
  })
})

describe('parseSmugMugPhotoUrl', () => {
  test('extracts photoId, revision, hash, and size codes from thumbnail URLs', () => {
    const sample = monetPaintings[0]
    const url = paintingUrl(sample.imageKey, 'Th')
    expect(parseSmugMugPhotoUrl(url)).toEqual({
      photoId: sample.photoId,
      revision: sample.revision,
      hash: sample.hash,
      pathSize: 'Th',
      fileSize: 'Th',
      ext: sample.ext,
    })
  })

  test('round-trips through buildSmugMugPhotoUrl', () => {
    const painting = monetPaintings[0]
    const url = paintingUrl(painting.imageKey, 'M')
    const parts = parseSmugMugPhotoUrl(url)
    expect(buildSmugMugPhotoUrl(parts)).toBe(url)
  })
})

describe('smugMugSizeForLongEdge', () => {
  test('picks the smallest tier that covers the requested long edge', () => {
    expect(smugMugSizeForLongEdge(120)).toBe('Th')
    expect(smugMugSizeForLongEdge(300)).toBe('S')
    expect(smugMugSizeForLongEdge(600)).toBe('M')
    expect(smugMugSizeForLongEdge(900)).toBe('XL')
  })
})

describe('smugMugSizeForBox', () => {
  test('uses the longer of width and height', () => {
    expect(smugMugSizeForBox(300, 200)).toBe('S')
    expect(smugMugSizeForBox(200, 700)).toBe('L')
  })
})

describe('monetPaintingUrl', () => {
  test('returns a photos.smugmug.com URL', () => {
    const url = monetPaintingUrl({ seed: 42, width: 300, height: 200 })
    expect(url).toMatch(/^https:\/\/photos\.smugmug\.com\/photos\/i-/)
    expect(url).toMatch(/\/S\/i-[A-Za-z0-9]+-S\.jpg$/)
  })

  test('is stable for the same seed', () => {
    const a = monetPaintingUrl({ seed: 99, width: 640, height: 480 })
    const b = monetPaintingUrl({ seed: 99, width: 640, height: 480 })
    expect(a).toBe(b)
    expect(paintingForSeed(99).imageKey).toBe(parseSmugMugPhotoUrl(a).photoId.slice(2))
  })
})

describe('parseMonetRequestPath', () => {
  test('parses unblocker client paths', () => {
    expect(parseMonetRequestPath('/monet/300w200h42')).toEqual({
      width: 300,
      height: 200,
      seed: 42,
    })
  })
})
