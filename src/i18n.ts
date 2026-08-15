/* Which language the page is in, and what that implies for numbers.

   This file is deliberately the small half of the job: a language tag, the list of the ones
   that ship, a guess at the reader's, and the number format that follows from it. The words
   themselves are next door in `copy.tsx`, which is where the size is -- keeping the two apart
   is what lets `model.ts` ask for a locale without pulling six dictionaries and a React import
   into a file that runs under plain `node`.

   Nothing here imports the store, and the store imports only `guessLang` and the type. That
   is the whole reason the direction of these imports is worth stating: `lang` lives in the
   view state like the theme does, so a shared link carries it, and a view-state module that
   imported a dictionary to know its own initial value would be a cycle. */

/** The languages that ship. English is the source: every other dictionary is typed against
 *  it, so a key added here cannot be forgotten there. */
export type Lang = "en" | "zh" | "ja" | "es" | "fr" | "de"

/** Each language named in itself. A picker that says "Chinese" is a picker for people who
 *  already read English -- which is the one group that does not need it. */
export const LANGS: ReadonlyArray<{ value: Lang; label: string; tag: string }> = [
  { value: "en", label: "English", tag: "en-US" },
  { value: "zh", label: "简体中文", tag: "zh-CN" },
  { value: "ja", label: "日本語", tag: "ja-JP" },
  { value: "es", label: "Español", tag: "es-ES" },
  { value: "fr", label: "Français", tag: "fr-FR" },
  { value: "de", label: "Deutsch", tag: "de-DE" },
]

const TAGS = Object.fromEntries(LANGS.map((l) => [l.value, l.tag])) as Record<Lang, string>

/** Whether a string names one of the six. Used by the hash reader, which takes whatever the
 *  address bar happens to hold. */
export function isLang(v: string): v is Lang {
  return LANGS.some((l) => l.value === v)
}

/** The reader's language, from the browser's own ordered preference list.
 *
 *  Matched on the primary subtag alone, so `de-AT` and `fr-CA` land on their language rather
 *  than falling through to English for want of an exact tag. The one place that is a real
 *  loss is `zh-Hant`: only Simplified ships, and a Traditional reader gets it. That is a
 *  worse fit than English for some of them, which is exactly why the switch is in the toolbar
 *  rather than the guess being the last word.
 *
 *  Guarded on `document` rather than on `navigator`, because Node has had a `navigator` with
 *  a `language` on it since v24 -- so the two suites that run as plain `node` scripts would
 *  otherwise pick up the machine's locale and assert against a dictionary nobody chose. In a
 *  browser both are present; in those scripts neither guess nor switcher exists, and English
 *  is the right constant. */
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

/** The guess, taken once. Both the view state's initial value and the mirror below start
 *  here, and they have to start at the same place. */
export const GUESSED: Lang = guessLang()

/* ---------- the mirror ----------
   `state.lang` is the single source of truth and every component reads it through the store,
   which is what makes a change re-render the page. The two number formatters cannot: they are
   plain functions in `model.ts`, called from inside JSX by name, and threading a language
   through fifteen call sites would put a fact about the toolbar into the arithmetic.

   So the store writes the current language here on every change, and they read it back. One
   variable, no listeners, and no way for it to disagree with the state -- `setState` is the
   only writer. */

let current: Lang = GUESSED

/** Called by `setState` when the language changes. Not for anyone else. */
export function noteLang(l: Lang): void {
  current = l
}

/** The BCP-47 tag the number formatters should be using right now. */
export function tag(): string {
  return TAGS[current]
}

/** The language they are being written in. Read by the share captions, which are assembled on
 *  a click rather than in a render and so have no store subscription to read from. */
export function lang(): Lang {
  return current
}

export function tagOf(l: Lang): string {
  return TAGS[l]
}
