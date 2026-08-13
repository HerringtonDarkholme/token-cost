/* The segmented control, wherever the page offers a small set of mutually exclusive lenses.

   Four of these existed as hand-written spans of buttons, each flipping its own background
   on `aria-pressed`. They are one component now because the pressed state is no longer a
   property of the button: it is a single pill that travels between them, and a travelling
   pill needs one owner that knows where the options are.

   The position is measured, not computed. The options are words -- "Panels", "Sunburst",
   "1h" -- of different widths, and one control's are glyphs, so the pill's left edge and
   width come from the button that is actually pressed rather than from a fraction of the bar.

   `aria-pressed` rather than the `aria-selected` the transition's reference markup uses:
   these are buttons, not tabs, and `aria-selected` on a button that is not in a tablist is
   announced as nothing. The pill is decoration over the top of that, and says so.

   An option is an object rather than a `[value, label]` pair because two of these controls
   ask for more than a word. The theme switch draws glyphs, where the word becomes the
   button's accessible name instead of its face, and the abbreviated options carry a hint --
   see `Tip`. The rest still pass a label and nothing else. */

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef } from "react"
import { Tip } from "./Tip.tsx"

export interface SegOption<T extends string> {
  value: T
  /** The word for this option. Drawn in the button, unless `icon` takes its place -- then it
   *  is the button's accessible name rather than its face. */
  label: string
  /** Drawn instead of the word, for options a symbol says faster than a word does. */
  icon?: React.JSX.Element
  /** What picking this one means, on hover or on keyboard focus. */
  tip?: string
}

export function Seg<T extends string>({
  label,
  hint,
  options,
  value,
  onPick,
  nosnap,
}: {
  /** Names what the options choose, said once instead of once per button. */
  label?: string
  /** What the control as a whole is, hung off that label. */
  hint?: string
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
      {label ? <span className="seglbl t-tt-trigger">{label}</span> : null}
      {label && hint ? <Tip>{hint}</Tip> : null}
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
