import { readFile, writeFile } from 'node:fs/promises'

export interface OgManifestEntry {
  baseDirectory?: string
  directory?: string
  digest?: string
  fingerprint: string
  output?: string
}

export interface OgManifest {
  entries: Record<string, OgManifestEntry>
  version: 2
}

export const emptyManifest = (): OgManifest => ({ entries: {}, version: 2 })

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

export const readManifest = async (manifestPath: string): Promise<OgManifest> => {
  try {
    const contents = await readFile(manifestPath, 'utf8')
    const parsed: unknown = JSON.parse(contents)

    if (isRecord(parsed) && isRecord(parsed.entries)) {
      if (parsed.version === 2) return parsed as unknown as OgManifest

      if (parsed.version === 1) {
        const entries = Object.fromEntries(
          Object.entries(parsed.entries)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([output, fingerprint]) => [output, { fingerprint }])
        )

        return { entries, version: 2 }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  return emptyManifest()
}

export const writeManifest = async (manifestPath: string, manifest: OgManifest): Promise<void> => {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
