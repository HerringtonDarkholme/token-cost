/* Which language the page is in, and what that implies for numbers. */

/** The languages that ship. */
export type Lang = "en" | "zh" | "ja" | "es" | "fr" | "de"

/** What the picker calls each one: the subtag where the script is Latin, the language's own name
 *  where it is not. */
export const LANGS: ReadonlyArray<{ value: Lang; label: string; tag: string }> = [
  { value: "en", label: "EN", tag: "en-US" },
  { value: "zh", label: "中文", tag: "zh-CN" },
  { value: "ja", label: "日本語", tag: "ja-JP" },
  { value: "es", label: "ES", tag: "es-ES" },
  { value: "fr", label: "FR", tag: "fr-FR" },
  { value: "de", label: "DE", tag: "de-DE" },
]

const TAGS = Object.fromEntries(LANGS.map((l) => [l.value, l.tag])) as Record<Lang, string>

/** Whether a string names one of the six. */
export function isLang(v: string): v is Lang {
  return LANGS.some((l) => l.value === v)
}

/** The reader's language, from the browser's own ordered preference list. */
export function guessLang(): Lang {
  if (typeof document === "undefined" || typeof navigator === "undefined") return "en"
  const wanted = navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : []
  for (const w of wanted) {
    const base = w.toLowerCase().split("-")[0]
    if (isLang(base)) return base
  }
  return "en"
}

/** The guess, taken once. */
export const GUESSED: Lang = guessLang()

/* the mirror ---------- `state.lang` is the single source of truth and every component reads it
   through the store, which is what makes a change re-render the page. */

let current: Lang = GUESSED

/** Called by `setState` when the language changes. */
export function noteLang(l: Lang): void {
  current = l
}

/** The BCP-47 tag the number formatters should be using right now. */
export function tag(): string {
  return TAGS[current]
}

/** The language they are being written in. */
export function lang(): Lang {
  return current
}

export function tagOf(l: Lang): string {
  return TAGS[l]
}
