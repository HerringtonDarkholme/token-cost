/* Entry point. */

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./ui/App.tsx"
import { loadFace } from "./ui/faces.ts"
import { readHash, setState } from "./ui/store.ts"
import { landing, pendingImport, takeImport } from "./ui/transfer.ts"

const host = document.getElementById("app")
if (!host) throw new Error("missing #app in the document")

/* Before the first render rather than in an effect inside it, because the page also *writes* the
   hash from an effect one component further down -- and effects run child first, so the write
   went out from the default state and cleared the link before the read of it ever happened.
   A report handed over by the CLI is lifted out first, for that same reason and one more: it is
   taken out of the address rather than left in it. */
takeImport(landing(location.pathname))
setState(readHash(location.hash))

/* Started here rather than left to the effect in `Page` that would otherwise ask for it, so the
   face is on the wire while the first render is still going out -- one round trip instead of two.
   Which one it is, is the whole of what `/open` buys: a report in the address needs the charts,
   and nothing else needs the transcript walk. */
void loadFace(pendingImport() ? "report" : "intake")

/* Both lines above run before this one, which is what puts the report out of reach of the
   `<Analytics>` inside the tree: it cannot mount until the render below, and by then the address
   no longer holds anything that came out of a transcript. */
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
