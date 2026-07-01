/**
 * Monet painting assets — served directly from SmugMug CDN.
 *
 * Catalog source: data/smugmug-monet.json (bun run smugmug:fetch).
 * Revision and hash are not separate API fields; they are parsed from any
 * photos.smugmug.com URL (e.g. thumbnailUrl) and cached per image.
 */
import catalog from '../data/smugmug-monet.json'

export type SmugMugSize = 'Ti' | 'Th' | 'S' | 'M' | 'L' | 'XL' | 'X2' | 'X3' | 'X4' | 'X5' | '4k' | '5k' | 'O'

/** Parsed components of a SmugMug photos.smugmug.com embed URL. */
export interface SmugMugPhotoUrlParts {
  photoId: string
  /** Single revision digit — hex in practice (0–9, A–F). */
  revision: string
  /** Opaque hash segment between revision and display size. */
  hash: string
  pathSize: SmugMugSize
  fileSize: SmugMugSize
  ext: string
}

export type MonetPaintingAsset = {
  imageKey: string
  photoId: string
  revision: string
  hash: string
  ext: string
  title: string
  alt: string
  yearStart: number | null
  yearEnd: number | null
}

const SMUGMUG_SIZE_CODES = 'Ti|Th|S|M|L|XL|X2|X3|X4|X5|4k|5k|O'

const SMUGMUG_PHOTO_URL = new RegExp(
  '^https://photos\\.smugmug\\.com/photos/' +
    `(?<photoId>i-[A-Za-z0-9]+)/` +
    `(?<revision>[0-9A-Fa-f])/` +
    `(?<hash>[A-Za-z0-9]+)/` +
    `(?<pathSize>${SMUGMUG_SIZE_CODES})/` +
    `\\k<photoId>-(?<fileSize>${SMUGMUG_SIZE_CODES})\\.(?<ext>[a-z]+)$`,
)

/** Long-edge pixel caps for each SmugMug display tier (approximate). */
const SIZE_FOR_LONG_EDGE: { maxLongEdge: number; size: SmugMugSize }[] = [
  { maxLongEdge: 100, size: 'Ti' },
  { maxLongEdge: 150, size: 'Th' },
  { maxLongEdge: 320, size: 'S' },
  { maxLongEdge: 640, size: 'M' },
  { maxLongEdge: 800, size: 'L' },
  { maxLongEdge: 1024, size: 'XL' },
  { maxLongEdge: 1280, size: 'X2' },
  { maxLongEdge: 1600, size: 'X3' },
  { maxLongEdge: 2048, size: 'X4' },
  { maxLongEdge: 2560, size: 'X5' },
  { maxLongEdge: 4096, size: '4k' },
  { maxLongEdge: 5120, size: '5k' },
]

export const monetAlbumKey = catalog.albumKey

function catalogEntryToAsset(entry: (typeof catalog.images)[number]): MonetPaintingAsset {
  const parts = parseSmugMugPhotoUrl(entry.thumbnailUrl)
  return {
    imageKey: entry.imageKey,
    photoId: parts.photoId,
    revision: parts.revision,
    hash: parts.hash,
    ext: parts.ext,
    title: entry.title,
    alt: entry.caption || entry.title,
    yearStart: entry.yearStart,
    yearEnd: entry.yearEnd,
  }
}

/** All Monet paintings with SmugMug URL parts derived from the catalog export. */
export const monetPaintings: MonetPaintingAsset[] = catalog.images.map(catalogEntryToAsset)

const paintingsByKey = new Map(monetPaintings.map((p) => [p.imageKey, p]))

/** Parse a full SmugMug photo URL into its structural parts. */
export function parseSmugMugPhotoUrl(url: string): SmugMugPhotoUrlParts {
  const match = url.match(SMUGMUG_PHOTO_URL)
  if (!match?.groups) {
    throw new Error(`Not a SmugMug photo URL: ${url}`)
  }

  const { photoId, revision, hash, pathSize, fileSize, ext } = match.groups
  return {
    photoId,
    revision,
    hash,
    pathSize: pathSize as SmugMugSize,
    fileSize: fileSize as SmugMugSize,
    ext,
  }
}

/** Build a SmugMug photo URL from parsed parts. pathSize and fileSize default to the same code. */
export function buildSmugMugPhotoUrl(
  parts: Pick<SmugMugPhotoUrlParts, 'photoId' | 'revision' | 'hash' | 'ext' | 'pathSize'> & {
    fileSize?: SmugMugSize
  },
): string {
  const fileSize = parts.fileSize ?? parts.pathSize
  return (
    `https://photos.smugmug.com/photos/${parts.photoId}/${parts.revision}/${parts.hash}/` +
    `${parts.pathSize}/${parts.photoId}-${fileSize}.${parts.ext}`
  )
}

/** Smallest SmugMug tier whose long edge is at least the requested pixel count. */
export function smugMugSizeForLongEdge(px: number): SmugMugSize {
  const edge = Math.max(1, Math.ceil(px))
  for (const tier of SIZE_FOR_LONG_EDGE) {
    if (edge <= tier.maxLongEdge) {
      return tier.size
    }
  }
  return 'O'
}

/** Pick a display size from width × height (uses the longer edge). */
export function smugMugSizeForBox(width: number, height: number, fallback: SmugMugSize = 'L'): SmugMugSize {
  const w = Number.isFinite(width) ? width : 0
  const h = Number.isFinite(height) ? height : 0
  const longEdge = Math.max(w, h)
  if (longEdge <= 0) {
    return fallback
  }
  return smugMugSizeForLongEdge(longEdge)
}

export function paintingByImageKey(imageKey: string): MonetPaintingAsset | undefined {
  return paintingsByKey.get(imageKey)
}

export function paintingAtIndex(index: number): MonetPaintingAsset {
  if (monetPaintings.length === 0) {
    throw new Error('Monet painting catalog is empty')
  }
  const i = ((index % monetPaintings.length) + monetPaintings.length) % monetPaintings.length
  return monetPaintings[i]
}

/** Stable painting pick from a numeric seed (e.g. unblocker client id). */
export function paintingForSeed(seed: number): MonetPaintingAsset {
  return paintingAtIndex(Math.floor(seed))
}

/**
 * CDN URL for a catalog painting at the given SmugMug size tier.
 * Revision and hash come from the cached asset (parsed once from thumbnailUrl).
 */
export function paintingUrl(imageKey: string, size: SmugMugSize = 'L'): string {
  const painting = paintingByImageKey(imageKey)
  if (!painting) {
    throw new Error(`Unknown Monet imageKey: ${imageKey}`)
  }
  return buildSmugMugPhotoUrl({
    photoId: painting.photoId,
    revision: painting.revision,
    hash: painting.hash,
    ext: painting.ext,
    pathSize: size,
  })
}

export type MonetPaintingUrlOptions = {
  imageKey?: string
  seed?: number
  width?: number
  height?: number
  size?: SmugMugSize
}

/**
 * Resolve a SmugMug CDN URL for the proxy /monet routes.
 * Picks a random painting when neither imageKey nor seed is given.
 */
export function monetPaintingUrl(options: MonetPaintingUrlOptions = {}): string {
  const painting =
    options.imageKey != null
      ? paintingByImageKey(options.imageKey) ?? paintingForSeed(options.seed ?? 0)
      : options.seed != null
        ? paintingForSeed(options.seed)
        : paintingAtIndex(Math.floor(Math.random() * monetPaintings.length))

  const size =
    options.size ??
    (options.width != null || options.height != null
      ? smugMugSizeForBox(options.width ?? 0, options.height ?? 0)
      : 'L')

  return buildSmugMugPhotoUrl({
    photoId: painting.photoId,
    revision: painting.revision,
    hash: painting.hash,
    ext: painting.ext,
    pathSize: size,
  })
}

/** Parse /monet/300w200h42 style paths from the unblocker client. */
export function parseMonetRequestPath(pathname: string): { width: number; height: number; seed: number } | null {
  const match = pathname.match(/(\d+)w(\d+)h(\d+)/)
  if (!match) {
    return null
  }
  return {
    width: parseInt(match[1], 10),
    height: parseInt(match[2], 10),
    seed: parseInt(match[3], 10),
  }
}
