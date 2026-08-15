/* Picking one of a small set, in the two shapes the page needs.

   `Seg` lays the options out and marks the one in force -- for a lens the reader moves
   between, where seeing the alternative is half of knowing where you are. `Cycle`, below,
   shows only the option in force and walks to the next when pressed -- for a preference,
   where the alternatives are width spent on a decision already made. Which one a control
   wants is a question about the control, not about the number of options: the chart switch
   has two and is a `Seg`; the TTL switch has two and is a `Cycle`.

   Four of the first existed as hand-written spans of buttons, each flipping its own
   background on `aria-pressed`. They are one component now because the pressed state is no
   longer a property of the button: it is a single pill that travels between them, and a
   travelling pill needs one owner that knows where the options are.

   The position is measured, not computed. The options are words -- "Panels", "Sunburst" --
   of different widths, so the pill's left edge and width come from the button that is
   actually pressed rather than from a fraction of the bar.

   `aria-pressed` rather than the `aria-selected` the transition's reference markup uses:
   these are buttons, not tabs, and `aria-selected` on a button that is not in a tablist is
   announced as nothing. The pill is decoration over the top of that, and says so.

   An option is an object rather than a `[value, label]` pair because not every control asks
   for only a word. The theme switch draws glyphs, where the word becomes the button's
   accessible name instead of its face, and the abbreviated options carry a hint -- see
   `Tip`. The rest still pass a label and nothing else. */

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef } from "react"
import { TextSwap } from "./Motion.tsx"
import { Tip } from "./Tip.tsx"

export interface SegOption<T extends string> {
  value: T
  /** The word for this option. Drawn in the button, unless `icon` takes its place -- then it
   *  is the button's accessible name rather than its face. */
  label: string
  /** Drawn instead of the word, for options a symbol says faster than a word does. */
  icon?: React.JSX.Element
  /** What picking this one means, on hover or on keyboard focus. In a `Cycle`, where the
   *  option is already the current one by the time its hint can be read, what pressing does
   *  from here -- which is why that control requires it and this one does not. */
  tip?: string
}

export function Seg<T extends string>({
  options,
  value,
  onPick,
  nosnap,
}: {
  options: ReadonlyArray<SegOption<T>>
  value: T
  onPick: (v: T) => void
  /** Keep this control out of the PNG, for the ones that sit inside the card. */
  nosnap?: boolean
}): React.JSX.Element {
  const bar = useRef<HTMLSpanElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  const settled = useRef(false)
  /* One prefix per instance, so two controls on the page cannot mint the same hint id. */
  const uid = useId()

  /** Write the pressed button's box onto the pill. `animate` false suspends the transition
   *  and forces a reflow, so first paint and resize snap into place instead of sliding in
   *  from `translateX(0)` at zero width. */
  const place = useCallback((animate: boolean): void => {
    const el = pill.current,
      host = bar.current
    if (!el || !host) return
    const on = host.querySelector<HTMLElement>('button[aria-pressed="true"]')
    if (!on) return

    const prev = el.style.transition
    if (!animate) el.style.transition = "none"
    el.style.transform = `translateX(${on.offsetLeft}px)`
    el.style.width = `${on.offsetWidth}px`
    if (!animate) {
      void el.offsetWidth
      el.style.transition = prev
    }
  }, [])

  /* Before paint, so the pill is already under the pressed option on the frame it appears,
     and every later change is a slide. */
  useLayoutEffect(() => {
    place(settled.current)
    settled.current = true
  }, [place, value, options])

  useEffect(() => {
    const onResize = (): void => place(false)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [place])

  return (
    <span className="seg t-tabs" ref={bar} data-nosnap={nosnap ? "" : undefined}>
      <span className="t-tabs-pill" aria-hidden="true" ref={pill} />
      {options.map((o) => (
        <Fragment key={o.value}>
          <button
            type="button"
            className="t-tab t-tt-trigger"
            data-icon={o.icon ? "" : undefined}
            aria-pressed={o.value === value}
            aria-label={o.icon ? o.label : undefined}
            aria-describedby={o.tip ? uid + o.value : undefined}
            onClick={() => onPick(o.value)}
          >
            {o.icon ?? o.label}
          </button>
          {o.tip ? <Tip id={uid + o.value}>{o.tip}</Tip> : null}
        </Fragment>
      ))}
    </span>
  )
}

/** The same small set of options, for the controls a reader sets once and then leaves alone.
 *
 *  A segmented control spends its width on the options nobody is choosing: three theme buttons
 *  standing there to say one thing, two TTL buttons where one of them is always the answer.
 *  That is the right trade where the options are a lens the reader moves between -- panels and
 *  sunburst, the table and the chart -- and the wrong one for a preference. So these show the
 *  option that is current and walk to the next when pressed, which is the shape the platform
 *  switch in the intake already uses; see `OsSwitch`.
 *
 *  No `aria-pressed` here, and that is the point rather than an omission. Pressed is a claim
 *  about a button that has siblings to be pressed instead of it, and one button that cycles
 *  has none -- announced as "pressed" it would be a toggle with no off. The state lives in
 *  the accessible *name* instead ("Light theme"), and what pressing does next lives in the
 *  hint, which `aria-describedby` has read out as well as drawn. Which is why the hint is
 *  required here and optional on the control above: it is carrying the other half of the
 *  control, not decorating it. */
export function Cycle<T extends string>({
  name,
  options,
  value,
  onPick,
}: {
  /** What the options choose, said in front of the current one's name. Left out where the
   *  names already say it -- "Light theme" does not need "Theme:" in front of it. */
  name?: string
  options: ReadonlyArray<SegOption<T> & { tip: string }>
  value: T
  onPick: (v: T) => void
}): React.JSX.Element {
  const id = useId()
  /* Not `-1`: a value outside the options is a bug elsewhere, and starting from the first
     one leaves the control still able to walk to the rest. */
  const at = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const cur = options[at]
  const next = options[(at + 1) % options.length]

  return (
    <span className="seg t-tt-host">
      <button
        type="button"
        className="cycbtn t-tt-trigger"
        data-icon={cur.icon ? "" : undefined}
        aria-label={name ? `${name}: ${cur.label}` : cur.label}
        aria-describedby={id}
        onClick={() => onPick(next.value)}
      >
        {/* The face is held for the length of its own exit, so what leaves is the option that
            was current rather than the one just picked -- the same swap the platform chip
            uses, for the same reason: one fact changing, not two things arguing. */}
        <TextSwap token={value}>
          <span className="cycface">{cur.icon ?? cur.label}</span>
        </TextSwap>
      </button>
      <Tip id={id}>{cur.tip}</Tip>
    </span>
  )
}
