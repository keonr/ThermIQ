export function latestAt<T>(items: readonly T[], timestamp: (item: T) => number, playhead: number): T | undefined {
  let lower = 0
  let upper = items.length
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (timestamp(items[middle]) <= playhead) lower = middle + 1
    else upper = middle
  }
  return items[lower - 1]
}
