import { createPathCards } from '@santi020k/og'
import { definePresetConfig } from '@santi020k/og/presets'

export default definePresetConfig({
  cards: createPathCards([
    {
      data: {
        badge: 'Home',
        description: 'A complete Open Graph card without a consumer-owned renderer.',
        title: 'Reusable social images',
        variant: 'product'
      },
      pathname: '/'
    },
    {
      data: {
        badge: 'Guide',
        description: 'Preset cards still keep product copy and routes in the consumer.',
        title: 'Getting started',
        variant: 'docs'
      },
      pathname: '/docs/getting-started'
    }
  ]),
  clean: true,
  outputDirectory: 'public/og',
  preset: {
    brand: { domain: 'example.com', name: 'Example' },
    theme: { accent: '#7c3aed' }
  }
})
