/* The three transition primitives the page composes: a panel that slides into the region
   another one left, a figure that re-enters character by character, and a line of copy that
   swaps for a different line.

   They live together because they are the same kind of thing -- a small component whose whole
   job is to make a change visible -- and because all three read their timing off the
   stylesheet rather than carrying a number of their own. The CSS is where the motion is
   tuned; a duration written twice is a duration that drifts. */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"

/** A duration from the stylesheet, in milliseconds. `parseFloat` is enough because every
 *  duration on the scale is written in `ms`. */
export function cssMs(name: string, fallback: number): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name)
  return parseFloat(value) || fallback
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

/** How long a digit pop-in runs, read off the stylesheet so the two cannot drift: the last
 *  two characters ride one and two stagger offsets behind the rest of the figure. */
function popMs(): number {
  return cssMs("--digit-dur", 500) + cssMs("--digit-stagger", 70) * 2 + 40
}

/** A figure that re-enters character by character when it changes. Switching the TTL lens,
 *  covering the amount and arriving at a bill at all put a different number in the same place,
 *  and a number that changes without moving is a number the reader can miss.
 *
 *  The group is keyed on a beat rather than mutated in place: a remount is what replays a CSS
 *  animation, which is the same thing the reference's remove-reflow-re-add dance buys. The
 *  beat drops back to 0 when the animation is over, which is what takes `.is-animating` off
 *  again -- the PNG rasterises this markup in a fresh document, where a live animation would
 *  be caught at its first frame with the digits still invisible. */
export function PopNumber({
  value,
  className,
}: {
  value: string
  className?: string
}): React.JSX.Element {
  const [beat, setBeat] = useState(0)
  const shown = useRef(value)

  useEffect(() => {
    if (shown.current === value) return
    shown.current = value
    setBeat((n) => n + 1)
    const t = setTimeout(() => setBeat(0), popMs())
    return () => clearTimeout(t)
  }, [value])

  const chars = [...value]
  return (
    <span
      key={beat}
      className={`t-digit-group${beat ? " is-animating" : ""}${className ? " " + className : ""}`}
    >
      {/* Keyed by position on purpose, which is the one case an index key is the right key:
          these are the columns of a figure, not a list of things. "$1,204.55" becoming
          "$989.10" should re-letter the spans that are already there rather than match
          characters up by name, and the stagger below is a position too. */}
      {/* oxlint-disable react/no-array-index-key -- see above. A block rather than a
          `disable-next-line`, because the line the key sits on is oxfmt's to choose. */}
      {chars.map((ch, i) => (
        <span
          key={i}
          className="t-digit"
          data-stagger={i === chars.length - 2 ? 1 : i === chars.length - 1 ? 2 : undefined}
        >
          {ch}
        </span>
      ))}
      {/* oxlint-enable react/no-array-index-key */}
    </span>
  )
}

/** How long the label's exit leg runs, read off the stylesheet so the swap's three phases
 *  stay in step with the CSS that draws them. */
function swapMs(): number {
  return cssMs("--text-swap-dur", 150)
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
 */
export function TextSwap({
  token,
  children,
}: {
  token: string
  children: ReactNode
}): React.JSX.Element {
  const el = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState<{ token: string; body: ReactNode }>({ token, body: children })
  const [phase, setPhase] = useState<"" | "exit" | "enter">("")

  /* Read through a ref rather than a dependency: the children are a new element on every
     render of the parent, and a dependency on them would restart the exit leg mid-flight. */
  const latest = useRef(children)
  latest.current = children

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
