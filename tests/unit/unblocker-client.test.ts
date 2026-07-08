import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  explicitLayoutSize,
  originalAssetUrl,
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

describe('explicitLayoutSize', () => {
  test('discards computed size that merely echoes the loaded Monet painting (unconstrained logo)', () => {
    // Real logo is 70x60, but the proxied <img> loaded a 674x600 painting, so an
    // unconstrained (auto) axis reports the painting size via getComputedStyle.
    expect(
      explicitLayoutSize({
        computedWidth: 674,
        computedHeight: 600,
        attrWidth: 0,
        attrHeight: 0,
        intrinsicWidth: 674,
        intrinsicHeight: 600,
      }),
    ).toEqual({ width: 0, height: 0 })
  })

  test('keeps genuine CSS constraints that differ from the loaded resource', () => {
    expect(
      explicitLayoutSize({
        computedWidth: 120,
        computedHeight: 80,
        attrWidth: 0,
        attrHeight: 0,
        intrinsicWidth: 674,
        intrinsicHeight: 600,
      }),
    ).toEqual({ width: 120, height: 80 })
  })

  test('keeps a one-sided constraint while dropping the intrinsic-driven axis', () => {
    // Tailwind h-6 style: explicit height, width auto (echoes painting width).
    expect(
      explicitLayoutSize({
        computedWidth: 674,
        computedHeight: 24,
        attrWidth: 0,
        attrHeight: 0,
        intrinsicWidth: 674,
        intrinsicHeight: 600,
      }),
    ).toEqual({ width: 0, height: 24 })
  })

  test('treats HTML width/height attributes as explicit constraints', () => {
    expect(
      explicitLayoutSize({
        computedWidth: 0,
        computedHeight: 0,
        attrWidth: 200,
        attrHeight: 150,
        intrinsicWidth: 0,
        intrinsicHeight: 0,
      }),
    ).toEqual({ width: 200, height: 150 })
  })

  test('returns zero when there are no constraints and no loaded resource', () => {
    expect(
      explicitLayoutSize({
        computedWidth: 0,
        computedHeight: 0,
        attrWidth: 0,
        attrHeight: 0,
        intrinsicWidth: 0,
        intrinsicHeight: 0,
      }),
    ).toEqual({ width: 0, height: 0 })
  })
})

describe('originalAssetUrl', () => {
  test('strips path-only proxy prefix and cookie query param', () => {
    expect(
      originalAssetUrl(
        '/proxy/https://greens.org.au/themes/greens/logo.svg?__proxy_cookies_to=https%3A%2F%2Fcdn.example%2Flogo.svg',
      ),
    ).toBe('https://greens.org.au/themes/greens/logo.svg')
  })

  test('strips absolute proxy URL on local dev host', () => {
    expect(
      originalAssetUrl(
        'http://localhost:1340/proxy/https://greens.org.au/cdn/logo.svg?__proxy_cookies_to=x',
      ),
    ).toBe('https://greens.org.au/cdn/logo.svg')
  })

  test('strips absolute proxy URL on production host', () => {
    expect(
      originalAssetUrl(
        'https://www.monetiseyourwebsite.com/proxy/https://greens.org.au/logo.svg',
      ),
    ).toBe('https://greens.org.au/logo.svg')
  })

  test('returns upstream URL unchanged when not proxied', () => {
    expect(originalAssetUrl('https://cdn.greens.org.au/logo.svg')).toBe(
      'https://cdn.greens.org.au/logo.svg',
    )
  })

  test('leaves monet URLs unchanged', () => {
    expect(originalAssetUrl('/monet/70w60h42')).toBe('/monet/70w60h42')
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
