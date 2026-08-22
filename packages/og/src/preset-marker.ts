const presetRenderers = new WeakSet<object>()

export const markPresetRenderer = <T extends object>(renderer: T): T => {
  presetRenderers.add(renderer)

  return renderer
}

export const isPresetRenderer = (renderer: unknown): boolean => (
  typeof renderer === 'function' && presetRenderers.has(renderer)
)
