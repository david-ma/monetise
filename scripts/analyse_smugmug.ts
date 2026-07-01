#!/usr/bin/env bun
/**
 * Fetch SmugMug album images + metadata for the Monet gallery.
 *
 *
 * Usage:
 *   bun scripts/analyse_smugmug.ts > data/smugmug-monet.json
 *   bun scripts/analyse_smugmug.ts --album $ALBUM_KEY
 *   bun scripts/analyse_smugmug.ts --local-only   # skip API, just list local folders
 *
 * Credentials: SMUGMUG_* variables in .env (see .env.example).
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadSmugMugAlbum, loadSmugMugCreds, type SmugMugCredentials } from './smugmug-creds'

const SMUGMUG_LIB = new URL('../../Thalia/websites/smugmug/config/lib-smugmug.ts', import.meta.url).href

const DEFAULT_ALBUM_KEY = loadSmugMugAlbum()
const DEFAULT_GALLERY_URL = 'https://photos.david-ma.net/Thalia/Monet/n-PBLZL2'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(scriptDir, '..')

type RawAlbumImage = Record<string, unknown>

export type MonetSmugMugImage = {
  imageKey: string
  title: string
  caption: string
  keywords: string
  keywordArray: string[]
  fileName: string
  thumbnailUrl: string
  archivedUrl: string
  webUri: string
  uri: string
  yearStart: number | null
  yearEnd: number | null
  uploadedAt: string
  originalWidth: number | null
  originalHeight: number | null
  originalSize: number | null
}

export type LocalPaintingFile = {
  folder: string
  fileName: string
  title: string | null
  yearStart: number | null
  yearEnd: number | null
}

export type FetchResult = {
  fetchedAt: string
  galleryUrl: string
  albumKey: string
  album: Record<string, unknown> | null
  smugmugImageCount: number
  images: MonetSmugMugImage[]
  local: {
    paintings: number
    paintings2: number
    monet: number
    files: LocalPaintingFile[]
  }
  matchHints: {
    smugmugCaptions: number
    localParsedTitles: number
    captionMatchesLocalTitle: string[]
    smugmugFileNamesInPaintings: string[]
    smugmugFileNamesInPaintings2: string[]
  }
}

async function importSmugMugLib() {
  return import(SMUGMUG_LIB)
}

function parseArgs(argv: string[]) {
  let albumKey = DEFAULT_ALBUM_KEY
  let galleryUrl = DEFAULT_GALLERY_URL
  let localOnly = false

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--local-only') {
      localOnly = true
    } else if (arg === '--album' && argv[i + 1]) {
      albumKey = argv[++i]
    } else if (arg === '--url' && argv[i + 1]) {
      galleryUrl = argv[++i]
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: bun scripts/analyse_smugmug.ts [options]

Options:
  --album KEY     SmugMug album key (default: SMUGMUG_ALBUM or ${DEFAULT_ALBUM_KEY})
  --url URL       Gallery page URL (informational)
  --local-only    List local painting folders only; no API call
  --help          Show this help

Writes JSON to stdout. Redirect to a file:
  bun scripts/analyse_smugmug.ts > data/smugmug-monet.json
`)
      process.exit(0)
    }
  }

  return { albumKey, galleryUrl, localOnly }
}

function parsePaintingFileName(fileName: string): Omit<LocalPaintingFile, 'folder' | 'fileName'> {
  const base = fileName.replace(/\.jpe?g$/i, '')
  const match = base.match(/(.*) \((?:ca\. )?(\d{4})[–-]?(\d{4})?\)/)
  if (!match) {
    return { title: base, yearStart: null, yearEnd: null }
  }
  return {
    title: match[1]?.trim() ?? base,
    yearStart: parseInt(match[2] ?? '', 10) || null,
    yearEnd: match[3] ? parseInt(match[3], 10) : null,
  }
}

function listLocalPaintings(): { counts: FetchResult['local']; files: LocalPaintingFile[] } {
  const folders = [
    { name: 'paintings', dir: path.join(projectRoot, 'data', 'paintings') },
    { name: 'paintings2', dir: path.join(projectRoot, 'data', 'paintings2') },
    { name: 'monet', dir: path.join(projectRoot, 'data', 'Monet') },
  ]

  const files: LocalPaintingFile[] = []
  const counts = { paintings: 0, paintings2: 0, monet: 0, files: [] as LocalPaintingFile[] }

  for (const { name, dir } of folders) {
    if (!fs.existsSync(dir)) continue
    const entries = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f))
    if (name === 'paintings') counts.paintings = entries.length
    if (name === 'paintings2') counts.paintings2 = entries.length
    if (name === 'monet') counts.monet = entries.length

    for (const fileName of entries) {
      files.push({
        folder: name,
        fileName,
        ...parsePaintingFileName(fileName),
      })
    }
  }

  return { counts: { ...counts, files }, files }
}

function parseYearFromKeywords(keywordArray: string[]): { yearStart: number | null; yearEnd: number | null } {
  const years = keywordArray
    .filter((k) => /^\d{4}$/.test(k))
    .map((k) => parseInt(k, 10))
    .filter((y) => y >= 1800 && y <= 2100)

  if (years.length === 0) return { yearStart: null, yearEnd: null }
  if (years.length === 1) return { yearStart: years[0] ?? null, yearEnd: null }
  return { yearStart: years[0] ?? null, yearEnd: years[1] ?? null }
}

function normaliseImage(raw: RawAlbumImage): MonetSmugMugImage {
  const keywordArray = Array.isArray(raw.KeywordArray)
    ? (raw.KeywordArray as string[])
    : typeof raw.Keywords === 'string'
      ? raw.Keywords.split(';').map((k) => k.trim()).filter(Boolean)
      : []

  const { yearStart, yearEnd } = parseYearFromKeywords(keywordArray)

  return {
    imageKey: String(raw.ImageKey ?? raw.Key ?? ''),
    title: String(raw.Title ?? ''),
    caption: String(raw.Caption ?? raw.Title ?? ''),
    keywords: String(raw.Keywords ?? ''),
    keywordArray,
    fileName: String(raw.FileName ?? ''),
    thumbnailUrl: String(raw.ThumbnailUrl ?? ''),
    archivedUrl: String(raw.ArchivedUri ?? ''),
    webUri: String(raw.WebUri ?? ''),
    uri: String(raw.Uri ?? ''),
    yearStart,
    yearEnd,
    uploadedAt: String(raw.DateTimeUploaded ?? raw.Date ?? ''),
    originalWidth: typeof raw.OriginalWidth === 'number' ? raw.OriginalWidth : null,
    originalHeight: typeof raw.OriginalHeight === 'number' ? raw.OriginalHeight : null,
    originalSize: typeof raw.OriginalSize === 'number' ? raw.OriginalSize : null,
  }
}

async function fetchAllAlbumImages(
  creds: SmugMugCredentials,
  albumKey: string,
): Promise<MonetSmugMugImage[]> {
  const { get } = await importSmugMugLib()
  const images: MonetSmugMugImage[] = []
  let nextPath: string | null = `/api/v2/album/${encodeURIComponent(albumKey)}!images`

  while (nextPath) {
    const body = (await get(creds, nextPath)) as { Response?: Record<string, unknown> }
    const res = body.Response ?? {}
    const list = res.AlbumImage ?? res.AlbumImages ?? res.Image ?? res.Images ?? []
    const items = Array.isArray(list) ? list : list ? [list] : []

    for (const item of items) {
      images.push(normaliseImage(item as RawAlbumImage))
    }

    const pages = res.Pages as { NextPage?: string } | undefined
    nextPath = pages?.NextPage ?? null
  }

  return images
}

function buildMatchHints(images: MonetSmugMugImage[], localFiles: LocalPaintingFile[]) {
  const localTitles = new Set(
    localFiles.map((f) => f.title?.toLowerCase().trim()).filter(Boolean) as string[],
  )
  const paintingsNames = new Set(
    localFiles.filter((f) => f.folder === 'paintings').map((f) => f.fileName),
  )
  const paintings2Names = new Set(
    localFiles.filter((f) => f.folder === 'paintings2').map((f) => f.fileName),
  )

  const captionMatchesLocalTitle = images
    .filter((img) => localTitles.has(img.caption.toLowerCase().trim()))
    .map((img) => img.caption)

  const smugmugFileNamesInPaintings = images
    .map((img) => img.fileName)
    .filter((name) => paintingsNames.has(name))

  const smugmugFileNamesInPaintings2 = images
    .map((img) => img.fileName)
    .filter((name) => paintings2Names.has(name))

  return {
    smugmugCaptions: images.filter((img) => img.caption.length > 0).length,
    localParsedTitles: localTitles.size,
    captionMatchesLocalTitle,
    smugmugFileNamesInPaintings,
    smugmugFileNamesInPaintings2,
  }
}

async function main() {
  const { albumKey, galleryUrl, localOnly } = parseArgs(process.argv)
  const { counts, files } = listLocalPaintings()

  let album = null
  let images: MonetSmugMugImage[] = []

  if (!localOnly) {
    const creds = loadSmugMugCreds()
    const lib = await importSmugMugLib()
    album = await lib.getAlbum(creds, albumKey)
    images = await fetchAllAlbumImages(creds, albumKey)
  }

  const result: FetchResult = {
    fetchedAt: new Date().toISOString(),
    galleryUrl,
    albumKey,
    album,
    smugmugImageCount: images.length,
    images,
    local: {
      ...counts,
      files,
    },
    matchHints: buildMatchHints(images, files),
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
