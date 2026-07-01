import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveImageDimensions } from '../../src/proxy/client/unblocker-client'

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

  test('uses DOM for one axis and natural for the other when mixed', () => {
    expect(
      resolveImageDimensions({
        domWidth: 0,
        domHeight: 64,
        naturalWidth: 1920,
        naturalHeight: 0,
      }),
    ).toEqual({ width: 1920, height: 64 })
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
