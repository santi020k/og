import { readFile, writeFile } from 'node:fs/promises'

export interface OgManifestEntry {
  baseDirectory?: string
  directory?: string
  digest?: string
  fingerprint: string
  output?: string
}

export interface OgManifest {
  cacheKey?: string
  entries: Record<string, OgManifestEntry>
  generatorVersion: string
  version: 3
}

export const emptyManifest = (generatorVersion: string, cacheKey?: string): OgManifest => ({
  ...(cacheKey ? { cacheKey } : {}),
  entries: {},
  generatorVersion,
  version: 3
})

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

export const readManifest = async (manifestPath: string): Promise<OgManifest> => {
  try {
    const contents = await readFile(manifestPath, 'utf8')
    const parsed: unknown = JSON.parse(contents)

    if (isRecord(parsed) && isRecord(parsed.entries)) {
      if (parsed.version === 3 && typeof parsed.generatorVersion === 'string') {
        return parsed as unknown as OgManifest
      }

      if (parsed.version === 1) {
        const entries = Object.fromEntries(
          Object.entries(parsed.entries)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([output, fingerprint]) => [output, { fingerprint }])
        )

        return { entries, generatorVersion: 'legacy', version: 3 }
      }

      if (parsed.version === 2) {
        return {
          entries: parsed.entries as Record<string, OgManifestEntry>,
          generatorVersion: 'legacy',
          version: 3
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  return emptyManifest('unknown')
}

export const writeManifest = async (manifestPath: string, manifest: OgManifest): Promise<void> => {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
