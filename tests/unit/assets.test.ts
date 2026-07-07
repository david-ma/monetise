import { describe, expect, test } from 'bun:test'
import {
  ASPECT_RATIO_CANDIDATE_POOL_SIZE,
  buildSmugMugPhotoUrl,
  clampSmugMugSize,
  MAX_SMUGMUG_SERVE_SIZE,
  monetAlbumKey,
  monetPaintingUrl,
  monetPaintings,
  paintingAspectRatios,
  paintingForAspectRatio,
  paintingIndicesClosestToAspectRatio,
  paintingsClosestToAspectRatio,
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
      expect(painting.aspectRatio).toBeGreaterThan(0)
      expect(painting.aspectRatio).toBe(paintingAspectRatios[monetPaintings.indexOf(painting)])
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

describe('aspect ratio matching', () => {
  test('pre-processes aspect ratios for every painting', () => {
    expect(paintingAspectRatios.length).toBe(monetPaintings.length)
    for (const ratio of paintingAspectRatios) {
      expect(ratio).toBeGreaterThan(0)
    }
  })

  test('returns up to ASPECT_RATIO_CANDIDATE_POOL_SIZE closest paintings', () => {
    const pool = paintingsClosestToAspectRatio(1.5)
    expect(pool.length).toBe(ASPECT_RATIO_CANDIDATE_POOL_SIZE)
  })

  test('prefers paintings with similar aspect ratio over extreme mismatches', () => {
    const target = 1.5
    const pool = paintingsClosestToAspectRatio(target)
    const poolDistances = pool.map((p) => Math.abs(p.aspectRatio - target))
    const worstInPool = Math.max(...poolDistances)

    const outsidePool = monetPaintings.filter((p) => !pool.some((candidate) => candidate.imageKey === p.imageKey))
    const bestOutside = Math.min(...outsidePool.map((p) => Math.abs(p.aspectRatio - target)))

    expect(worstInPool).toBeLessThanOrEqual(bestOutside)
  })

  test('seed picks stably within the aspect-ratio pool', () => {
    const a = paintingForAspectRatio(640, 480, 99)
    const b = paintingForAspectRatio(640, 480, 99)
    expect(a.imageKey).toBe(b.imageKey)

    const pool = new Set(
      paintingsClosestToAspectRatio(640 / 480).map((p) => p.imageKey),
    )
    expect(pool.has(a.imageKey)).toBe(true)
  })

  test('different seeds can pick different paintings from the same pool', () => {
    const poolKeys = new Set(paintingIndicesClosestToAspectRatio(640 / 480).map((i) => monetPaintings[i].imageKey))
    const picks = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((seed) =>
        paintingForAspectRatio(640, 480, seed).imageKey,
      ),
    )
    expect(picks.size).toBeGreaterThan(1)
    for (const key of picks) {
      expect(poolKeys.has(key)).toBe(true)
    }
  })
})

describe('smugMugSizeForLongEdge', () => {
  test('picks the smallest tier that covers the requested long edge', () => {
    expect(smugMugSizeForLongEdge(120)).toBe('Th')
    expect(smugMugSizeForLongEdge(300)).toBe('S')
    expect(smugMugSizeForLongEdge(600)).toBe('M')
    expect(smugMugSizeForLongEdge(900)).toBe('XL')
  })

  test('caps oversized requests at MAX_SMUGMUG_SERVE_SIZE', () => {
    expect(MAX_SMUGMUG_SERVE_SIZE).toBe('X2')
    expect(smugMugSizeForLongEdge(1500)).toBe('X2')
    expect(smugMugSizeForLongEdge(4000)).toBe('X2')
  })
})

describe('clampSmugMugSize', () => {
  test('passes through tiers at or below the serve cap', () => {
    expect(clampSmugMugSize('M')).toBe('M')
    expect(clampSmugMugSize('X2')).toBe('X2')
  })

  test('clamps tiers above the serve cap', () => {
    expect(clampSmugMugSize('X3')).toBe('X2')
    expect(clampSmugMugSize('5k')).toBe('X2')
    expect(clampSmugMugSize('O')).toBe('X2')
  })
})

describe('smugMugSizeForBox', () => {
  test('uses the longer of width and height', () => {
    expect(smugMugSizeForBox(300, 200)).toBe('S')
    expect(smugMugSizeForBox(200, 700)).toBe('L')
  })

  test('caps large boxes at MAX_SMUGMUG_SERVE_SIZE', () => {
    expect(smugMugSizeForBox(3840, 2160)).toBe('X2')
  })
})

describe('monetPaintingUrl', () => {
  test('returns a photos.smugmug.com URL', () => {
    const url = monetPaintingUrl({ seed: 42, width: 300, height: 200 })
    expect(url).toMatch(/^https:\/\/photos\.smugmug\.com\/photos\/i-/)
    expect(url).toMatch(/\/S\/i-[A-Za-z0-9]+-S\.jpg$/)
  })

  test('is stable for the same seed and dimensions', () => {
    const a = monetPaintingUrl({ seed: 99, width: 640, height: 480 })
    const b = monetPaintingUrl({ seed: 99, width: 640, height: 480 })
    expect(a).toBe(b)
  })

  test('clamps explicit size above MAX_SMUGMUG_SERVE_SIZE', () => {
    const url = monetPaintingUrl({ seed: 1, size: 'O' })
    expect(url).toMatch(/\/X2\/i-[A-Za-z0-9]+-X2\.jpg$/)
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
