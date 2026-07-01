import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  resolveImageDimensions,
} from '../../src/proxy/client/unblocker-client'

const builtClient = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../public/proxy/client/unblocker-client.js',
)

describe('resolveImageDimensions', () => {
  test('prefers DOM dimensions when provided', () => {
    expect(
      resolveImageDimensions({
        domWidth: 120,
        domHeight: 80,
        naturalWidth: 2000,
        naturalHeight: 1500,
      }),
    ).toEqual({ width: 120, height: 80 })
  })

  test('uses natural dimensions when DOM size is zero', () => {
    expect(
      resolveImageDimensions({
        domWidth: 0,
        domHeight: 0,
        naturalWidth: 2000,
        naturalHeight: 1500,
      }),
    ).toEqual({ width: 2000, height: 1500 })
  })

  test('falls back to 300 when neither DOM nor natural size is available', () => {
    expect(
      resolveImageDimensions({
        domWidth: 0,
        domHeight: 0,
        naturalWidth: 0,
        naturalHeight: 0,
      }),
    ).toEqual({ width: 300, height: 300 })
  })

  test('derives width from CSS height and intrinsic aspect ratio', () => {
    expect(
      resolveImageDimensions({
        domWidth: 0,
        domHeight: 24,
        naturalWidth: 199,
        naturalHeight: 24,
      }),
    ).toEqual({ width: 199, height: 24 })
  })

  test('derives height from CSS width and intrinsic aspect ratio', () => {
    expect(
      resolveImageDimensions({
        domWidth: 199,
        domHeight: 0,
        naturalWidth: 199,
        naturalHeight: 24,
      }),
    ).toEqual({ width: 199, height: 24 })
  })

  test('derives width from CSS height and intrinsic aspect ratio when natural height was unknown', () => {
    expect(
      resolveImageDimensions({
        domWidth: 0,
        domHeight: 64,
        naturalWidth: 1920,
        naturalHeight: 1080,
      }),
    ).toEqual({ width: 114, height: 64 })
  })
})

describe('unblocker client bundle', () => {
  test('build:client output exists and exposes monetise hooks', () => {
    const js = fs.readFileSync(builtClient, 'utf8')
    expect(js).toContain('window.unblockerInit')
    expect(js).toContain('monetiseAllImages')
    expect(js).toContain('DOMContentLoaded')
  })
})
