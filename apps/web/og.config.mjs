import { definePresetConfig } from '@santi020k/og/presets'

const examples = [
  {
    accent: '#b48df7',
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
    image: 'public/icon-512.png',
    imagePresentation: { fit: 'contain', padding: 72 },
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
  cache: { sources: ['public/icon.svg', 'public/icon-512.png'] },
  clean: true,
  outputDirectory: 'public/og',
  preset: {
    brand: { domain: 'og.santi020k.com', logo: 'public/icon.svg', name: '@santi020k/og' },
    remoteImages: { cacheDirectory: '.og-remote-cache' },
    theme: { background: '#110c1d', foreground: '#dfdde3', muted: '#b6b2bd', panel: '#1c1528' }
  }
})
