/* Every reachable view state, rendered into a real DOM.

   The point of this suite is unchanged from the string-matching one it replaces: drive the
   report through each state and assert the output is sane. What changed is that the output
   is now a document rather than a string, so structural claims are asked of the DOM --
   "no button inside a button" is a selector, not a scan for a substring. */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { analyze, type Analysis } from "../src/engine.ts"
import { Page, type Dir } from "../src/Page.tsx"
import { getHover, getState, resetState, setHover, setState, type ViewState } from "../src/store.ts"
import { corpus } from "./fixture.ts"

const data = analyze(corpus(process.env.TRANSCRIPT_DIR))
const d = data.datasets["1h"]

/** A stable identity, so the page is not handed a fresh callback per render. */
const noop = (): void => {}

let container: HTMLElement
let root: Root

beforeAll(() => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<Page data={data} leaving={false} dir="fwd" onData={noop} onReset={noop} />)
  })
})

afterAll(() => {
  act(() => {
    root.unmount()
  })
})

beforeEach(() => {
  act(() => {
    resetState()
  })
})

const show = (patch: Partial<ViewState>): void => {
  act(() => {
    setState(patch)
  })
}
const html = (): string => container.innerHTML

/** The invariants every state has to hold, whatever it is showing. */
function expectClean(): void {
  const markup = html()
  expect(markup.length).toBeGreaterThan(500)

  // A formatting hole reaches the page as one of these, never as an exception.
  for (const rot of ["undefined", "NaN", "[object Object]"])
    expect(markup, `markup contains ${rot}`).not.toContain(rot)

  // A <button> inside a <button> is invalid and swallows clicks.
  expect(container.querySelectorAll("button button")).toHaveLength(0)

  // Every colour must resolve to a real token.
  for (const el of container.querySelectorAll<HTMLElement>("[style]"))
    expect(el.getAttribute("style")).not.toMatch(/var\(\s*(undefined|--undefined)/)

  /* The card always holds a chart, and whichever one it is keeps its own overflow: the
     mosaic scrolls sideways in its own box, the sunburst scales to the space it is given.
     Either way the body never scrolls sideways. */
  expect(container.querySelector(".mosaicwrap, .sun")).not.toBeNull()
}

describe("view states", () => {
  const states: Array<[string, Partial<ViewState>]> = [
    ["root · panels · 1h", {}],
    ["sunburst chart", { chart: "sun" }],
    ["table view", { view: "table" }],
    ["amounts hidden", { pctOnly: true }],
    ["amounts hidden · sunburst", { chart: "sun", pctOnly: true }],
    ["amounts hidden · table", { view: "table", pctOnly: true }],
    ["5m TTL lens", { ttl: "5m" }],
    ["query hit · panels", { query: "git" }],
    ["query hit · sunburst", { chart: "sun", query: "git" }],
    ["query hit · table", { view: "table", query: "git" }],
    ["query miss · panels", { query: "zzzzzznope" }],
    ["query miss · sunburst", { chart: "sun", query: "zzzzzznope" }],
    ["query miss · table", { view: "table", query: "zzzzzznope" }],
  ]
  for (const [label, patch] of states)
    it(label, () => {
      show(patch)
      expectClean()
    })

  it("hover readout", () => {
    const g = d.groups[0]
    act(() => {
      setHover({
        key: `${g.name}›${g.name}`,
        name: g.name,
        cost: g.cost,
        under: null,
        group: g.name,
      })
    })
    expectClean()
    expect(container.querySelector(".hoverbar .txt")?.getAttribute("data-on")).toBe("1")
    expect(container.querySelector(".hoverbar .txt")?.textContent).toContain(g.name)
  })
})

describe("drill-down", () => {
  for (const g of d.groups) {
    it(`→ ${g.name}`, () => {
      show({ path: [g.name] })
      expectClean()
      expect(container.querySelector(".crumbs")?.textContent).toContain(g.name)

      const kid = (g.items || []).find((i) => i.children && i.children.length > 1)
      if (kid) {
        show({ path: [g.name, kid.name] })
        expectClean()
        expect(container.querySelector(".crumbs")?.textContent).toContain(kid.name)
      }
    })
  }
})

describe("interaction", () => {
  const click = (el: Element | null): void => {
    expect(el).not.toBeNull()
    act(() => {
      el!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
  }
  const byLabel = (sel: string, text: string): Element | null =>
    [...container.querySelectorAll(sel)].find((e) => e.textContent?.trim() === text) || null

  it("the view switch is a real control", () => {
    click(byLabel("button", "Table"))
    expect(getState().view).toBe("table")
    expect(container.querySelector("table")).not.toBeNull()
  })

  it("the chart toggle swaps the card's chart, and only that", () => {
    const total = container.querySelector(".total")?.textContent
    click(byLabel("button", "Sunburst"))
    expect(getState().chart).toBe("sun")
    expect(container.querySelector(".mosaic")).toBeNull()
    expect(container.querySelector("svg .sunarc")).not.toBeNull()
    // Same tree, same money: swapping the picture must not move a number.
    expect(container.querySelector(".total")?.textContent).toBe(total)
    click(byLabel("button", "Mosaic"))
    expect(getState().chart).toBe("mosaic")
    expect(container.querySelector(".mosaic")).not.toBeNull()
  })

  it("the sunburst reads from the same hover store, and its legend drills", () => {
    show({ chart: "sun" })
    const g = d.groups.find((x) => (x.items || []).length > 1) || d.groups[0]
    act(() => {
      setHover({
        key: `${g.name}›${g.name}`,
        name: g.name,
        cost: g.cost,
        under: null,
        group: g.name,
      })
    })
    // The hovered branch lights up -- and only it.
    const lit = container.querySelectorAll('path.sunarc[data-on="1"]')
    expect(lit.length).toBeGreaterThan(0)
    expect(lit.length).toBeLessThan(container.querySelectorAll("path.sunarc").length)
    // Arcs carry no labels, so the hole is the readout.
    expect(container.querySelector(".suncore .s")?.textContent).toContain(g.name)
    expect(container.querySelector(".suncore .v")?.textContent).toMatch(/^\$[\d,.]+$/)

    click(byLabel(".legrow button", g.name))
    expect(getState().path).toEqual([g.name])
    expectClean()
  })

  /* React synthesises enter/leave from `mouseover`/`mouseout` and their relatedTarget, so
     that pair is what these dispatch: a bare `mouseleave` would reach no handler at all. */
  const pointerTo = (from: Element | null, to: Element | null): void => {
    expect(from).not.toBeNull()
    expect(to).not.toBeNull()
    act(() => {
      from!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: to }))
      to!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }))
    })
  }

  it("leaving the mosaic drops the highlight", () => {
    const seg = container.querySelector(".segb")
    pointerTo(container.querySelector(".colhead"), seg)
    expect(getHover()).not.toBeNull()
    expect(container.querySelector(".hoverbar .txt")?.getAttribute("data-on")).toBe("1")

    // Out of the chart but still inside the shell: the mosaic itself has to clear.
    pointerTo(seg, container.querySelector(".hoverbar"))
    expect(getHover()).toBeNull()
    expect(container.querySelector(".hoverbar .txt")?.getAttribute("data-on")).toBe("0")
    expect(container.querySelector('.col[data-dim="1"]')).toBeNull()
  })

  it("leaving a sunburst arc drops the highlight, hole or corner", () => {
    show({ chart: "sun" })
    const arcs = [...container.querySelectorAll("path.sunarc")]
    const arc = arcs[0]

    // Into the hole, which is a readout of the hover and so cannot keep an arc lit behind it.
    pointerTo(arcs[arcs.length - 1], arc)
    expect(getHover()).not.toBeNull()
    pointerTo(arc, container.querySelector(".suncore > *"))
    expect(getHover()).toBeNull()

    // Into the empty margin around the rings, caught by the backdrop under them.
    pointerTo(container.querySelector(".legrow"), arc)
    expect(getHover()).not.toBeNull()
    pointerTo(arc, container.querySelector("svg > rect"))
    expect(getHover()).toBeNull()
    expect(container.querySelectorAll('path.sunarc[data-on="1"]')).toHaveLength(0)
  })

  /* The breakdown reports a hover the same way the charts do, so it has to drop one the same
     way: the readout is shared, and a highlight left standing after the pointer has moved on
     describes a row nobody is looking at. Both views, because both bind the hover. */
  it("leaving the breakdown drops the highlight, panels or table", () => {
    const out = (): Element | null => container.querySelector(".reconline")

    const pan = container.querySelector(".pan button")
    pointerTo(out(), pan)
    expect(getHover()).not.toBeNull()
    pointerTo(pan, out())
    expect(getHover()).toBeNull()
    expect(container.querySelector('.pi[data-on="1"]')).toBeNull()

    show({ view: "table" })
    const row = container.querySelector("tbody tr")
    pointerTo(out(), row)
    expect(getHover()).not.toBeNull()
    // Down into the footer, which is inside the table but is not one of the rows.
    pointerTo(row, container.querySelector("tfoot td"))
    expect(getHover()).toBeNull()
    expect(container.querySelector('tbody tr[data-on="1"]')).toBeNull()
  })

  /* The dead space *inside* a view is the case a per-container clear cannot see, and the
     panels are full of it: card padding, the price beside a panel's title, the bar under it,
     a footer, the gaps in the grid. The pointer is still inside `.panels` at every one of
     those, so what has to hold is that arriving anywhere unmarked drops the highlight --
     not merely leaving some container that happens to be tiled edge to edge. */
  it("the highlight drops in a view's own dead space, not just on the way out", () => {
    const item = container.querySelector(".pi")
    pointerTo(container.querySelector(".reconline"), item)
    expect(getHover()).not.toBeNull()
    expect(container.querySelector('.pi[data-on="1"]')).not.toBeNull()

    // Ten pixels up, onto the panel's own price. Inside `.panels`, and not a hover source.
    pointerTo(item, container.querySelector(".pantop .pc"))
    expect(getHover()).toBeNull()
    expect(container.querySelector('.pi[data-on="1"]')).toBeNull()
  })

  /* Focus is the other way in, so it has to be a way out too: `hoverBind` reports on focus,
     and tabbing off the last control in a view has to drop what it reported. */
  it("tabbing out of the breakdown drops the highlight", () => {
    show({ view: "table" })
    const tog = container.querySelector<HTMLElement>("tbody .tog")
    const away = container.querySelector<HTMLElement>("#q")
    expect(tog).not.toBeNull()
    act(() => {
      tog!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })
    expect(getHover()).not.toBeNull()

    act(() => {
      tog!.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: away }))
    })
    expect(getHover()).toBeNull()
  })

  /* One hover store, so a row and its block in the chart have to name the same thing. A
     child row's key used to be group-plus-name with no parent in it, which named nothing on
     the chart at all -- and the chart's prefix test was loose enough to light the parent
     column anyway, so it looked right while agreeing about nothing. */
  it("a child row and its block in the chart are the same hover", () => {
    show({ view: "table" })
    const child = [...container.querySelectorAll("tbody tr")].find((tr) => tr.className === "d1")
    expect(child, "the corpus should open a top-level row with children").not.toBeUndefined()
    pointerTo(container.querySelector(".reconline"), child ?? null)

    // The readout names the parent, which a row that published no parent could not do.
    expect(container.querySelector(".hoverbar .txt")?.textContent).toContain("›")
    // And exactly one column reads as hovered: the one this row lives in.
    expect(container.querySelectorAll('.col[data-dim="0"]')).toHaveLength(1)
  })

  /* `startsWith` on the key alone let a sibling whose name is a prefix of another's read as
     hovered -- `docker` lighting up under `docker-compose`, `pip` under `pip3`. The separator
     is what makes the test a path test rather than a string test. */
  it("a hover inside one column does not light the column whose name it starts with", () => {
    const first = container.querySelector<HTMLElement>(".col .colhead")
    pointerTo(container.querySelector(".hoverbar"), first)
    const real = getHover()
    expect(real).not.toBeNull()
    expect(container.querySelectorAll('.col[data-dim="0"]')).toHaveLength(1)

    // The same key with more name on the end: a different line item, and nobody's parent.
    act(() => {
      setHover({ ...real!, key: real!.key + "-zzz" })
    })
    expect(container.querySelectorAll('.col[data-dim="0"]')).toHaveLength(0)
  })

  it("the eye masks the total, and unmasks it again", () => {
    const eye = container.querySelector('button[aria-label="Hide dollar amounts"]')
    const real = container.querySelector(".total")?.textContent
    click(eye)
    expect(getState().pctOnly).toBe(true)
    expect(container.querySelector(".total")?.getAttribute("data-hidden")).toBe("1")
    // Covered, not blank: the figure's place is still held, so the layout does not collapse.
    expect(container.querySelector(".total")?.textContent).toMatch(/^\*+$/)
    // The same button is the way back -- there is no second one to press.
    expect(eye?.getAttribute("aria-pressed")).toBe("true")
    click(eye)
    expect(getState().pctOnly).toBe(false)
    expect(container.querySelector(".total")?.textContent).toBe(real)
  })

  it("the TTL switch recomputes the page", () => {
    const before = container.querySelector(".total")?.textContent
    click(byLabel("button", "5m"))
    expect(getState().ttl).toBe("5m")
    expect(container.querySelector(".billed")?.textContent).toContain("5m")
    // The two lenses can legitimately agree to the cent; the label must still move.
    expect(typeof before).toBe("string")
  })

  /* The pressed state of a segmented control is a pill that travels, so the thing to assert
     is that every such control has exactly one of them and that adding it did not cost the
     buttons their names -- the pill is decoration, and says so. */
  it("every lens switch carries one pill, and its options still read as buttons", () => {
    for (const seg of container.querySelectorAll(".seg.t-tabs")) {
      expect(seg.querySelectorAll(".t-tabs-pill")).toHaveLength(1)
      expect(seg.querySelector(".t-tabs-pill")?.getAttribute("aria-hidden")).toBe("true")
      expect(seg.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1)
    }
    expect(byLabel(".t-tab", "Sunburst")).not.toBeNull()
    expect(byLabel(".t-tab", "5m")).not.toBeNull()
  })

  /* The controls whose face is a symbol -- the eye over the dollars, "1h", the three theme
     glyphs -- say what they do in a hint, and the hint has to be the words a screen reader
     gets as well as the ones a pointer gets. So: a glyph button carries a name, its hint is
     what describes it, and the hint is the trigger's own next sibling, since that adjacency
     is the whole of what makes the CSS show it. The ids come from `useId`, which is exactly
     the kind of link that comes undone in a refactor with no symptom on screen. */
  it("a control drawn as a symbol is named, and its hint describes it", () => {
    const tips = new Map(
      [...container.querySelectorAll('[role="tooltip"]')].map((t) => [t.id, t] as const),
    )
    const described = [...container.querySelectorAll("[aria-describedby]")]
    // The reset, the eye, the two TTL options, the three themes.
    expect(described).toHaveLength(7)
    for (const el of described) {
      const tip = tips.get(el.getAttribute("aria-describedby") || "")
      expect(tip, `hint for ${el.getAttribute("aria-label") || el.textContent}`).toBeDefined()
      expect(tip!.textContent!.length).toBeGreaterThan(12)
      expect(el.nextElementSibling).toBe(tip)
    }

    const glyphs = [...container.querySelectorAll("button[data-icon]")]
    expect(glyphs).toHaveLength(3)
    for (const b of glyphs) {
      // A picture instead of the word, so the word has to be the name.
      expect(b.textContent).toBe("")
      expect(b.querySelector(".glyph")).not.toBeNull()
      expect(b.getAttribute("aria-label")).toMatch(/theme/)
    }
  })

  /* The total re-enters character by character when the lens or the mask changes it. The
     figure is split across spans to do that, so what has to hold is that it is still one
     number: the same characters, in order, and no digit left out. */
  it("the total is a row of digits, and stays the whole figure", () => {
    const digits = (): string[] =>
      [...container.querySelectorAll(".total .t-digit")].map((el) => el.textContent || "")
    expect(digits().join("")).toBe(container.querySelector(".total")?.textContent)
    expect(digits().length).toBeGreaterThan(3)
    // The last two characters ride behind the rest, which is what makes cents feel alive.
    expect(
      [...container.querySelectorAll(".total .t-digit[data-stagger]")].map((el) =>
        el.getAttribute("data-stagger"),
      ),
    ).toEqual(["1", "2"])

    show({ pctOnly: true })
    expect(digits().join("")).toMatch(/^\*+$/)
  })

  /* The picture is the biggest thing on the page and the frame around it is a different shape
     for each chart, so the switch has two jobs. What has to hold structurally is that the
     chart sits in a panel of its own and that the panel is a *fresh* one per chart -- the same
     node reopening has no closed state to travel from -- and that the chart keeps the flex
     column it fills, since neither the mosaic's scroller nor the sunburst's disc has a height
     of its own to fall back on. */
  it("each chart arrives in a fresh panel, inside a frame that resizes", () => {
    expect(container.querySelector(".card.t-resize")).not.toBeNull()
    const slot = (): Element | null => container.querySelector(".chartslot.t-panel-slide")
    const before = slot()
    expect(before?.querySelector(".mosaicwrap")).not.toBeNull()

    show({ chart: "sun" })
    expect(slot()).not.toBe(before)
    expect(slot()?.querySelector(".sun")).not.toBeNull()
    /* Still in a column that runs the height of the card, so `flex: 1` has something to
       measure against: the card's own panel is between them now, and it forwards the claim. */
    expect(slot()?.parentElement?.classList.contains("cardslot")).toBe(true)
    expect(slot()?.parentElement?.parentElement?.classList.contains("card")).toBe(true)
  })

  it("a ledger row collapses", () => {
    show({ view: "table" })
    const rows = () => container.querySelectorAll("tbody tr").length
    const open = rows()
    click(container.querySelector("tbody .tog[aria-expanded='true']"))
    expect(rows()).toBeLessThan(open)
    expectClean()
  })

  it("typing in the search box keeps focus", () => {
    const input = container.querySelector<HTMLInputElement>("#q")
    expect(input).not.toBeNull()
    input!.focus()
    act(() => {
      /* React tracks the input's value behind a property descriptor and ignores an event
         whose value it believes it already has, so type through the native setter. */
      const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      native!.set!.call(input, "git")
      input!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(getState().query).toBe("git")
    // The old renderer replaced the whole subtree on every keystroke and had to restore
    // the caret by hand; the input is now a stable node, so focus simply survives.
    expect(document.activeElement).toBe(container.querySelector("#q"))
  })
})

/* The two faces of one card, and the turn between them.

   This is the claim the whole page is arranged around: a CSS transition needs the *same
   element* on both sides of a change, so what has to hold is not that an empty card and a
   report both render -- it is that they render into the same frame. The moment they are two
   nodes, the card's size and border stop tweening and the morph is a crossfade between two
   boxes that happen to look alike. A node identity is not something the eye can check in a
   screenshot, which is exactly why it is asserted here. */
describe("the card's two faces", () => {
  let box: HTMLElement
  let r: Root

  beforeAll(() => {
    box = document.createElement("div")
    document.body.appendChild(box)
    r = createRoot(box)
  })

  afterAll(() => {
    act(() => {
      r.unmount()
    })
    box.remove()
  })

  const turn = (
    shown: Analysis | null,
    { leaving = false, dir = "fwd" }: { leaving?: boolean; dir?: Dir } = {},
  ): void => {
    act(() => {
      r.render(<Page data={shown} leaving={leaving} dir={dir} onData={noop} onReset={noop} />)
    })
  }

  it("the empty face is the same card, waiting", () => {
    turn(null)
    expect(box.querySelector(".card")?.getAttribute("data-face")).toBe("empty")
    // The drop target is the card's own interior rather than a second box inside it.
    expect(box.querySelector(".cardslot > .dropzone")).not.toBeNull()
    // The figure's place is held by a dash, so the bill has somewhere to arrive.
    expect(box.querySelector(".total")?.textContent).toBe("—")
    expect(box.querySelector(".total")?.getAttribute("data-empty")).toBe("1")
    /* One way in, and it is the folder: `webkitdirectory` is what makes a file input a folder
       picker, and asking for files instead meant a hidden dotfile to defeat and dozens of
       identically-named transcripts to multi-select. */
    const inputs = [...box.querySelectorAll(".dropzone input")]
    expect(inputs).toHaveLength(1)
    expect(inputs[0].getAttribute("webkitdirectory")).toBe("")
    expect(box.querySelectorAll(".picks .btn")).toHaveLength(1)
    /* And the route into that hidden folder is inside the card, beside the button that opens the
       dialog it describes, rather than in the help below the fold. */
    expect(box.querySelector(".invite .howto p")?.textContent).toMatch(/claude/)
    /* One platform on show, not three: it is guessed from the user agent, and a row of all three
       spends the space on the two that are wrong for any given reader. The face is the platform
       it is on, so what has to say the thing is pressable at all is the hint -- and pressing has
       to walk to the next one. */
    const sw = box.querySelector<HTMLButtonElement>(".howto .osbtn")
    expect(box.querySelectorAll(".howto button")).toHaveLength(1)
    expect(["macOS", "Windows", "Linux"]).toContain(sw!.textContent!.trim())
    const tip = box.querySelector<HTMLElement>('.howto [role="tooltip"]')
    expect(sw!.getAttribute("aria-describedby")).toBe(tip!.id)
    const before = tip!.textContent
    act(() => sw!.click())
    expect(tip!.textContent).not.toBe(before)
    /* One control, and it is the last one in the bar: the theme switch is the anchor
       everything else grows leftward from, so it must not have anything to its right. */
    const bar = [...box.querySelectorAll(".toolbar > *")]
    expect(bar.at(-1)?.classList.contains("seg")).toBe(true)
    expect(box.querySelectorAll(".toolbar .seg")).toHaveLength(1)
    // Absent rather than disabled: there is nothing yet to discard, copy or reprice.
    expect(box.querySelector('button[aria-label="New analysis"]')).toBeNull()
  })

  it("a file changes what the card holds, not the card", () => {
    turn(null)
    const card = box.querySelector(".card")
    const slot = box.querySelector(".cardslot")
    turn(data)

    expect(box.querySelector(".card")).toBe(card)
    expect(card?.getAttribute("data-face")).toBe("report")
    // The contents *are* replaced: a fresh panel is what has a closed state to travel from.
    expect(box.querySelector(".cardslot")).not.toBe(slot)
    expect(box.querySelector(".dropzone")).toBeNull()
    expect(box.querySelector(".cardslot .mosaicwrap")).not.toBeNull()
    expect(box.querySelector(".total")?.textContent).toMatch(/^\$[\d,.]+$/)
    // And the controls that only mean something now that there is a bill have arrived.
    expect(box.querySelector('button[aria-label="New analysis"]')).not.toBeNull()
    expect(box.querySelectorAll(".toolbar .t-grow")).toHaveLength(5)
    expect([...box.querySelectorAll(".toolbar > *")].at(-1)?.classList.contains("seg")).toBe(true)
  })

  /* Reset is the leg that cannot be done in one state change: React would take the report's
     DOM with it on the same tick, leaving nothing on screen to animate. So the face on show is
     held mounted with `leaving` set, and what has to hold is that it is still there, closed,
     and pointed the other way. */
  it("the report is held on its way out, and goes back the way it came", () => {
    turn(data)
    const card = box.querySelector(".card")

    turn(data, { leaving: true, dir: "back" })
    // Still mounted, and still the report: there is something left to animate.
    expect(box.querySelector(".cardslot .mosaicwrap")).not.toBeNull()
    /* Both panels, closed and marked: the card's contents and everything under it leave on the
       same beat, so the page does not come apart in the middle on its way out. */
    const closing = [".cardslot", ".below"].map((sel) => box.querySelector(sel))
    expect(closing.map((el) => el?.getAttribute("data-leaving"))).toEqual(["1", "1"])
    expect(closing.map((el) => el?.getAttribute("data-open"))).toEqual(["false", "false"])
    // The exit direction is the page's, not the panel's, so it can differ between the legs.
    expect(box.querySelector(".shell")?.getAttribute("data-dir")).toBe("back")
    // The toolbar's controls leave with it rather than vanishing out from under the pointer.
    expect(box.querySelector(".toolbar")?.getAttribute("data-leaving")).toBe("1")
    expect(box.querySelector('button[aria-label="New analysis"]')).not.toBeNull()

    turn(null, { dir: "back" })
    expect(box.querySelector(".card")).toBe(card)
    expect(box.querySelector(".cardslot > .dropzone")).not.toBeNull()
    expect(box.querySelector(".total")?.textContent).toBe("—")
    expect(box.querySelector(".toolbar")?.getAttribute("data-leaving")).toBeNull()
  })
})
