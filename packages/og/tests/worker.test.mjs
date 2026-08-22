import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { defineWorkerRenderer, generate } from '../dist/index.js'
import { createSatoriWorkerRenderer } from '../dist/renderers/satori.js'

test('worker descriptors render cards through a bounded pool', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-worker-'))
  const rendererPath = path.join(root, 'renderer.mjs')
  const helperPath = path.join(root, 'helper.mjs')

  try {
    await writeFile(helperPath, 'export const suffix = ""\n')

    await writeFile(
      rendererPath,
      'import { suffix } from "./helper.mjs"\nexport default data => `<svg>${data.title}${suffix}</svg>`\n'
    )

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

    await writeFile(helperPath, 'export const suffix = "!"\n')

    const changed = await generate({
      cards: [{ data: { title: 'One' }, output: 'one.svg' }],
      renderer: defineWorkerRenderer({ module: rendererPath }),
      root
    })

    assert.deepEqual(changed.generated, ['one.svg'])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('Satori worker helper loads renderer options without a wrapper entry module', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-satori-worker-'))
  const optionsPath = path.join(root, 'satori-options.mjs')

  try {
    await writeFile(optionsPath, `export default {
  satori: { fonts: [] },
  template: () => ({
    type: 'div',
    props: {
      children: [],
      style: { display: 'flex', height: '100%', width: '100%' },
    },
  }),
}\n`)

    const result = await generate({
      cards: [{ data: { title: 'Worker' }, output: 'worker.svg' }],
      renderer: createSatoriWorkerRenderer({ module: optionsPath }),
      root
    })

    assert.deepEqual(result.generated, ['worker.svg'])

    assert.match(await readFile(path.join(root, 'public/og/worker.svg'), 'utf8'), /<svg/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
