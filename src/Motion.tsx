/* The three transition primitives the page composes: a panel that slides into the region
   another one left, a figure that rolls from the number it was to the number it is, and a line
   of copy that swaps for a different line.

   They live together because they are the same kind of thing -- a small component whose whole
   job is to make a change visible -- and because they read their timing off the stylesheet
   rather than carrying a number of their own. The CSS is where the motion is tuned; a duration
   written twice is a duration that drifts. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { flushSync } from "react-dom"
import NumberFlow, { useIsSupported, type Format } from "@number-flow/react"
import { tagOf } from "./i18n.ts"
import { useViewState } from "./store.ts"

/** A custom property off the document root, or `fallback` where the stylesheet has not
 *  loaded -- which is every test run, since the suites mount into a bare DOM. */
export function cssVal(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** A duration from the stylesheet, in milliseconds. `parseFloat` is enough because every
 *  duration on the scale is written in `ms`. */
export function cssMs(name: string, fallback: number): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name)
  return parseFloat(value) || fallback
}

/** Motion the reader asked not to see. Asked each time rather than once, because the setting
 *  can change under a page that is already open. */
export function reduced(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Whether a state change can be made as a view transition at all: the browser has the API,
 *  and the reader has not asked for stillness. Asked separately from `transition` below
 *  because a caller with a fallback has to choose the path *before* it takes the first step
 *  of either -- the turn scrolls the page differently depending on whether what happens next
 *  is a snapshot or a live exit. */
export function canTransition(): boolean {
  return typeof document.startViewTransition === "function" && !reduced()
}

/** Run `swap` as a view transition, with `mark` stamped on the document root for exactly as
 *  long as it lasts.
 *
 *  The mark is how the stylesheet knows which transition this is. The pseudo-elements are
 *  children of the root's own tree rather than of anything the component rendered, so a class
 *  on the shell cannot reach them -- and a page with two different transitions in it needs to
 *  be able to say which rules belong to which. It is also what switches on the
 *  `view-transition-name`s themselves: a name is a promise that the element is worth
 *  capturing separately, and forty rows making that promise during a transition that is not
 *  about them would be forty things lifted out of a picture they belong in.
 *
 *  `flushSync`, because the callback has to leave the DOM in its new state by the time it
 *  returns: an update React was free to batch until later would be captured as the *old*
 *  screen, and the transition would cross-fade two identical pictures.
 *
 *  Where there is no transition to be had, `swap` still runs -- just on its own, immediately.
 */
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

/** Whether the DOM is being rewritten inside a capture at this moment.
 *
 *  Set for the length of the swap callback and read by `TextSwap`, which otherwise holds the
 *  copy it is showing for the length of its own exit. A component that defers like that is a
 *  component photographed still saying the old thing, so the words below commit at once while
 *  this is true. */
let capturing = false
export function isCapturing(): boolean {
  return capturing
}

/** A stable name for one thing across a transition, from whatever the rest of the page
 *  already calls it.
 *
 *  Handed to the element as a custom property rather than as `view-transition-name` itself,
 *  because the name has to be switchable from the stylesheet: see `transition` above, and
 *  `:root[data-filter]` below it. A custom property costs nothing to carry when nothing is
 *  reading it, while a name is a stacking context and a separately-captured layer on every
 *  row of the table for the whole life of the page.
 *
 *  Hashed because the keys are line-item names -- "Tools · content read in›acme…" -- and a
 *  `view-transition-name` is a CSS ident, which those are not. The letter in front is what
 *  keeps a name that starts with a digit legal. */
export function vtName(key: string): React.CSSProperties {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0
  return { "--vt": "v" + (h >>> 0).toString(36) } as React.CSSProperties
}

/** The panel a swapped-in view arrives in. Mounted closed and opened on the next frame,
 *  because the open state needs a painted closed state to travel from; keyed from outside on
 *  whatever picked the view, so a switch mounts a fresh panel rather than reopening this one.
 *
 *  `closed` is the other half, and the one that makes a *departure* possible: a keyed remount
 *  gives the arriving panel somewhere to travel from, but the panel it replaces is gone on the
 *  same tick with nothing left to animate. Held open by its owner for the length of the exit,
 *  a panel asked to close plays one -- and travels the other way, since a view leaving forward
 *  and a view leaving backward do not go the same place. See `--panel-exit-y`.
 *
 *  `className` is for the callers whose panel has to carry layout as well -- the chart sits in
 *  a flex column and has to keep filling it.
 */
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

/** The bill's own format, stated once. `money()` in `model.ts` produces the same string from
 *  the same options; this is the machine-readable half of that agreement, because NumberFlow
 *  is handed the number and the format rather than the text.
 *
 *  `Format` rather than `Intl.NumberFormatOptions`: the component narrows the options to the
 *  ones it can take apart into digits, and an engineering notation is not one of them. */
const MONEY: Format = {
  style: "currency",
  currency: "USD",
  /* Both halves of that agreement, including this one: without it the digits would roll under
     a `US$` in Chinese while `money()` printed a bare `$` beside them. */
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}

/** The bill, as a figure that travels between the numbers rather than cutting between them.
 *
 *  Switching the TTL lens moves the total by a few percent, and a few percent is exactly the
 *  size of change a reader misses when it lands in one frame. Rolling the digits that actually
 *  changed -- which is what NumberFlow does, digit by digit and against the real width of each
 *  one -- says *which* part of the figure moved as well as that it moved, and says it in the
 *  place the reader is already looking.
 *
 *  `value` is null for the two states that are not a number: the dash standing in for a bill
 *  that has not been calculated, and the asterisks covering one that is being hidden on a
 *  shared screen. Both are text in a plain span, because there is nothing to interpolate
 *  between "—" and "$1,204.55" -- and because a masked figure that rolled its digits would be
 *  animating the thing it is there to withhold.
 *
 *  So is anything at all, when the browser cannot run the animation or the reader has asked not
 *  to see one. The digits are timed through the Web Animations API against measured character
 *  widths, and where that is missing the component renders markup that is a scaffold for a
 *  figure rather than a figure -- so `useIsSupported` decides whether it is asked at all. The
 *  reduced-motion half is this page's own question rather than the component's, because the
 *  answer has to be the one the rest of the stylesheet is giving.
 *
 *  `data-snaptext` carries that same text for the PNG, a document the digits cannot reach:
 *  the snapshot serialises this markup as XML into a foreignObject, where the custom element is
 *  undefined and its shadow root did not come along. Written here rather than read back off the
 *  component, because what the component puts in the light DOM is its business. */
export function Figure({
  value,
  text,
  className,
}: {
  value: number | null
  text: string
  className?: string
}): React.JSX.Element {
  const supported = useIsSupported()
  const { lang } = useViewState()
  if (value === null || !supported || reduced()) {
    return <span className={className}>{text}</span>
  }
  return (
    <span className={className} data-snaptext={text}>
      {/* The locale as well as the format, because the two halves of the agreement with
          `money()` are both locale-dependent: where the grouping separators fall and which
          side the symbol sits on. Handed the tag rather than left to the browser's own
          default, which is the reader's machine and not the page's language. */}
      <NumberFlow value={value} locales={tagOf(lang)} format={MONEY} />
    </span>
  )
}

/** A number that is being counted up to, sampled rather than delivered.
 *
 *  The figure above rolls between values over a few hundred milliseconds, so it has an opinion
 *  about how often it may be given a new one -- and that opinion is nobody else's business. The
 *  producer here is a folder being read: it writes its running total into `source` the moment it
 *  has one, per file, at whatever rate the disk and the parse happen to go. Handing that rate
 *  straight to the digits is what made the figure thrash, and fixing it inside the reading loop
 *  put a fact about an animation in the middle of a file walk. So the walk publishes and this
 *  watches, on the beat the stylesheet keeps beside the mask widths.
 *
 *  A ref rather than a value, because the point is that the producer does not re-render anything
 *  when it moves: the box is written to hundreds of times and read six times a second, and the
 *  reads that find it unchanged cost nothing -- React drops a `setState` to the number it
 *  already has.
 *
 *  `watch` is what turns it on, and going true is also what zeroes the box: a second folder
 *  starts its count where the first one started rather than at the bill the first one reached. */
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

/** How long the label's exit leg runs, read off the stylesheet so the swap's three phases
 *  stay in step with the CSS that draws them. */
function swapMs(): number {
  return cssMs("--text-swap-dur", 150)
}

/** Copy that crossfades: the arriving line fades up while the departing one is still fading
 *  out, rather than after it.
 *
 *  `TextSwap` below is the other shape -- exit, *then* enter -- and the empty beat between its
 *  legs is part of what it says: something happened, and the slot was cleared for the news.
 *  Under a pointer that beat is just a hole, punched into the readout on every arc the cursor
 *  crosses. So the legs overlap here, at the price of both lines being on screen at once.
 *
 *  Animations rather than transitions, since a transition needs a painted starting state and a
 *  line that has only just mounted has never been painted. The `key` is what runs them.
 *
 *  `inline` is for a crossfade with a sentence around it -- the share in "2.7% of the bill",
 *  which is the only part of that line with any news in it. The words after it are the same
 *  words either way, so they should travel to where the new figure leaves them rather than
 *  cutting there, and the way to carry them is to interpolate the box: the ghost is out of
 *  flow, so the box would otherwise snap to the arriving figure's width in one frame. */
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
     *layout*, and the box can be resized by copy that never changed -- a font arriving, the
     card being dragged narrower. Read before paint and animated from the width it had, so the
     line beside it is pushed across the gap over the same beat the figure fades in. */
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

/** Copy that says what just happened -- "Copy chart" becoming "Rendering…" becoming "Chart
 *  copied" in the same eight millimetres of toolbar, or the page's own heading changing tense
 *  when the bill arrives -- so the words are swapped rather than replaced: the old ones leave
 *  upward through a blur and the new ones arrive from below.
 *
 *  The reference drives this by writing `textContent`; here the phase is React state, so the
 *  words React renders change on the same beat as the class that moves them, and the new
 *  label can be a fragment with a mark or an emphasis in it rather than a string.
 *
 *  `token` is what identifies the copy, because the copy itself is fresh JSX every render.
 *
 *  Which leaves one thing the caller cannot be trusted to remember: every word inside here is
 *  translated, and a language change rewrites all of it without moving any caller's token. Held
 *  copy would then be *stale* copy -- the heading stayed in English while the eyebrow beside it
 *  turned, because only the heading was inside one of these. So the language is read here and
 *  folded in, rather than being a fifth thing each call site has to append to its token and a
 *  fifth chance to forget.
 *
 *  It is folded in as a *refresh* rather than as part of the token, though, and the difference
 *  is the motion. The swap says "these words now mean something else" -- the bill arrived, the
 *  render finished. A reader who just picked their own language out of a menu has not been told
 *  anything by four fragments of the page leaving upward through a blur at once; they know what
 *  they changed. So the words are replaced where they stand, and the phases are left for the
 *  changes the reader did not make.
 */
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

  /* Read through a ref rather than a dependency: the children are a new element on every
     render of the parent, and a dependency on them would restart the exit leg mid-flight. */
  const latest = useRef(children)
  latest.current = children

  /* The language, in the same place and for the same reason as the token above: during the
     render, because the words have to be the new words in the commit rather than one frame
     after it. Held to the previous value in a ref so this fires once per change and not on
     every render -- and it deliberately leaves `phase` alone, so a swap already mid-flight when
     the language changes finishes its exit and arrives carrying the new words. */
  const drawn = useRef(lang)
  if (drawn.current !== lang) {
    drawn.current = lang
    /* Only when nothing is in flight. Mid-swap the children are already the *arriving* copy,
       so writing them into the departing body would show the new words during the old words'
       exit -- and there is no need to: the timer below reads `latest` when it fires, by which
       point that is the new copy in the new language. */
    if (token === shown.token) setShown({ token, body: latest.current })
  }

  /* Inside a capture the words have to be the new words before the swap callback returns: the
     browser photographs the DOM as it stands, and copy held back for its own exit is copy
     photographed unchanged -- the heading would morph into itself. So the three phases below
     are the fallback path's, and here the change lands in a single render with the motion
     left to the browser. Updated during the render rather than from an effect, because an
     effect runs after the commit the capture has already read. */
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

  /* `is-enter-start` puts the new copy below its resting place with the transition suspended,
     so it needs the reflow before the class comes off again -- that read is what makes the
     return a transition rather than a second jump. Same single task as the reference's
     `void el.offsetHeight`, since a layout effect commits before paint. */
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
