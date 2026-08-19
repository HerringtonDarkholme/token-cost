/* The CLI's hand-off, driven through the real page: a payload in the fragment has to survive
   long enough to be read, because the page writes the address from an effect of its own. */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { gzipSync } from "node:zlib"
import { analyze } from "../src/engine.ts"
import { App } from "../src/App.tsx"
import { loadFace } from "../src/faces.ts"
import { readHash, resetState, setState } from "../src/store.ts"
import { landing, pendingImport, takeImport } from "../src/transfer.ts"
import { synthetic } from "./fixture.ts"

const data = analyze(synthetic())
const payload = gzipSync(Buffer.from(JSON.stringify(data), "utf8")).toString("base64url")

let container: HTMLElement
let root: Root

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  resetState()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  history.replaceState(null, "", "/")
})

/** Everything `main.tsx` does before the first render, in the order it does it -- which is the
 *  thing under test as much as the decode is. */
function boot(address: string): void {
  history.replaceState(null, "", address)
  takeImport(landing(location.pathname))
  setState(readHash(location.hash))
  void loadFace(pendingImport() ? "report" : "intake")
  act(() => root.render(<App />))
}

/** The turn is a timeout, and the decode is a stream: both have to drain. */
async function settle(ms = 600): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

describe("a report handed over by the CLI", () => {
  it("is decoded and drawn", async () => {
    boot(`/#d=${payload}`)
    await settle()
    expect(container.textContent).toContain("$")
    expect(location.pathname).toBe("/report")
  })

  it("leaves the payload out of the address it lands on", async () => {
    boot(`/#d=${payload}`)
    await settle()
    expect(location.hash).not.toContain("d=")
  })

  it("keeps the view settings that rode alongside it", async () => {
    boot(`/#ttl=5m&d=${payload}`)
    await settle()
    expect(location.hash).toContain("ttl=5m")
  })

  it("ignores a fragment that is not a report", async () => {
    boot("/#d=not-a-real-payload")
    /* Longer than the rest: a fragment that fails to decode has to drain the stream *and* then
       fetch the face it was never going to need, which the successful path already has in hand. */
    await settle(1500)
    expect(location.pathname).toBe("/")
    /* And falls back to the face it did not fetch: the card has to be droppable again. */
    expect(container.querySelector(".cardslot > .dropzone")).not.toBeNull()
  })
})

describe("the door the CLI sends it to", () => {
  it("draws the report and is not the address the reader is left on", async () => {
    boot(`/open#d=${payload}`)
    await settle()
    expect(container.textContent).toContain("$")
    expect(location.pathname).toBe("/report")
  })

  it("lands on the root even when it was reached without a report", async () => {
    boot("/open")
    await settle()
    expect(location.pathname).toBe("/")
    expect(container.querySelector(".cardslot > .dropzone")).not.toBeNull()
  })
})
