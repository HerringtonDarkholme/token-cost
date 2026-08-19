/* The address, driven from the page rather than reasoned about: which moves earn a history entry
   and which rewrite the one the reader is on. */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { analyze } from "../src/engine.ts"
import { pathOf, slug } from "../src/model.ts"
import { loadFace } from "../src/faces.ts"
import { Page } from "../src/Page.tsx"
import { applyUrl, getState, pathFor, readPath, resetState, setState } from "../src/store.ts"
import { corpus } from "./fixture.ts"

const data = analyze(corpus())
const d = data.datasets["1h"]
const noop = (): void => {}

let container: HTMLElement
let root: Root
let pushed = 0
let replaced = 0

/** What the two writers did, counted, since a push and a replace leave the same address. */
const push = history.pushState.bind(history)
const replace = history.replaceState.bind(history)

beforeEach(async () => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  /* Both faces are chunks of their own now, and this suite renders the page rather than booting
     it -- so nothing else here would fetch them. */
  await Promise.all([loadFace("report"), loadFace("intake")])
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
      importing={false}
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
    act(() => setState({ path: ["Shell commands", "git"] }))
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
    act(() => setState({ path: ["Shell commands"] }))
    expect(location.pathname).toBe("/report/shell-commands")
    act(() => setState({ path: ["Shell commands", "git"] }))
    expect(location.pathname).toBe("/report/shell-commands/git")
    expect(pushed).toBe(2)
  })

  it("holds the settings in the hash, on the entry the reader is already on", () => {
    show(true)
    act(() => setState({ path: ["Shell commands"] }))
    pushed = 0
    replaced = 0
    act(() => setState({ chart: "sun", view: "table", pctOnly: true }))
    expect(location.pathname).toBe("/report/shell-commands")
    expect(location.hash).toContain("c=sun")
    expect(location.hash).toContain("v=table")
    expect(pushed).toBe(0)
    expect(replaced).toBeGreaterThan(0)
  })

  it("writes nothing when the browser is already where the page is going", () => {
    show(true)
    act(() => setState({ path: ["Shell commands"] }))
    /* What a Back looks like from here: the address moves first, the page follows it. */
    replace(null, "", "/report")
    pushed = 0
    replaced = 0
    act(() => {
      applyUrl(data)
    })
    expect(getState().path).toEqual([])
    expect(pushed).toBe(0)
    expect(replaced).toBe(0)
  })

  it("does not write from a face that is on its way out", () => {
    show(true)
    act(() => setState({ path: ["Shell commands"] }))
    replace(null, "", "/")
    pushed = 0
    replaced = 0
    act(() => render(true, true))
    expect(location.pathname).toBe("/")
    expect(pushed + replaced).toBe(0)
  })

  it("spells the names out rather than escaping them", () => {
    const group = d.groups.find((g) => g.name === "Tools · content read in")!
    const item = group.items![1]!
    const url = pathFor(true, [group.name, item.name])
    expect(url).toBe("/report/tools-content-read-in/read")
    expect(url).not.toMatch(/%/)
    /* And back through the tree, which is the only thing that knows what a slug stood for. */
    expect(pathOf(d, readPath(url).slugs)).toEqual([group.name, item.name])
    expect(readPath("/report").slugs).toEqual([])
    expect(readPath("/report").report).toBe(true)
    expect(readPath("/").report).toBe(false)
  })

  it("keeps a name whose alphabet is not this page's", () => {
    expect(slug("读取 src/文件.ts")).toBe("读取-src-文件-ts")
  })

  it("drops a name the tree does not have, rather than drilling into nothing", () => {
    expect(pathOf(d, ["no-such-group"])).toEqual([])
    expect(pathOf(d, ["shell-commands", "no-such-tool"])).toEqual(["Shell commands"])
  })

  it("undoes what a longer address added when a shorter one arrives", () => {
    show(true)
    act(() => setState({ path: ["Shell commands"], view: "table", ttl: "5m" }))
    replace(null, "", "/report")
    act(() => {
      applyUrl(data)
    })
    expect(getState().view).toBe("panels")
    expect(getState().ttl).toBe("1h")
  })
})
