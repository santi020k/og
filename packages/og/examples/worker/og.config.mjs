import { defineConfig, defineWorkerRenderer } from '@santi020k/og'

export default defineConfig({
  cards: Array.from({ length: 100 }, (_, index) => ({
    data: { index, title: `Card ${index + 1}` },
    output: `card-${index + 1}.webp`
  })),
  concurrency: 'auto',
  renderer: defineWorkerRenderer({
    module: new URL('./renderer.mjs', import.meta.url)
  })
})
