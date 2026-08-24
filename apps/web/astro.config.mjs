import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

const site = process.env.PUBLIC_SITE_URL ?? 'https://og.santi020k.com'

export default defineConfig({
  integrations: [sitemap()],
  server: {
    host: '127.0.0.1',
    port: 4321
  },
  site,
  trailingSlash: 'never',
  vite: {
    server: {
      strictPort: false
    }
  }
})
