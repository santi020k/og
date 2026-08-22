import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const

interface UpgradeChange {
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

const updatePackageManifest = (manifest: Record<string, unknown>, version: string): UpgradeChange[] => {
  const changes: UpgradeChange[] = []

  for (const field of dependencyFields) {
    const dependencies = manifest[field]

    if (!isRecord(dependencies) || typeof dependencies['@santi020k/og'] !== 'string') continue

    const previous = dependencies['@santi020k/og']

    if (previous.startsWith('catalog:')) continue

    dependencies['@santi020k/og'] = version

    changes.push({ file: 'package.json', from: previous, to: version })
  }

  return changes
}

const updateYamlCatalogs = (value: unknown, version: string, changes: UpgradeChange[]): void => {
  if (Array.isArray(value)) {
    value.forEach(entry => {
      updateYamlCatalogs(entry, version, changes)
    })

    return
  }

  if (!isRecord(value)) return

  for (const [key, entry] of Object.entries(value)) {
    if (key === '@santi020k/og' && typeof entry === 'string') {
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

export const upgradeProject = async (parameters: {
  root?: string
  version: string
}): Promise<UpgradeResult> => {
  const root = path.resolve(parameters.root ?? process.cwd())
  const packagePath = path.join(root, 'package.json')
  const manifest: unknown = JSON.parse(await readFile(packagePath, 'utf8'))

  if (!isRecord(manifest)) throw new TypeError(`${packagePath} must contain a JSON object.`)

  const changes = updatePackageManifest(manifest, parameters.version)
  const manager = await packageManager(manifest, root)

  if (changes.length > 0) await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)

  if (manager === 'pnpm') {
    const workspacePath = path.join(root, 'pnpm-workspace.yaml')

    try {
      const workspace: unknown = parseYaml(await readFile(workspacePath, 'utf8'))

      if (isRecord(workspace)) {
        updateYamlCatalogs(workspace.catalog, parameters.version, changes)

        updateYamlCatalogs(workspace.catalogs, parameters.version, changes)

        const excluded = workspace.minimumReleaseAgeExclude
        const packageFound = changes.length > 0

        if (packageFound && Array.isArray(excluded) && !excluded.includes('@santi020k/og')) {
          excluded.push('@santi020k/og')

          changes.push({ file: 'pnpm-workspace.yaml', from: '(not excluded)', to: '@santi020k/og' })
        } else if (packageFound && workspace.minimumReleaseAge !== undefined && excluded === undefined) {
          workspace.minimumReleaseAgeExclude = ['@santi020k/og']

          changes.push({ file: 'pnpm-workspace.yaml', from: '(not excluded)', to: '@santi020k/og' })
        }

        if (changes.some(change => change.file === 'pnpm-workspace.yaml')) {
          await writeFile(workspacePath, stringifyYaml(workspace, { lineWidth: 100 }))
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  if (changes.length === 0) {
    throw new Error('No @santi020k/og dependency or pnpm catalog entry was found.')
  }

  return { changes, packageManager: manager, version: parameters.version }
}
