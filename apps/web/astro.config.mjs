import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

const site = process.env.PUBLIC_SITE_URL ?? 'https://og.santi020k.com'

export default defineConfig({
  integrations: [sitemap()],
  site,
  trailingSlash: 'never'
})
