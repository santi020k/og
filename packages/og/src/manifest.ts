import { readFile, writeFile } from 'node:fs/promises'

export interface OgManifest {
  entries: Record<string, string>
  version: 1
}

export const emptyManifest = (): OgManifest => ({ entries: {}, version: 1 })

export const readManifest = async (manifestPath: string): Promise<OgManifest> => {
  try {
    const contents = await readFile(manifestPath, 'utf8')
    const parsed: unknown = JSON.parse(contents)

    if (
      typeof parsed === 'object' && parsed !== null &&
      'version' in parsed && parsed.version === 1 &&
      'entries' in parsed && typeof parsed.entries === 'object' && parsed.entries !== null
    ) {
      return { entries: parsed.entries as Record<string, string>, version: 1 }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  return emptyManifest()
}

export const writeManifest = async (manifestPath: string, manifest: OgManifest): Promise<void> => {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
