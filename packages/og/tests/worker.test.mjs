import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { defineWorkerRenderer, generate } from '../dist/index.js'

test('worker descriptors render cards through a bounded pool', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-worker-'))
  const rendererPath = path.join(root, 'renderer.mjs')

  try {
    await writeFile(rendererPath, 'export default data => `<svg>${data.title}</svg>`\n')

    const result = await generate({
      cards: [
        { data: { title: 'One' }, output: 'one.svg' },
        { data: { title: 'Two' }, output: 'two.svg' }
      ],
      concurrency: 2,
      renderer: defineWorkerRenderer({ module: rendererPath }),
      root
    })

    assert.deepEqual(result.generated, ['one.svg', 'two.svg'])

    assert.equal(await readFile(path.join(root, 'public/og/two.svg'), 'utf8'), '<svg>Two</svg>')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
