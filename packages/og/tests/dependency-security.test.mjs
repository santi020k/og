import assert from 'node:assert/strict'
import test from 'node:test'

import { ESLint } from 'eslint'

import configuration from '../eslint.config.js'

test('shared import boundaries retain patched matcher behavior', async () => {
  const entry = (await configuration).find(config => config.plugins?.import)

  assert.ok(entry)

  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      plugins: { 'import-x': entry.plugins.import },
      rules: { 'import-x/no-internal-modules': ['error', { forbid: ['**/internal/**'] }] }
    }]
  })

  const denied = await eslint.lintText('import value from "./internal/secret.js"', { filePath: 'fixture.js' })
  const allowed = await eslint.lintText('import value from "./public.js"', { filePath: 'fixture.js' })

  assert.equal(denied[0].messages.length, 1)

  assert.equal(denied[0].messages[0].ruleId, 'import-x/no-internal-modules')

  assert.equal(allowed[0].messages.length, 0)
})
