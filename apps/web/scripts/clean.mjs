import { rm } from 'node:fs/promises'

await Promise.all([
  rm(new URL('../.astro', import.meta.url), { force: true, recursive: true }),
  rm(new URL('../dist', import.meta.url), { force: true, recursive: true }),
  rm(new URL('../public/og', import.meta.url), { force: true, recursive: true })
])
