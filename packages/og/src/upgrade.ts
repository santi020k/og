import { access, glob, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

export interface UpgradeChange {
  file: string
  from: string
  to: string
}

export interface UpgradeResult {
  changes: readonly UpgradeChange[]
  packageManager: 'npm' | 'pnpm' | 'yarn'
  version: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const updatePackageManifest = (
  manifest: Record<string, unknown>,
  version: string,
  file: string
): UpgradeChange[] => {
  const changes: UpgradeChange[] = []

  for (const field of dependencyFields) {
    const dependencies = manifest[field]

    if (!isRecord(dependencies) || typeof dependencies['@santi020k/og'] !== 'string') continue

    const previous = dependencies['@santi020k/og']

    if (previous.startsWith('catalog:') || previous === version) continue

    dependencies['@santi020k/og'] = version

    changes.push({ file, from: previous, to: version })
  }

  return changes
}

const updateYamlCatalogs = (
  value: unknown,
  version: string,
  changes: UpgradeChange[]
): void => {
  if (Array.isArray(value)) {
    value.forEach(entry => {
      updateYamlCatalogs(entry, version, changes)
    })

    return
  }

  if (!isRecord(value)) return

  for (const [key, entry] of Object.entries(value)) {
    if (key === '@santi020k/og' && typeof entry === 'string') {
      if (entry === version) continue

      value[key] = version

      changes.push({ file: 'pnpm-workspace.yaml', from: entry, to: version })
    } else {
      updateYamlCatalogs(entry, version, changes)
    }
  }
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)

    return true
  } catch {
    return false
  }
}

const packageManager = async (
  manifest: Record<string, unknown>,
  root: string
): Promise<UpgradeResult['packageManager']> => {
  const configured = typeof manifest.packageManager === 'string' ? manifest.packageManager : ''

  if (configured.startsWith('pnpm@')) return 'pnpm'

  if (configured.startsWith('yarn@')) return 'yarn'

  if (await fileExists(path.join(root, 'pnpm-lock.yaml')) ||
    await fileExists(path.join(root, 'pnpm-workspace.yaml'))) return 'pnpm'

  if (await fileExists(path.join(root, 'yarn.lock'))) return 'yarn'

  return 'npm'
}

const workspacePatterns = (manifest: Record<string, unknown>): string[] => {
  const workspaces = manifest.workspaces

  if (Array.isArray(workspaces)) return workspaces.filter((value): value is string => typeof value === 'string')

  if (!isRecord(workspaces) || !Array.isArray(workspaces.packages)) return []

  return workspaces.packages.filter((value): value is string => typeof value === 'string')
}

const packagePattern = (pattern: string): string => {
  const normalized = pattern.replace(/^\.\//u, '').replace(/\/+$/u, '')

  if (!normalized || normalized === '.') return 'package.json'

  return normalized.endsWith('package.json') ? normalized : `${normalized}/package.json`
}

const discoverPackageManifests = async (
  root: string,
  patterns: readonly string[]
): Promise<string[]> => {
  const files = new Set(['package.json'])

  const excluded = patterns
    .filter(pattern => pattern.startsWith('!'))
    .map(pattern => packagePattern(pattern.slice(1)))

  for (const pattern of patterns.filter(candidate => !candidate.startsWith('!'))) {
    for await (const file of glob(packagePattern(pattern), {
      cwd: root,
      exclude: ['**/node_modules/**', ...excluded]
    })) {
      files.add(file.split(path.sep).join('/'))
    }
  }

  return [...files].sort((left, right) => {
    if (left === 'package.json') return -1

    if (right === 'package.json') return 1

    return left.localeCompare(right)
  })
}

export const upgradeProject = async (parameters: {
  root?: string
  version: string
}): Promise<UpgradeResult> => {
  const root = path.resolve(parameters.root ?? process.cwd())
  const packagePath = path.join(root, 'package.json')
  const manifest: unknown = JSON.parse(await readFile(packagePath, 'utf8'))

  if (!isRecord(manifest)) throw new TypeError(`${packagePath} must contain a JSON object.`)

  const manager = await packageManager(manifest, root)
  let pnpmWorkspace: Record<string, unknown> | undefined
  const patterns = workspacePatterns(manifest)

  if (manager === 'pnpm') {
    try {
      const parsed: unknown = parseYaml(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8'))

      if (isRecord(parsed)) {
        pnpmWorkspace = parsed

        if (Array.isArray(parsed.packages)) {
          patterns.push(...parsed.packages.filter((value): value is string => typeof value === 'string'))
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  const changes: UpgradeChange[] = []
  const packageFiles = await discoverPackageManifests(root, patterns)

  for (const relative of packageFiles) {
    const filePath = path.resolve(root, relative)
    const packageManifest: unknown = relative === 'package.json' ? manifest : JSON.parse(await readFile(filePath, 'utf8'))

    if (!isRecord(packageManifest)) throw new TypeError(`${filePath} must contain a JSON object.`)

    const manifestChanges = updatePackageManifest(packageManifest, parameters.version, relative)

    if (manifestChanges.length === 0) continue

    changes.push(...manifestChanges)

    await writeFile(filePath, `${JSON.stringify(packageManifest, null, 2)}\n`)
  }

  if (pnpmWorkspace) {
    const workspacePath = path.join(root, 'pnpm-workspace.yaml')

    updateYamlCatalogs(pnpmWorkspace.catalog, parameters.version, changes)

    updateYamlCatalogs(pnpmWorkspace.catalogs, parameters.version, changes)

    const excluded = pnpmWorkspace.minimumReleaseAgeExclude
    const packageFound = changes.length > 0

    if (packageFound && Array.isArray(excluded) && !excluded.includes('@santi020k/og')) {
      excluded.push('@santi020k/og')

      changes.push({ file: 'pnpm-workspace.yaml', from: '(not excluded)', to: '@santi020k/og' })
    } else if (packageFound && pnpmWorkspace.minimumReleaseAge !== undefined && excluded === undefined) {
      pnpmWorkspace.minimumReleaseAgeExclude = ['@santi020k/og']

      changes.push({ file: 'pnpm-workspace.yaml', from: '(not excluded)', to: '@santi020k/og' })
    }

    if (changes.some(change => change.file === 'pnpm-workspace.yaml')) {
      await writeFile(workspacePath, stringifyYaml(pnpmWorkspace, { lineWidth: 100 }))
    }
  }

  if (changes.length === 0) {
    throw new Error('No @santi020k/og dependency or pnpm catalog entry was found.')
  }

  return { changes, packageManager: manager, version: parameters.version }
}
