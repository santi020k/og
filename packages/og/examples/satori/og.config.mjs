import { readFile } from 'node:fs/promises'

import { defineConfig } from '@santi020k/og'
import { createSatoriRenderer, html } from '@santi020k/og/satori'

const regular = await readFile(new URL('./Inter-Regular.ttf', import.meta.url))

export default defineConfig({
  cards: [{ data: { title: 'A Satori card' }, output: 'index.png' }],
  cache: { sources: ['examples/satori/Inter-Regular.ttf'] },
  renderer: createSatoriRenderer({
    satori: { fonts: [{ data: regular, name: 'Inter', weight: 400 }] },
    template: ({ title }) => html`
      <div style="display:flex;width:100%;height:100%;background:#111827;color:#fff;padding:72px;font:72px Inter">
        ${title}
      </div>
    `
  })
})
