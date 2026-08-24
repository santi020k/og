import {
  assertPublicInspectionUrl,
  inspectUrl
} from '@santi020k/og/inspect'

interface PagesContext {
  env: {
    TURNSTILE_SECRET_KEY?: string
  }
  request: Request
}

interface DnsAnswer {
  data: string
  type: number
}

interface DnsResponse {
  Answer?: readonly DnsAnswer[]
  Status?: number
}

interface TurnstileVerification {
  action?: string
  hostname?: string
  success: boolean
}

const turnstileTestSecret = '1x0000000000000000000000000000000AA'

const isDnsResponse = (value: unknown): value is DnsResponse => {
  if (!value || typeof value !== 'object') return false

  const answer = (value as Readonly<Record<string, unknown>>).Answer
  const status = (value as Readonly<Record<string, unknown>>).Status

  return (status === undefined || typeof status === 'number') && (answer === undefined || (Array.isArray(answer) && answer.every(item => {
    if (!item || typeof item !== 'object') return false

    const record = item as Readonly<Record<string, unknown>>

    return typeof record.data === 'string' && typeof record.type === 'number'
  })))
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
    if (value.Status !== undefined && value.Status !== 0) throw new Error('The hostname could not be resolved safely.')

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

const isTurnstileVerification = (value: unknown): value is TurnstileVerification => {
  if (!value || typeof value !== 'object') return false

  const record = value as Readonly<Record<string, unknown>>

  return typeof record.success === 'boolean' &&
    (record.action === undefined || typeof record.action === 'string') &&
    (record.hostname === undefined || typeof record.hostname === 'string')
}

const verifyTurnstile = async (
  token: string,
  request: Request,
  secret: string
): Promise<boolean> => {
  const remoteAddress = request.headers.get('cf-connecting-ip')?.trim()
  const form = new FormData()

  form.set('secret', secret)
  form.set('response', token)
  if (remoteAddress) form.set('remoteip', remoteAddress)

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    body: form,
    method: 'POST'
  })

  if (!response.ok) throw new Error('Turnstile verification is unavailable.')

  const value: unknown = await response.json()

  if (!isTurnstileVerification(value)) throw new Error('Turnstile returned an invalid verification response.')

  if (secret === turnstileTestSecret) return value.success

  return value.success && value.action === 'inspect' && value.hostname === new URL(request.url).hostname
}

const json = (value: unknown, status = 200, extraHeaders: HeadersInit = {}): Response => Response.json(value, {
  headers: {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    ...Object.fromEntries(new Headers(extraHeaders)),
    'x-content-type-options': 'nosniff'
  },
  status
})

export const onRequestPost = async ({ env, request }: PagesContext): Promise<Response> => {
  const requestOrigin = new URL(request.url).origin
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')

  if ((origin && origin !== requestOrigin) || (!origin && fetchSite !== 'same-origin')) {
    return json({ error: 'Cross-site inspection requests are not allowed.' }, 403)
  }

  if (!env.TURNSTILE_SECRET_KEY) {
    return json({ error: 'The hosted checker is temporarily unavailable.' }, 503)
  }

  const declaredLength = Number(request.headers.get('content-length'))

  if (Number.isFinite(declaredLength) && declaredLength > 4_096) {
    return json({ error: 'The request is too large.' }, 413)
  }

  let body: unknown

  try {
    const rawBody = await request.text()

    if (new TextEncoder().encode(rawBody).byteLength > 4_096) {
      return json({ error: 'The request is too large.' }, 413)
    }

    body = JSON.parse(rawBody) as unknown
  } catch {
    return json({ error: 'Send a JSON object containing a URL.' }, 400)
  }

  const bodyRecord = body && typeof body === 'object' ? body as Readonly<Record<string, unknown>> : undefined
  const turnstileToken = bodyRecord?.turnstileToken
  const url = bodyRecord?.url

  if (typeof url !== 'string' || url.length > 2_048) {
    return json({ error: 'A valid URL is required.' }, 400)
  }

  if (typeof turnstileToken !== 'string' || turnstileToken.length === 0 || turnstileToken.length > 2_048) {
    return json({ error: 'Complete the human verification and try again.' }, 403)
  }

  try {
    if (!await verifyTurnstile(turnstileToken, request, env.TURNSTILE_SECRET_KEY)) {
      return json({ error: 'The human verification was rejected. Try again.' }, 403)
    }
  } catch {
    return json({ error: 'The hosted checker is temporarily unavailable.' }, 503)
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
