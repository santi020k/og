import { describe, expect, test } from 'vitest'

import { assertPublicInspectionUrl, inspectHtml, inspectUrl, scoreInspectionChecks } from '../src/inspect.js'

const completeHtml = `<!doctype html><html lang="en"><head>
<title>Portable metadata inspector</title>
<meta name="description" content="Inspect Open Graph and page metadata before sharing a website with the rest of the world.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://example.com/final">
<meta property="og:type" content="website">
<meta property="og:title" content="Portable metadata inspector">
<meta property="og:description" content="Inspect Open Graph and page metadata before sharing.">
<meta property="og:url" content="https://example.com/final">
<meta property="og:image" content="/social.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Metadata inspection result">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="https://example.com/final">
<meta name="twitter:title" content="Portable metadata inspector">
<meta name="twitter:description" content="Inspect Open Graph and page metadata before sharing.">
<meta name="twitter:image" content="/social.png">
<meta name="twitter:image:alt" content="Metadata inspection result">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script>
</head><body><h1>Inspector</h1></body></html>`

const pngHeader = (): Uint8Array => {
  const bytes = new Uint8Array(24)
  const view = new DataView(bytes.buffer)

  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])

  view.setUint32(16, 1200)

  view.setUint32(20, 630)

  return bytes
}

const webpLosslessHeader = (): Uint8Array => {
  const bytes = new Uint8Array(30)

  bytes.set(new TextEncoder().encode('RIFF'), 0)

  bytes.set(new TextEncoder().encode('WEBP'), 8)

  bytes.set(new TextEncoder().encode('VP8L'), 12)

  bytes.set([0x2f, 0xaf, 0x44, 0x9d, 0x00], 20)

  return bytes
}

describe('metadata inspector', () => {
  test('scores passes fully, warnings partially, and errors without credit', () => {
    expect(scoreInspectionChecks([
      { code: 'pass', label: 'Pass', message: 'Passed.', status: 'pass' },
      { code: 'warning', label: 'Warning', message: 'Warning.', status: 'warning' },
      { code: 'error', label: 'Error', message: 'Failed.', status: 'error' }
    ])).toBe(50)

    expect(scoreInspectionChecks([])).toBe(0)
  })

  test('parses metadata and reports actionable checks', () => {
    const result = inspectHtml(completeHtml, 'https://example.com/final')

    expect(result.metadata.schemaTypes).toEqual(['WebSite'])

    expect(result.metadata.openGraph['og:image']).toBe('/social.png')

    expect(result.checks.filter(item => item.status === 'error')).toEqual([])
  })

  test('follows redirects and inspects social image bytes', async () => {
    const fetcher: typeof fetch = input => {
      const url = new URL(input instanceof Request ? input.url : input)

      if (url.pathname === '/start') {
        return Promise.resolve(new Response(null, { headers: { location: '/final' }, status: 302 }))
      }

      if (url.pathname === '/social.png') {
        return Promise.resolve(new Response(pngHeader(), { headers: { 'content-type': 'image/png' } }))
      }

      return Promise.resolve(new Response(completeHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    }

    const result = await inspectUrl('https://example.com/start', { fetcher })

    expect(result.finalUrl).toBe('https://example.com/final')

    expect(result.redirects).toEqual(['https://example.com/final'])

    expect(result.image).toMatchObject({ height: 630, status: 200, width: 1200 })

    expect(result.summary.error).toBe(0)

    expect(result.score).toBe(100)
  })

  test('accepts localhost for local CLI use and rejects it for hosted inspection', async () => {
    const fetcher: typeof fetch = () => Promise.resolve(new Response('<title>Local</title>', {
      headers: { 'content-type': 'text/html' }
    }))

    await expect(inspectUrl('localhost:4321', { fetcher })).resolves.toMatchObject({
      finalUrl: 'http://localhost:4321/'
    })

    expect(() => {
      assertPublicInspectionUrl(new URL('http://localhost:4321'))
    }).toThrow('CLI')

    expect(() => {
      assertPublicInspectionUrl(new URL('http://127.0.0.1'))
    }).toThrow('CLI')

    expect(() => {
      assertPublicInspectionUrl(new URL('http://[::1]'))
    }).toThrow('CLI')
  })

  test('blocks redirects into private networks before the second fetch', async () => {
    let requests = 0

    const fetcher: typeof fetch = () => {
      requests += 1

      return Promise.resolve(new Response(null, {
        headers: { location: 'http://169.254.169.254/latest' },
        status: 302
      }))
    }

    await expect(inspectUrl('https://example.com', {
      authorizeUrl: assertPublicInspectionUrl,
      fetcher
    })).rejects.toThrow('CLI')

    expect(requests).toBe(1)
  })

  test('reads lossless WebP dimensions without a native image dependency', async () => {
    const html = completeHtml.replaceAll('/social.png', '/social.webp')

    const fetcher: typeof fetch = input => {
      const url = new URL(input instanceof Request ? input.url : input)

      return Promise.resolve(url.pathname === '/social.webp' ?
        new Response(webpLosslessHeader(), { headers: { 'content-type': 'image/webp' } }) :
        new Response(html, { headers: { 'content-type': 'text/html' } }))
    }

    await expect(inspectUrl('https://example.com/final', { fetcher })).resolves.toMatchObject({
      image: { height: 630, width: 1200 }
    })
  })

  test('enforces HTML response limits and authorizes every redirect', async () => {
    const authorized: string[] = []

    const fetcher: typeof fetch = () => Promise.resolve(new Response('x'.repeat(50), {
      headers: { 'content-type': 'text/html' }
    }))

    await expect(inspectUrl('https://example.com', {
      authorizeUrl: url => {
        authorized.push(url.href)
      },
      fetcher,
      maxHtmlBytes: 10
    })).rejects.toThrow('byte limit')

    expect(authorized).toEqual(['https://example.com/'])
  })
})
