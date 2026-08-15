/* Entry point. */

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"

const host = document.getElementById("app")
if (!host) throw new Error("missing #app in the document")

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
