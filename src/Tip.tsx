/* The hint that says what a control does, for the controls whose whole label is a symbol or an
   abbreviation -- the eye over the dollars, the TTL lens, the three theme glyphs. */

/** One hint, placed immediately after the element it describes. */
export function Tip({
  id,
  children,
}: {
  id?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="t-tt" id={id} role="tooltip">
      {children}
    </span>
  )
}
