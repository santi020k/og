import { defineConfig } from '@santi020k/og'
import { createSharpRenderer } from '@santi020k/og/sharp'

const escapeXml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

export default defineConfig({
  cache: { sources: ['public/icon.svg'] },
  cards: [{
    data: {
      description: 'Deterministic social images. Your data, design, and renderer.',
      title: 'Open Graph images, without the framework lock-in.'
    },
    output: 'default.webp'
  }],
  clean: true,
  outputDirectory: 'public/og',
  renderer: createSharpRenderer({
    renderSvg: ({ description, title }, { height, width }) => `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop stop-color="#07110e"/>
            <stop offset="1" stop-color="#10231d"/>
          </linearGradient>
          <radialGradient id="glow" cx="78%" cy="0%" r="75%">
            <stop stop-color="#65f6bd" stop-opacity=".26"/>
            <stop offset="1" stop-color="#65f6bd" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="${width}" height="${height}" rx="42" fill="url(#bg)"/>
        <rect width="${width}" height="${height}" rx="42" fill="url(#glow)"/>
        <g transform="translate(72 68)">
          <rect width="72" height="72" rx="20" fill="#65f6bd"/>
          <path d="M21 24h30v11H32v17H21V24Zm30 24H37V37h14v11Z" fill="#07110e"/>
        </g>
        <text x="164" y="116" fill="#eafff6" font-size="31" font-family="Arial, sans-serif" font-weight="700">@santi020k/og</text>
        <text x="72" y="270" fill="#f4fff9" font-size="62" font-family="Arial, sans-serif" font-weight="700">
          <tspan x="72" dy="0">${escapeXml(title.slice(0, 31))}</tspan>
          <tspan x="72" dy="76">${escapeXml(title.slice(31))}</tspan>
        </text>
        <text x="72" y="500" fill="#a9c6ba" font-size="28" font-family="Arial, sans-serif">${escapeXml(description)}</text>
        <path d="M72 554h1056" stroke="#29483c"/>
        <text x="72" y="590" fill="#65f6bd" font-size="22" font-family="monospace">npm i -D @santi020k/og</text>
      </svg>`,
    webp: { quality: 88 }
  })
})
