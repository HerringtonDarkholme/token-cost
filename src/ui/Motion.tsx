/* The three transition primitives the page composes: a panel that slides in, a figure that rolls
   to its new number, and a line of copy that swaps for another. */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { flushSync } from "react-dom"
import NumberFlow, { useIsSupported, type Format } from "@number-flow/react"
import { tagOf } from "../core/i18n.ts"
import { useViewState } from "./store.ts"

/** A custom property off the document root, or `fallback` where the stylesheet has not loaded --
 *  which is every test run, since the suites mount into a bare DOM. */
export function cssVal(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** A duration from the stylesheet, in milliseconds. */
export function cssMs(name: string, fallback: number): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name)
  return parseFloat(value) || fallback
}

const STILL = "(prefers-reduced-motion: reduce)"

/** Motion the reader asked not to see. */
export function reduced(): boolean {
  return typeof matchMedia === "function" && matchMedia(STILL).matches
}

function subscribeReduced(fn: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {}
  const list = matchMedia(STILL)
  list.addEventListener("change", fn)
  return () => list.removeEventListener("change", fn)
}

/** The same answer, subscribed: the stylesheet re-answers the query when the reader changes the
 *  setting, and anything deciding in JS has to be told. */
export function useReduced(): boolean {
  return useSyncExternalStore(subscribeReduced, reduced, reduced)
}

/** Whether a state change can be made as a view transition at all: the browser has the API, and
 *  the reader has not asked for stillness. */
export function canTransition(): boolean {
  return typeof document.startViewTransition === "function" && !reduced()
}

/** Run `swap` as a view transition, with `mark` stamped on the document root for exactly as long
 *  as it lasts. */
export function transition(swap: () => void, mark: Record<string, string>): void {
  const start = document.startViewTransition
  if (typeof start !== "function" || reduced()) {
    swap()
    return
  }
  const root = document.documentElement
  for (const [name, value] of Object.entries(mark)) root.setAttribute(name, value)
  const run = start.call(document, () => {
    capturing = true
    try {
      flushSync(swap)
    } finally {
      capturing = false
    }
  })
  void run.finished
    .catch(() => {})
    .then(() => Object.keys(mark).forEach((name) => root.removeAttribute(name)))
}

/** Whether the DOM is being rewritten inside a capture at this moment. */
let capturing = false
export function isCapturing(): boolean {
  return capturing
}

/** A stable name for one thing across a transition, from whatever the rest of the page already
 *  calls it. */
export function vtName(key: string): React.CSSProperties {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0
  return { "--vt": "v" + (h >>> 0).toString(36) } as React.CSSProperties
}

/** The panel a swapped-in view arrives in. */
export function Reveal({
  className,
  closed,
  children,
}: {
  className?: string
  closed?: boolean
  children: ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div
      className={className ? `${className} t-panel-slide` : "t-panel-slide"}
      data-open={open && !closed ? "true" : "false"}
      data-leaving={closed ? "1" : undefined}
    >
      {children}
    </div>
  )
}

/** The bill's own format, stated once. */
const MONEY: Format = {
  style: "currency",
  currency: "USD",
  /* Both halves of that agreement, including this one: without it the digits would roll under a
     `US$` in Chinese while `money()` printed a bare `$` beside them. */
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}

/* A share is written the same way in every language here -- a dot and a bare `%` -- so the rolling
   one is pinned to match rather than localised. */
const SHARE: Format = { minimumFractionDigits: 1, maximumFractionDigits: 1 }
const SHARE_FINE: Format = { minimumFractionDigits: 2, maximumFractionDigits: 2 }

/** The bill, as a figure that travels between the numbers rather than cutting between them. */
export function Figure({
  value,
  text,
  className,
  share,
}: {
  value: number | null
  text: string
  className?: string
  /** The figure is a share of the bill rather than an amount of it -- what the hub reads out
   *  once the dollars are covered. */
  share?: boolean
}): React.JSX.Element {
  const supported = useIsSupported()
  const { lang } = useViewState()
  const still = useReduced()
  if (value === null || !supported || still) {
    return <span className={className}>{text}</span>
  }
  return (
    <span className={className} data-snaptext={text}>
      {share ? (
        <NumberFlow value={value} locales="en" format={value < 1 ? SHARE_FINE : SHARE} suffix="%" />
      ) : (
        /* The locale as well as the format, because both halves of the agreement with `money()` are
           locale-dependent. Handed the tag rather than left to the reader's machine. */
        <NumberFlow value={value} locales={tagOf(lang)} format={MONEY} />
      )}
    </span>
  )
}

/** A number that is being counted up to, sampled rather than delivered. */
export function useCountingUp(source: React.RefObject<number>, watch: boolean): number {
  const [seen, setSeen] = useState(0)
  useEffect(() => {
    if (!watch) return
    source.current = 0
    setSeen(0)
    const id = setInterval(() => setSeen(source.current), cssMs("--figure-beat", 160))
    return () => clearInterval(id)
  }, [watch, source])
  return seen
}

/** How long the label's exit leg runs, read off the stylesheet so the swap's three phases stay
 *  in step with the CSS that draws them. */
function swapMs(): number {
  return cssMs("--text-swap-dur", 150)
}

/** Copy that crossfades: the arriving line fades up while the departing one is still fading out,
 *  rather than after it. */
export function TextCross({
  token,
  inline,
  children,
}: {
  token: string
  inline?: boolean
  children: ReactNode
}): React.JSX.Element {
  const { lang } = useViewState()
  const [shown, setShown] = useState<{ token: string; body: ReactNode }>({ token, body: children })
  const [gone, setGone] = useState<{ token: string; body: ReactNode } | null>(null)

  /* A language change rewrites the words without moving any caller's token, and that is a
     replacement rather than a crossfade -- see `TextSwap` below, which explains why. */
  const drawn = useRef(lang)
  if (drawn.current !== lang) {
    drawn.current = lang
    setShown({ token: shown.token, body: children })
    setGone(null)
  }

  /* During the render, so the new words are in the commit: nothing is held back here, which is
     also what makes this safe inside a capture without the check `TextSwap` needs. */
  if (token !== shown.token) {
    setGone(shown)
    setShown({ token, body: children })
  }

  useEffect(() => {
    if (!gone) return
    const t = setTimeout(() => setGone(null), swapMs())
    return () => clearTimeout(t)
  }, [gone])

  /* Measured on every commit rather than keyed on the token, because what has to travel is the
     layout*: the box can be resized by copy that never changed. */
  const box = useRef<HTMLSpanElement>(null)
  const wide = useRef<number | null>(null)
  useLayoutEffect(() => {
    const node = box.current
    if (!inline || !node) return
    const now = node.getBoundingClientRect().width
    const was = wide.current
    wide.current = now
    if (was === null || Math.abs(was - now) < 0.5 || reduced()) return
    node.animate([{ width: `${was}px` }, { width: `${now}px` }], {
      duration: swapMs(),
      easing: cssVal("--text-swap-ease", "ease-in-out"),
    })
  })

  return (
    <span ref={box} className="t-text-cross" data-inline={inline ? 1 : undefined}>
      {/* `data-nosnap` because the PNG freezes every animation, and a ghost held at full
          strength would print both lines on top of each other. */}
      {gone ? (
        <span key={gone.token} className="leg" data-gone="1" data-nosnap>
          {gone.body}
        </span>
      ) : null}
      <span key={shown.token} className="leg">
        {shown.body}
      </span>
    </span>
  )
}

/** Copy that says what just happened -- "Copy chart" becoming "Rendering…" in the same eight
 *  millimetres of toolbar -- so the words are swapped rather than replaced: the old leave upward
 *  through a blur, the new arrive from below. */
export function TextSwap({
  token,
  children,
}: {
  token: string
  children: ReactNode
}): React.JSX.Element {
  const el = useRef<HTMLSpanElement>(null)
  const { lang } = useViewState()
  const [shown, setShown] = useState<{ token: string; body: ReactNode }>({ token, body: children })
  const [phase, setPhase] = useState<"" | "exit" | "enter">("")

  /* Read through a ref rather than a dependency: the children are a new element on every render
     of the parent, and a dependency on them would restart the exit leg mid-flight. */
  const latest = useRef(children)
  latest.current = children

  /* The language, in the same place and for the same reason as the token above: during the render,
     so the words are the new words in the commit. */
  const drawn = useRef(lang)
  if (drawn.current !== lang) {
    drawn.current = lang
    /* Only when nothing is in flight. */
    if (token === shown.token) setShown({ token, body: latest.current })
  }

  /* Inside a capture the words have to be the new words before the swap callback returns, or the
     heading is photographed unchanged and morphs into itself. */
  if (isCapturing() && token !== shown.token) {
    setShown({ token, body: children })
    setPhase("")
  }

  useEffect(() => {
    if (token === shown.token) return
    setPhase("exit")
    const t = setTimeout(() => {
      setShown({ token, body: latest.current })
      setPhase("enter")
    }, swapMs())
    return () => clearTimeout(t)
  }, [token, shown.token])

  /* `is-enter-start` puts the new copy below its resting place with the transition suspended, so it
     needs the reflow before the class comes off again. */
  useLayoutEffect(() => {
    if (phase !== "enter") return
    void el.current?.offsetHeight
    setPhase("")
  }, [phase])

  return (
    <span
      ref={el}
      className={
        `t-text-swap${phase === "exit" ? " is-exit" : ""}` +
        `${phase === "enter" ? " is-enter-start" : ""}`
      }
    >
      {shown.body}
    </span>
  )
}

/** How long a slot stands before the next one takes its place. */
function holdMs(): number {
  return cssMs("--word-cycle-hold", 2200)
}

/** How long the strip takes to travel its one line, read off the stylesheet so the face that has
 *  gone is dropped on the frame the CSS is done with it. */
function reelMs(): number {
  return cssMs("--reel-dur", 320)
}

/** One of the things a cycling slot says. */
export interface Slot {
  /** The word it stands for, said plainly: what the still list is written from. */
  word: string
  /** What the cycle shows instead, where the slot is more than its word. */
  body?: ReactNode
}

/** One slot in a sentence, refilled over and over: the slot is a window a line high, and what is
 *  in it is one strip -- the next thing rises into the window as the last is cut off leaving it. */
export function WordCycle({ slots }: { slots: readonly Slot[] }): React.JSX.Element {
  const { lang } = useViewState()
  const still = useReduced()
  const [at, setAt] = useState(0)
  const [gone, setGone] = useState<number | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  const sizer = useRef<HTMLSpanElement>(null)
  const [wide, setWide] = useState<readonly number[] | null>(null)

  const rolling = !still && slots.length > 1

  /* Every slot measured off to the side, rather than the arriving one measured as it lands: the
     window starts for its next width as the strip starts to travel, and it cannot ask for a width
     it is not already carrying. */
  useLayoutEffect(() => {
    const node = sizer.current
    if (!node) return
    const read = (): void => {
      const now = Array.from(node.children, (c) => c.getBoundingClientRect().width)
      setWide((was) => {
        if (!now.length || now.some((w) => w <= 0)) return was
        const same =
          was && was.length === now.length && was.every((w, i) => Math.abs(w - now[i]) < 0.5)
        return same ? was : now
      })
    }
    read()
    if (typeof ResizeObserver !== "function") return
    /* The webfont lands after the first measure and moves every width. */
    const ro = new ResizeObserver(read)
    ro.observe(node)
    return () => ro.disconnect()
  }, [slots, lang])

  useEffect(() => {
    if (!rolling) return
    if (gone !== null) {
      const t = setTimeout(() => setGone(null), reelMs())
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setGone(at)
      setAt((n) => (n + 1) % slots.length)
    }, holdMs())
    return () => clearTimeout(t)
  }, [gone, at, rolling, slots.length])

  /* Nothing cycles for a reader who asked for stillness, and one name left standing would read as
     the only one the page takes -- so that reader is given the list the cycle stands for, in
     words, since the long form of a slot is only legible one at a time. */
  if (still) {
    const words = slots.map((s) => s.word)
    return <>{new Intl.ListFormat(tagOf(lang), { type: "disjunction" }).format(words)}</>
  }

  const face = (i: number): ReactNode => slots[i].body ?? slots[i].word

  return (
    <span ref={box} className="t-word-cycle" style={wide ? { width: `${wide[at]}px` } : undefined}>
      {/* Keyed by what it carries, because the strip has to be a new element to be given the
          travel again -- the same one with new words in it would arrive already home. */}
      <span className="t-reel" key={at}>
        {gone === null ? null : (
          <span className="face" data-gone="1">
            {face(gone)}
          </span>
        )}
        <span className="face">{face(at)}</span>
      </span>
      <span ref={sizer} className="sizer" aria-hidden="true">
        {slots.map((s) => (
          <span key={s.word}>{s.body ?? s.word}</span>
        ))}
      </span>
    </span>
  )
}
