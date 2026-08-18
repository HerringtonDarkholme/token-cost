/* Entry point. */

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { readHash, setState } from "./store.ts"
import { takeImport } from "./transfer.ts"

const host = document.getElementById("app")
if (!host) throw new Error("missing #app in the document")

/* Before the first render rather than in an effect inside it, because the page also *writes* the
   hash from an effect one component further down -- and effects run child first, so the write
   went out from the default state and cleared the link before the read of it ever happened.
   A report handed over by the CLI is lifted out first, for that same reason and one more: it is
   taken out of the address rather than left in it. */
takeImport()
setState(readHash(location.hash))

/* Both lines above run before this one, which is what puts the report out of reach of the
   `<Analytics>` inside the tree: it cannot mount until the render below, and by then the address
   no longer holds anything that came out of a transcript. */
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
