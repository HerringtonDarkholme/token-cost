/* The report face: the charts, the line items and the notes, none of which a page that has yet to
   be handed a bill has any use for. */

import { Breakdown, CardBody, Footnotes, scopeOf, Strip } from "./Report.tsx"
import { useNarrow } from "./store.ts"
import type { ReportFace } from "./faces.ts"

function Below(): React.JSX.Element {
  const narrow = useNarrow()
  return (
    <>
      <Breakdown />
      {/* Where the card's three figures go on a narrow window: reading them costs a line each, so they
                  wait until the reader has been through the picture and the line items. */}
      {narrow ? <Strip only="figures" /> : null}
      <Footnotes />
    </>
  )
}

export const face: ReportFace = { Body: CardBody, Below, scope: scopeOf }
