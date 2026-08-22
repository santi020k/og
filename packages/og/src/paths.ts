import path from 'node:path'

import type { OgFormat } from './types.js'

const formats = new Set<OgFormat>(['avif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])

export const resolveInside = (base: string, requested: string, label: string): string => {
  if (!requested.trim()) throw new Error(`${label} cannot be empty.`)

  const resolved = path.resolve(base, requested)
  const relative = path.relative(base, resolved)

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside ${base}: ${requested}`)
  }

  return resolved
}

export const getFormat = (output: string): OgFormat => {
  const extension = path.extname(output).slice(1).toLowerCase()

  if (!formats.has(extension as OgFormat)) {
    throw new Error(
      `Unsupported output extension for ${output}. Use .svg, .png, .webp, .jpg, .jpeg, or .avif.`
    )
  }

  return extension as OgFormat
}
