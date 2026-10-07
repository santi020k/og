import { defineAuditConfig } from '@santi020k/og/audit/config'
import { standardAuditRules } from '@santi020k/og/audit/rules'
import { siteUrl } from './site.mjs'
import { hostedCanonicalRule } from './scripts/hosted-canonical.mjs'

export default defineAuditConfig({
  directory: 'dist',
  manifest: 'public/og/manifest.json',
  siteUrl,
  requireUniqueImages: true,
  rules: [hostedCanonicalRule],
  ...standardAuditRules({
    sitemap: { reportOrphans: true },
    robots: {
      requiredDirectives: [{ name: 'Allow', value: '/' }],
      expectedSitemaps: [new URL('/sitemap-index.xml', siteUrl).href]
    }
  })
})
