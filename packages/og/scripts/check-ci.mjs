import { execFileSync } from 'node:child_process'

import { planScope } from './ci-scope.mjs'

const plan = planScope({
  base: process.env.CI_BASE_SHA,
  head: process.env.CI_HEAD_SHA || 'HEAD',
  full: process.argv.includes('--full')
})

const run = args => execFileSync('pnpm', args, { stdio: 'inherit' })

process.stdout.write(`CI scope: ${JSON.stringify(plan)}\n`)

execFileSync(process.execPath, ['--test', 'packages/og/tests/ci-scope.test.mjs'], { stdio: 'inherit' })

run(['audit', '--audit-level', 'moderate'])

if (plan.mode === 'full') {
  run(['run', 'validate'])
} else {
  run(['run', 'lint:spell'])

  run(['exec', 'turbo', 'run', 'ci:web', '--filter=@santi020k/og-web'])
}
