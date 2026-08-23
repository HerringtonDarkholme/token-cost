/* Entry point. */

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./ui/App.tsx"
import { loadFace } from "./ui/faces.ts"
import { readHash, setState } from "./ui/store.ts"
import { landing, pendingImport, takeImport } from "./ui/transfer.ts"

const host = document.getElementById("app")
if (!host) throw new Error("missing #app in the document")

/* Before the first render rather than in an effect inside it: the page also *writes* the hash from
   an effect further down, and effects run child first, so that write cleared the link before the
   read of it happened. A report the CLI handed over is lifted out of the address first. */
takeImport(landing(location.pathname))
setState(readHash(location.hash))

/* Started here rather than left to the effect in `Page`, so the face is on the wire while the
   first render goes out -- one round trip instead of two. Which one it is, is what `/open` buys. */
void loadFace(pendingImport() ? "report" : "intake")

/* Both lines above run first, which is what puts the report out of reach of the `<Analytics>`
   inside the tree: by the time it mounts, the address holds nothing out of a transcript. */
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
