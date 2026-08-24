import { definePresetConfig } from '@santi020k/og/presets'

const examples = [
  {
    accent: '#65f6bd',
    badge: 'Open Graph',
    description: 'A useful default card with no consumer-owned renderer.',
    title: 'Start simple. Stay flexible.',
    variant: 'simple'
  },
  {
    accent: '#ff8a65',
    badge: 'Release notes',
    description: 'Turn Markdown and MDX frontmatter into polished social previews.',
    title: 'Open Graph images that follow your content.',
    variant: 'article'
  },
  {
    accent: '#65b8f6',
    badge: 'Documentation',
    description: 'Generate route-aware cards for guides, references, and component pages.',
    title: 'One config for every documentation route.',
    variant: 'docs'
  },
  {
    accent: '#b58cff',
    badge: 'Product',
    description: 'Brand, theme, and copy stay configurable in the consumer project.',
    image: {
      sha256: 'bdebe4c2b985444c881e16b890c380d9a4a4b0fc8ccb80814b6d1e45ab36bf91',
      type: 'image/png',
      url: 'https://raw.githubusercontent.com/santi020k/og/be0ffd1a4e17abe66ec7f1e28c375665fe3c6376/apps/web/public/icon-512.png'
    },
    title: 'Ship the card. Delete the renderer.',
    variant: 'product'
  }
]

export default definePresetConfig({
  cards: examples.map(example => ({
    aliases: example.variant === 'product' ? ['default.webp'] : undefined,
    data: example,
    output: `presets/${example.variant}.webp`
  })),
  clean: true,
  outputDirectory: 'public/og',
  preset: {
    brand: { domain: 'og.santi020k.com', name: '@santi020k/og' },
    remoteImages: { cacheDirectory: '.og-remote-cache' },
    theme: { background: '#07110e', foreground: '#eafff6', muted: '#9ab2a8', panel: '#11231d' }
  }
})
