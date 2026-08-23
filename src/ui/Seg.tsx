/* Picking one of a small set, in the two shapes the page needs. */

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef } from "react"
import { TextSwap } from "./Motion.tsx"
import { Tip } from "./Tip.tsx"

export interface SegOption<T extends string> {
  value: T
  /** The word for this option. */
  label: string
  /** Drawn instead of the word, for options a symbol says faster than a word does. */
  icon?: React.JSX.Element
  /** What picking this one means, on hover or on keyboard focus. */
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

  /** Write the pressed button's box onto the pill. */
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

  /* Before paint, so the pill is already under the pressed option on the frame it appears, and
     every later change is a slide. */
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

/** The same small set of options, for the controls a reader sets once and then leaves alone. */
export function Cycle<T extends string>({
  name,
  options,
  value,
  onPick,
}: {
  /** What the options choose, said in front of the current one's name. */
  name?: string
  options: ReadonlyArray<SegOption<T> & { tip: string }>
  value: T
  onPick: (v: T) => void
}): React.JSX.Element {
  const id = useId()
  /* Not `-1`: a value outside the options is a bug elsewhere, and starting from the first one
     leaves the control still able to walk to the rest. */
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
