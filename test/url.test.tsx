/* The address, driven from the page rather than reasoned about: which moves earn a history entry
   and which rewrite the one the reader is on. */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { analyze } from "../src/engine.ts"
import { Page } from "../src/Page.tsx"
import { applyUrl, getState, pathFor, readPath, resetState, setState } from "../src/store.ts"
import { corpus } from "./fixture.ts"

const data = analyze(corpus())
const noop = (): void => {}

let container: HTMLElement
let root: Root
let pushed = 0
let replaced = 0

/** What the two writers did, counted, since a push and a replace leave the same address. */
const push = history.pushState.bind(history)
const replace = history.replaceState.bind(history)

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  history.replaceState = (s: unknown, t: string, u?: string | null): void => {
    replaced++
    replace(s, t, u)
  }
  history.pushState = (s: unknown, t: string, u?: string | null): void => {
    pushed++
    push(s, t, u)
  }
  replace(null, "", "/")
  pushed = 0
  replaced = 0
  resetState()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  history.pushState = push
  history.replaceState = replace
})

/** The page at a given face. */
function render(report: boolean, leaving = false): void {
  root.render(
    <Page
      data={report ? data : null}
      leaving={leaving}
      dir="fwd"
      sample={false}
      onData={noop}
      onReset={noop}
    />,
  )
}

function show(report: boolean): void {
  act(() => render(report))
}

describe("the address", () => {
  it("is the site root while there is nothing to report", () => {
    show(false)
    expect(location.pathname).toBe("/")
    expect(pushed).toBe(0)
  })

  it("gives the report an entry of its own", () => {
    show(false)
    show(true)
    expect(location.pathname).toBe("/report")
    expect(pushed).toBe(1)
  })

  it("comes home from however deep the reader got, in one move", () => {
    show(true)
    act(() => setState({ path: ["shell", "git"] }))
    pushed = 0
    /* One act, because the turn clears the view state and drops the report together -- see the
       `swap` in App. */
    act(() => {
      resetState()
      render(false, false)
    })
    expect(location.pathname).toBe("/")
    expect(pushed).toBe(1)
  })

  it("gives the drill one too, a segment per level", () => {
    show(true)
    pushed = 0
    act(() => setState({ path: ["shell"] }))
    expect(location.pathname).toBe("/report/shell")
    act(() => setState({ path: ["shell", "git"] }))
    expect(location.pathname).toBe("/report/shell/git")
    expect(pushed).toBe(2)
  })

  it("holds the settings in the hash, on the entry the reader is already on", () => {
    show(true)
    act(() => setState({ path: ["shell"] }))
    pushed = 0
    replaced = 0
    act(() => setState({ chart: "sun", view: "table", pctOnly: true }))
    expect(location.pathname).toBe("/report/shell")
    expect(location.hash).toContain("c=sun")
    expect(location.hash).toContain("v=table")
    expect(pushed).toBe(0)
    expect(replaced).toBeGreaterThan(0)
  })

  it("writes nothing when the browser is already where the page is going", () => {
    show(true)
    act(() => setState({ path: ["shell"] }))
    /* What a Back looks like from here: the address moves first, the page follows it. */
    replace(null, "", "/report")
    pushed = 0
    replaced = 0
    act(() => {
      applyUrl()
    })
    expect(getState().path).toEqual([])
    expect(pushed).toBe(0)
    expect(replaced).toBe(0)
  })

  it("does not write from a face that is on its way out", () => {
    show(true)
    act(() => setState({ path: ["shell"] }))
    replace(null, "", "/")
    pushed = 0
    replaced = 0
    act(() => render(true, true))
    expect(location.pathname).toBe("/")
    expect(pushed + replaced).toBe(0)
  })

  it("reads back what it writes, name by name", () => {
    const path = ["Read", "some dir/a file.ts"]
    expect(readPath(pathFor(true, path)).path).toEqual(path)
    expect(readPath("/report").path).toEqual([])
    expect(readPath("/report").report).toBe(true)
    expect(readPath("/").report).toBe(false)
  })

  it("undoes what a longer address added when a shorter one arrives", () => {
    show(true)
    act(() => setState({ path: ["shell"], view: "table", ttl: "5m" }))
    replace(null, "", "/report")
    act(() => {
      applyUrl()
    })
    expect(getState().view).toBe("panels")
    expect(getState().ttl).toBe("1h")
  })
})
