import {
  assertPublicInspectionUrl,
  inspectUrl
} from '@santi020k/og/inspect'

interface PagesContext {
  request: Request
}

interface DnsAnswer {
  data: string
  type: number
}

interface DnsResponse {
  Answer?: readonly DnsAnswer[]
}

const isDnsResponse = (value: unknown): value is DnsResponse => {
  if (!value || typeof value !== 'object') return false

  const answer = (value as Readonly<Record<string, unknown>>).Answer

  return answer === undefined || (Array.isArray(answer) && answer.every(item => {
    if (!item || typeof item !== 'object') return false

    const record = item as Readonly<Record<string, unknown>>

    return typeof record.data === 'string' && typeof record.type === 'number'
  }))
}

const literalUrl = (address: string): URL => new URL(address.includes(':') ? `http://[${address}]` : `http://${address}`)

const dnsAddresses = async (hostname: string): Promise<readonly string[]> => {
  const responses = await Promise.all([1, 28].map(async type => {
    const endpoint = new URL('https://cloudflare-dns.com/dns-query')

    endpoint.searchParams.set('name', hostname)
    endpoint.searchParams.set('type', String(type))

    const response = await fetch(endpoint, { headers: { accept: 'application/dns-json' } })

    if (!response.ok) throw new Error('The hostname could not be verified safely.')

    const value: unknown = await response.json()

    if (!isDnsResponse(value)) throw new Error('The hostname returned an invalid DNS response.')

    return value.Answer?.filter(answer => answer.type === type).map(answer => answer.data) ?? []
  }))

  const addresses = responses.flat()

  if (addresses.length === 0) throw new Error('The hostname did not resolve to a public address.')

  return addresses
}

const authorizeHostedUrl = async (url: URL): Promise<void> => {
  assertPublicInspectionUrl(url)

  if (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) {
    throw new Error('The hosted checker only connects to standard HTTP and HTTPS ports. Use the CLI for other ports.')
  }

  const hostname = url.hostname.replace(/^\[|\]$/gu, '')

  if (/^[\d.]+$/u.test(hostname) || hostname.includes(':')) return

  for (const address of await dnsAddresses(hostname)) assertPublicInspectionUrl(literalUrl(address))
}

const json = (value: unknown, status = 200): Response => Response.json(value, {
  headers: {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff'
  },
  status
})

export const onRequestPost = async ({ request }: PagesContext): Promise<Response> => {
  if (request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin') {
    return json({ error: 'Cross-site inspection requests are not allowed.' }, 403)
  }

  const declaredLength = Number(request.headers.get('content-length'))

  if (Number.isFinite(declaredLength) && declaredLength > 1_024) {
    return json({ error: 'The request is too large.' }, 413)
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return json({ error: 'Send a JSON object containing a URL.' }, 400)
  }

  const url = body && typeof body === 'object' && 'url' in body ? (body as { url?: unknown }).url : undefined

  if (typeof url !== 'string' || url.length > 2_048) {
    return json({ error: 'A valid URL is required.' }, 400)
  }

  try {
    const result = await inspectUrl(url, {
      authorizeUrl: authorizeHostedUrl,
      maxHtmlBytes: 1_000_000,
      maxImageBytes: 8_000_000,
      timeoutMilliseconds: 12_000
    })

    return json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The URL could not be inspected.'
    const normalized = message.toLowerCase()
    const forbidden = normalized.includes('private') || normalized.includes('local') || normalized.includes('credentials')

    return json({ error: message }, forbidden ? 403 : 422)
  }
}

export const onRequest = (): Response => json({ error: 'Use POST with a JSON URL.' }, 405)
