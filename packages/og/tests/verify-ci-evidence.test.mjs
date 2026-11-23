import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { findReleaseEvidence, isReleaseEvidence } from '../scripts/verify-ci-evidence.mjs'

const sha = 'a'.repeat(40)
const evidence = { id: 7, head_sha: sha, path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success' }
const response = (body, ok, status) => ({ ok, status, json: () => Promise.resolve(body) })
const respond = (body, ok = true, status = 200) => () => Promise.resolve(response(body, ok, status))

test('only a completed successful push run on main for the same commit is evidence', () => {
  assert.equal(isReleaseEvidence(evidence, sha), true)

  for (const override of [{ head_sha: 'b'.repeat(40) }, { event: 'pull_request' }, { event: 'workflow_dispatch' }, { head_branch: 'release/v1.2.2' }, { status: 'in_progress', conclusion: null }, { conclusion: 'failure' }, { conclusion: 'cancelled' }, { conclusion: 'skipped' }, { path: '.github/workflows/other.yml' }]) {
    assert.equal(isReleaseEvidence({ ...evidence, ...override }, sha), false, JSON.stringify(override))
  }

  for (const run of [null, undefined, 'success', {}]) assert.equal(isReleaseEvidence(run, sha), false)
})

test('the lookup filters API results and rejects incomplete input', async () => {
  const requests = []

  const request = (url, options) => {
    requests.push({ url, authorization: options.headers.authorization })

    return respond({ workflow_runs: [{ ...evidence, id: 1, conclusion: 'failure' }, { ...evidence, id: 2, head_sha: 'b'.repeat(40) }, evidence] })()
  }

  assert.equal((await findReleaseEvidence({ repository: 'santi020k/og', sha, token: 'token', request }))?.id, 7)

  assert.deepEqual(requests, [{ url: `https://api.github.com/repos/santi020k/og/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=100`, authorization: 'Bearer token' }])

  for (const body of [{ workflow_runs: [] }, { workflow_runs: [{ ...evidence, event: 'pull_request' }] }, {}, null]) {
    assert.equal(await findReleaseEvidence({ repository: 'santi020k/og', sha, token: 'token', request: respond(body) }), null)
  }

  const unreachable = () => assert.fail('incomplete input must not call the API')

  for (const input of [{ sha, token: 'token' }, { repository: 'santi020k/og', sha: 'main', token: 'token' }, { repository: 'santi020k/og', sha }, { repository: 'og?x=1', sha, token: 'token' }]) {
    assert.equal(await findReleaseEvidence({ ...input, request: unreachable }), null)
  }

  await assert.rejects(findReleaseEvidence({ repository: 'santi020k/og', sha, token: 'token', request: respond({}, false, 403) }), /403/u)
})

test('the command reports untrusted without failing when evidence cannot be confirmed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'og-ci-evidence-'))
  const output = join(cwd, 'output')
  const script = fileURLToPath(new URL('../scripts/verify-ci-evidence.mjs', import.meta.url))

  try {
    for (const env of [{}, { GITHUB_REPOSITORY: 'santi020k/og', GITHUB_SHA: 'not-a-sha', GITHUB_TOKEN: 'token' }]) {
      execFileSync(process.execPath, [script], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env }, stdio: 'pipe' })
    }

    assert.equal(readFileSync(output, 'utf8'), 'trusted=false\ntrusted=false\n')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('the release skips validation only for confirmed evidence', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')
  const condition = '        if: inputs.revalidate || steps.ci.outputs.trusted != \'true\'\n'

  assert.match(workflow, /\n {6}actions: read\n/u)

  assert.ok(workflow.includes(`      - name: Validate release candidate\n${condition}        run: pnpm run validate\n`))

  assert.ok(workflow.includes(`      - name: Test packed release candidate in consumers\n${condition}        run: pnpm run test:consumers\n`))

  assert.equal(workflow.split('steps.ci.outputs.trusted').length, 3)

  for (const step of ['Publish package', 'Verify published package', 'Test registry package in consumers']) {
    assert.doesNotMatch(workflow.split(`      - name: ${step}\n`)[1].split('      - name: ')[0], /\n {8}if:/u, step)
  }
})
