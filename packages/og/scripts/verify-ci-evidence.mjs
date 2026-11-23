import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const workflowPath = '.github/workflows/ci.yml'

/**
 * A push run on main always executes the complete gate on Node.js 22 and 24 plus the packed
 * consumers. Pull request runs may use the website-only selection, so they are never evidence.
 */
export const isReleaseEvidence = (run, sha) => Boolean(run) && typeof run === 'object' &&
  run.head_sha === sha && run.path === workflowPath && run.event === 'push' && run.head_branch === 'main' &&
  run.status === 'completed' && run.conclusion === 'success'

export const findReleaseEvidence = async ({ repository, sha, token, request = fetch }) => {
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository ?? '') || !/^[0-9a-f]{40}$/u.test(sha ?? '') || !token) return null

  const url = `https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=100`

  const response = await request(url, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' }
  })

  if (!response.ok) throw new Error(`GitHub returned ${response.status} for the CI runs of ${sha}`)

  const body = await response.json()
  const runs = Array.isArray(body?.workflow_runs) ? body.workflow_runs : []

  return runs.find(run => isReleaseEvidence(run, sha)) ?? null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let trusted = false

  // Any uncertainty keeps release validation on; this step never fails the release by itself.
  try {
    const { GITHUB_REPOSITORY: repository, GITHUB_SHA: sha, GITHUB_TOKEN: token } = process.env
    const run = await findReleaseEvidence({ repository, sha, token })

    trusted = run !== null

    process.stdout.write(trusted ? `CI run ${run.id} (attempt ${run.run_attempt}) succeeded for ${process.env.GITHUB_SHA}: ${run.html_url}\n` : 'No successful CI push run on main was found for this commit; the release validates it again.\n')
  } catch (error) {
    process.stdout.write(`Could not confirm CI for this commit (${error instanceof Error ? error.message : 'unknown error'}); the release validates it again.\n`)
  }

  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `trusted=${trusted}\n`)
}
