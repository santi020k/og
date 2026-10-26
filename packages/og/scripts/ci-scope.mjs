import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const gitEnvironment = (environment = process.env) => Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('GIT_')))

export const classifyPaths = paths => {
  const website = path => /^apps\/web\/(src|public|functions|tests)\//u.test(path)
  const affected = paths.length > 0 && paths.every(website)

  return { mode: affected ? 'affected' : 'full', web: true, package: !affected }
}

const fullEvent = env => Boolean(env.GITHUB_EVENT_NAME && env.GITHUB_EVENT_NAME !== 'pull_request') ||
  /^(release\/|changeset-release\/)/u.test(env.GITHUB_HEAD_REF ?? '')

const readPaths = ({ cwd, base, head, env }) => {
  const git = args => execFileSync('git', args, {
    cwd, env: gitEnvironment(env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  })

  const revision = ref => git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim()
  const commands = [['diff', '--no-renames', '--name-only', '-z', `${revision(base)}...${revision(head)}`]]

  if (head === 'HEAD') commands.push(
    ['diff', '--no-renames', '--name-only', '-z', '--cached'],
    ['diff', '--no-renames', '--name-only', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z']
  )

  return [...new Set(commands.flatMap(args => git(args).split('\0').filter(Boolean)))]
}

export const planScope = ({ cwd = process.cwd(), base, head = 'HEAD', full = false, env = process.env } = {}) => {
  if (full || !base || fullEvent(env)) return classifyPaths([])

  try {
    return classifyPaths(readPaths({ cwd, base, head, env }))
  } catch {
    return classifyPaths([])
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = planScope({ base: process.env.CI_BASE_SHA, head: process.env.CI_HEAD_SHA || 'HEAD', full: process.argv.includes('--full') })

  process.stdout.write(`${JSON.stringify(plan)}\n`)

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}`).join('\n') + '\n')
  }
}
