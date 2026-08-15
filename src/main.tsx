/* Entry point. */

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { readHash, setState } from "./store.ts"

const host = document.getElementById("app")
if (!host) throw new Error("missing #app in the document")

/* Before the first render rather than in an effect inside it, because the page also *writes* the
   hash from an effect one component further down -- and effects run child first, so the write
   went out from the default state and cleared the link before the read of it ever happened. */
setState(readHash(location.hash))

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
