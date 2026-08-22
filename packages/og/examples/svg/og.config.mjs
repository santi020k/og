import { defineConfig } from '@santi020k/og'
import { createSharpRenderer } from '@santi020k/og/sharp'

const escapeXml = value => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

export default defineConfig({
  cards: [
    { data: { eyebrow: 'Documentation', title: 'Build a better interface' }, output: 'docs.webp' },
    { data: { eyebrow: 'Components', title: 'Accessible by default' }, output: 'components.webp' }
  ],
  renderer: createSharpRenderer({
    renderSvg: ({ eyebrow, title }, { height, width }) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="#0f172a"/>
        <text x="72" y="160" fill="#a78bfa" font-family="Arial" font-size="28">${escapeXml(eyebrow)}</text>
        <text x="72" y="300" fill="#fff" font-family="Arial" font-size="72" font-weight="700">${escapeXml(title)}</text>
      </svg>
    `
  })
})
