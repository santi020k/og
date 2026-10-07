import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { encodeSvg } from '@santi020k/og/sharp'

const root = fileURLToPath(new URL('..', import.meta.url))
const publicDirectory = path.join(root, 'public')
const svg = await readFile(path.join(publicDirectory, 'icon.svg'), 'utf8')

for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const outputPath = path.join(publicDirectory, file)
  const image = await encodeSvg(svg, { format: 'png', height: size, outputPath, root, width: size })

  await writeFile(outputPath, image)
}
