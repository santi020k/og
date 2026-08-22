import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const notScalar = Symbol('not-scalar')

const canonicalizeScalar = (value: unknown): string | typeof notScalar => {
  if (value === null) return 'null'

  if (typeof value === 'bigint') return JSON.stringify(`${value.toString()}n`)

  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (typeof value === 'undefined') return 'undefined'

  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`Cannot fingerprint ${typeof value} values. Use serializable card data.`)
  }

  return notScalar
}

const canonicalize = (value: unknown, seen: Set<object>): string => {
  const scalar = canonicalizeScalar(value)

  if (scalar !== notScalar) return scalar

  if (typeof value !== 'object' || value === null) throw new TypeError('Unsupported cache value.')

  if (seen.has(value)) throw new TypeError('Cannot fingerprint circular card data.')

  seen.add(value)

  try {
    if (Array.isArray(value)) {
      return `[${value.map(item => canonicalize(item, seen)).join(',')}]`
    }

    if (value instanceof Date) return JSON.stringify(value.toISOString())

    if (value instanceof Uint8Array) {
      return JSON.stringify(Buffer.from(value).toString('base64'))
    }

    const record = value as Record<string, unknown>

    const entries = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalize(record[key], seen)}`)

    return `{${entries.join(',')}}`
  } finally {
    seen.delete(value)
  }
}

export const stableStringify = (value: unknown): string => canonicalize(value, new Set())

export const hashValues = async (
  values: readonly unknown[],
  sourcePaths: readonly string[]
): Promise<string> => {
  const hash = createHash('sha256')

  for (const value of values) {
    hash.update(stableStringify(value))

    hash.update('\0')
  }

  for (const sourcePath of [...new Set(sourcePaths)].sort()) {
    hash.update(sourcePath)

    hash.update('\0')

    hash.update(await readFile(sourcePath))

    hash.update('\0')
  }

  return hash.digest('hex')
}
