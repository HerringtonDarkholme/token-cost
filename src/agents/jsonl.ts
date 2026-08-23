/* What every reader here needs before it can read anything: a store runs to gigabytes, so both of
   these look at a file without building one. */

/** Walked by index rather than `split("\n")`: a store is hundreds of megabytes, and the split
 *  builds every line before the first one is read. */
export function* lines(text: string): Generator<string> {
  for (let i = 0, n = text.length; i < n;) {
    let end = text.indexOf("\n", i)
    if (end === -1) end = n
    let from = i
    i = end + 1
    while (from < end && text.charCodeAt(from) <= 32) from++
    if (from === end) continue
    yield text.slice(from, end)
  }
}

/** The first value a pattern finds in the front of a file, for the agents that name their session
 *  in a field the walk needs before it parses anything. */
export function firstString(text: string, re: RegExp): string | null {
  const m = re.exec(text)
  return m && m[1] ? m[1] : null
}
