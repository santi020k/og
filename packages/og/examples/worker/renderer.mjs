import { createSharpRenderer } from '@santi020k/og/sharp'

export default createSharpRenderer({
  renderSvg: ({ title }, { height, width }) => `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="72" y="320" fill="#fff" font-family="Arial" font-size="72">${title}</text>
    </svg>
  `
})
