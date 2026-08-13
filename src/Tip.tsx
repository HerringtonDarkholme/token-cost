/* The hint that says what a control does, for the controls whose whole label is a symbol or
   an abbreviation -- the eye over the dollars, the TTL lens, the three theme glyphs. A word
   like "Panels" needs no gloss; "$", "1h" and a crescent moon do.

   A sibling of its trigger rather than a wrapper around it, which is the one departure from
   the transition's reference markup. The wrap there exists so the pointer can drift onto the
   tooltip, which this does not need -- the hint never takes the pointer. What the flat shape
   buys is that a segmented control stays a row of buttons: the travelling pill measures its
   options against the bar, and a wrap around each button would put a second positioning
   context between them.

   Hover shows it, and so does keyboard focus on the trigger. `aria-describedby` is the
   caller's job: the hint carries an id and the button points at it, so the same words a
   pointer gets are the words a screen reader reads out -- rather than the hint being a
   picture only the sighted reader can see. */

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
