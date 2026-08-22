export const mapConcurrent = async <T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>
): Promise<U[]> => {
  const results = new Array<U>(values.length)
  let nextIndex = 0

  const run = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex
      const value = values[currentIndex]

      nextIndex += 1

      if (value !== undefined) results[currentIndex] = await mapper(value)
    }
  }

  const runnerCount = Math.min(concurrency, values.length)

  await Promise.all(Array.from({ length: runnerCount }, run))

  return results
}
