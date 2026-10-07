/** @type {import('@santi020k/og/audit').AuditRule} */
export const hostedCanonicalRule = ({ page, siteUrl }) => {
  if (!page.indexable || !page.canonical || !siteUrl) return []
  const expected = new URL(page.route, siteUrl).href
  if (page.canonical === expected) return []
  return [{
    code: 'hosted-canonical-mismatch',
    file: page.file,
    message: `Cloudflare directory route requires canonical ${expected}.`,
    route: page.route,
    severity: 'error'
  }]
}
