import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

const site = process.env.PUBLIC_SITE_URL ?? 'https://og.santi020k.com'
const turnstileTestSecret = '1x0000000000000000000000000000000AA'

const checkerApiDev = () => ({
  configureServer(server) {
    server.middlewares.use('/api/check', async (incoming, outgoing) => {
      const chunks = []

      for await (const chunk of incoming) chunks.push(chunk)

      const host = incoming.headers.host ?? 'localhost'
      const request = new Request(`http://${host}/api/check`, {
        body: incoming.method === 'GET' || incoming.method === 'HEAD' ? undefined : Buffer.concat(chunks),
        headers: incoming.headers,
        method: incoming.method
      })
      const checker = await server.ssrLoadModule('/functions/api/check.ts')
      const response = incoming.method === 'POST'
        ? await checker.onRequestPost({
            env: { TURNSTILE_SECRET_KEY: turnstileTestSecret },
            request
          })
        : checker.onRequest()

      outgoing.statusCode = response.status
      response.headers.forEach((value, name) => outgoing.setHeader(name, value))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    })
  },
  name: 'checker-api-dev'
})

export default defineConfig({
  integrations: [sitemap()],
  server: {
    host: '127.0.0.1',
    port: 4321
  },
  site,
  trailingSlash: 'never',
  vite: {
    plugins: [checkerApiDev()],
    server: {
      strictPort: false
    }
  }
})
