/* Every reachable view state, rendered into a real DOM. The point of this suite is unchanged
   from the string-matching one it replaces: drive the report through each state and assert the
   output is sane. */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { dict } from "../src/copy.tsx"
import { analyze, type Analysis } from "../src/engine.ts"
import { LANGS } from "../src/i18n.ts"
import { loadFace } from "../src/faces.ts"
import { Page, type Dir } from "../src/Page.tsx"
import { originOf, type Origin } from "../src/Upload.tsx"
import { getHover, getState, resetState, setHover, setState, type ViewState } from "../src/store.ts"
import { corpus, synthetic } from "./fixture.ts"

const data = analyze(corpus(process.env.TRANSCRIPT_DIR))
const d = data.datasets["1h"]

/** A stable identity, so the page is not handed a fresh callback per render. */
const noop = (): void => {}

let container: HTMLElement
let root: Root

beforeAll(async () => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  /* Both faces are chunks of their own now, and nothing here goes through the entry point that
     would have asked for them. */
  await Promise.all([loadFace("report"), loadFace("intake")])
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <Page
        data={data}
        leaving={false}
        dir="fwd"
        sample={false}
        importing={false}
        onData={noop}
        onReset={noop}
      />,
    )
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
    /* `resetState` deliberately keeps the language, the way it keeps the theme: both were chosen
       for the session rather than for the file. */
    setState({ lang: "en" })
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

  /* The card always holds a chart, and whichever one it is keeps its own overflow: the mosaic
     scrolls sideways in its own box, the sunburst scales to the space it is given. */
  expect(container.querySelector(".mosaicwrap, .sun")).not.toBeNull()

  /* `flatten` in `snapshot.ts` replaces every `[data-snaptext]` element with a span holding that
     attribute's text, so anything wearing the marker is promising it has nothing else worth
     drawing. */
  for (const el of container.querySelectorAll("[data-snaptext]"))
    expect(el.children, `${el.className} would lose its contents to the snapshot`).toHaveLength(0)
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

  /* Every language, through the states that carry the most interpolated copy. */
  for (const { value: lang, label } of LANGS)
    it(`${label} · panels and table`, () => {
      show({ lang })
      expectClean()
      show({ lang, view: "table", pctOnly: true })
      expectClean()
      /* The heading is set word by word and each language chooses its own slots, so the one
         thing to hold is that it chose some: an empty `ask` would leave the card titleless. */
      show({ lang })
      expect(container.querySelectorAll(".chead h1 [data-w]").length).toBeGreaterThan(1)
    })

  /* The heading lives inside a `TextSwap`, which holds its copy until its token moves -- and the
     token is the card's face, which a change of language does not touch. */
  it("held copy follows the language, not just the face", () => {
    const seen = new Map<string, string>()
    for (const { value: lang, label } of LANGS) {
      show({ lang })
      const h1 = container.querySelector(".chead h1")?.textContent?.trim() ?? ""
      expect(h1.length, `${label}: the heading is empty`).toBeGreaterThan(0)
      for (const [prev, text] of seen)
        expect(h1, `${label}: the heading is still showing ${prev}`).not.toBe(text)
      seen.set(label, h1)
    }
  })

  /* `isCode` decides which names are set in the mono face, and it decides it from where the
     engine put the row rather than from what the string looks like -- so what it actually marks
     is worth pinning against a real tree. */
  it("only the names off the reader's machine are set as code", () => {
    const named = (code: boolean): string[] =>
      Array.from(container.querySelectorAll(`[data-code="${code ? 1 : 0}"]`), (e) =>
        (e.textContent || "").trim(),
      )

    const shell = d.groups.find((g) => g.id === "shell")
    if (shell?.items?.length) {
      show({ view: "table", path: [shell.name] })
      expect(named(true), "a shell program is the reader's own").toContain(shell.items[0].name)
    }

    const tool = d.groups
      .filter((g) => g.id !== "shell")
      .flatMap((g) => (g.items || []).map((i) => [g, i] as const))
      .find(([, i]) => (i.children || []).length)
    if (tool) {
      const [g, item] = tool
      show({ view: "table", path: [g.name] })
      expect(named(false), "a tool is named, not typed").toContain(item.name)
      expect(named(true), "the path under it was typed").toContain(item.children![0].name)
    }

    // And nothing the dictionary answers for is ever code, at any depth.
    show({ view: "table" })
    for (const name of named(true))
      expect(dict("en").labels[name], `${name} is ours`).toBeUndefined()
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

  /* The stylesheet does the turning, but two things it cannot reach have to turn with it: the
     caption naming both axes, and the gutter, which has to lead in the markup rather than be
     pulled left by `order` -- a name read before its row should be tabbed to before it too. */
  it("a phone gets the mosaic on its side, and a caption that says so", () => {
    const width = (w: number): void =>
      act(() => {
        ;(
          window as unknown as { happyDOM: { setViewport: (v: { width: number }) => void } }
        ).happyDOM.setViewport({ width: w })
      })
    const lay = (): string | null =>
      container.querySelector(".mosaicwrap")?.getAttribute("data-lay") ?? null
    const caption = (): string => container.querySelector(".mosaichead .lbl")?.textContent ?? ""
    const headFirst = (): boolean =>
      container.querySelector(".col")?.firstElementChild?.className === "colhead"

    expect(lay()).toBe("cols")
    expect(caption()).toContain("column width = share of bill")
    expect(headFirst()).toBe(false)

    width(390)
    expect(lay()).toBe("rows")
    expect(caption()).toContain("row height = share of bill")
    expect(headFirst()).toBe(true)
    expectClean()

    width(1024)
    expect(lay()).toBe("cols")
    expect(headFirst()).toBe(false)
  })

  /* The switch that made `armed` necessary. */
  it("switching the chart lights nothing until the pointer moves", () => {
    pointerTo(container.querySelector(".hoverbar"), container.querySelector(".colhead"))
    expect(getHover()).not.toBeNull()

    click(byLabel("button", "Sunburst"))
    expect(getHover()).toBeNull()

    const arc = container.querySelector("path.sunarc")
    expect(arc).not.toBeNull()
    // The page arriving under the pointer: an enter, with nothing having moved.
    act(() => {
      arc!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    })
    expect(getHover()).toBeNull()
    expect(container.querySelectorAll('path.sunarc[data-on="1"]')).toHaveLength(0)
    expect(container.querySelector('path.sunarc[opacity="0.24"]')).toBeNull()
    /* The legend is the same store read a second way, so it cannot be the half that lights: one
       row standing out with the other eight faded is the same false claim in words. */
    expect(container.querySelectorAll('.legrow[data-on="1"]')).toHaveLength(0)
    expect(container.querySelector('.legrow[data-dim="1"]')).toBeNull()

    // The pointer itself moving, which is the thing a highlight follows.
    act(() => {
      arc!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
    })
    expect(getHover()).not.toBeNull()
    expect(container.querySelectorAll('path.sunarc[data-on="1"]').length).toBeGreaterThan(0)
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
    /* Arcs carry no labels, so the hole is the readout. */
    expect(container.querySelector(".suncore .s .leg:not([data-gone])")?.textContent).toContain(
      g.name,
    )
    expect(container.querySelector(".suncore .v")?.textContent).toMatch(/^\$[\d,.]+$/)

    click(byLabel(".legrow button", g.name))
    expect(getState().path).toEqual([g.name])
    expectClean()
  })

  /* React synthesises enter/leave from `mouseover`/`mouseout` and their relatedTarget, so that
     pair is what these dispatch: a bare `mouseleave` would reach no handler at all. */
  const pointerTo = (from: Element | null, to: Element | null): void => {
    expect(from).not.toBeNull()
    expect(to).not.toBeNull()
    act(() => {
      from!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: to }))
      to!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }))
      to!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }))
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
     describes a row nobody is looking at. */
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

  /* The dead space *inside* a view is the case a per-container clear cannot see, and the panels
     are full of it: card padding, the price beside a panel's title, the bar under it, a footer,
     the gaps in the grid. */
  it("the highlight drops in a view's own dead space, not just on the way out", () => {
    const item = container.querySelector(".pi")
    pointerTo(container.querySelector(".reconline"), item)
    expect(getHover()).not.toBeNull()
    expect(container.querySelector('.pi[data-on="1"]')).not.toBeNull()

    // Ten pixels up, onto the panel's own price.
    pointerTo(item, container.querySelector(".pantop .pc"))
    expect(getHover()).toBeNull()
    expect(container.querySelector('.pi[data-on="1"]')).toBeNull()
  })

  /* Focus is the other way in, so it has to be a way out too: `hoverBind` reports on focus, and
     tabbing off the last control in a view has to drop what it reported. */
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

  /* One hover store, so a row and its block in the chart have to name the same thing. */
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
     hovered -- `docker` lighting up under `docker-compose`, `pip` under `pip3`. The separator is
     what makes the test a path test rather than a string test. */
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

  /* A panel's title carries its group's colour as the bar beside it, and the colour reaches the
     bar as a custom property the stylesheet reads. */
  it("every panel title carries its group's colour", () => {
    show({ view: "panels" })
    const titles = [...container.querySelectorAll<HTMLElement>(".pantop button")]
    expect(titles.length).toBeGreaterThan(1)
    for (const b of titles) expect(b.style.getPropertyValue("--hue")).toMatch(/^var\(--c/)
    // And they are not all the same colour, which is the only thing the bar is there to say.
    expect(new Set(titles.map((b) => b.style.getPropertyValue("--hue"))).size).toBeGreaterThan(1)
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

  /* The corpus records the TTL of every cache write, which is what a transcript written by any
     recent Claude Code does -- so there is nothing left for the assumption to assume, and the
     switch that reprices it is not offered at all. */
  it("the TTL switch is absent when the transcripts left it nothing to reprice", () => {
    expect(data.ttlTokens.unknown).toBe(0)
    expect(byLabel("button", "5m")).toBeNull()
    expect(container.querySelector('[aria-label*="TTL"]')).toBeNull()
    expect(container.querySelector(".foot")?.textContent).toContain("100.0%")
  })

  /* One button where three stood, so what has to hold is that pressing walks the whole ring and
     comes back -- a cycle that stops on the last option is a control with a corner. */
  it("the theme walks to the next option and round again", () => {
    const btn = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>(".cycbtn")!
    /* The hint is the trigger's own next sibling -- that adjacency is the whole of what makes
       the CSS show it -- and the id link is what makes a screen reader read it. */
    const tipOf = (b: HTMLButtonElement): string => {
      const tip = b.nextElementSibling
      expect(tip?.id).toBe(b.getAttribute("aria-describedby"))
      return tip?.textContent ?? ""
    }

    /* The theme survives a reset the way the language does, so it is put back by hand: an
       earlier test that walked it would otherwise decide where this one starts. */
    show({ theme: "system" })
    expect(btn().getAttribute("aria-label")).toBe("System theme")
    expect(tipOf(btn())).toContain("Dark theme")

    click(btn())
    expect(getState().theme).toBe("dark")
    expect(btn().getAttribute("aria-label")).toBe("Dark theme")
    expect(tipOf(btn())).toContain("Light theme")

    click(btn())
    expect(getState().theme).toBe("light")
    click(btn())
    expect(getState().theme).toBe("system")
    // And only ever one of them on screen.
    expect(container.querySelectorAll(".cycbtn")).toHaveLength(1)
  })

  /* The pressed state of a segmented control is a pill that travels, so the thing to assert is
     that every such control has exactly one of them and that adding it did not cost the buttons
     their names -- the pill is decoration, and says so. */
  it("every lens switch carries one pill, and its options still read as buttons", () => {
    for (const seg of container.querySelectorAll(".seg.t-tabs")) {
      expect(seg.querySelectorAll(".t-tabs-pill")).toHaveLength(1)
      expect(seg.querySelector(".t-tabs-pill")?.getAttribute("aria-hidden")).toBe("true")
      expect(seg.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1)
    }
    expect(byLabel(".t-tab", "Sunburst")).not.toBeNull()
    expect(byLabel(".t-tab", "Table")).not.toBeNull()
  })

  /* The controls whose face is a symbol -- the eye over the dollars, the one theme glyph -- say
     what they do in a hint, and the hint has to be the words a screen reader gets as well as the
     ones a pointer gets. */
  it("a control drawn as a symbol is named, and its hint describes it", () => {
    const tips = new Map(
      [...container.querySelectorAll('[role="tooltip"]')].map((t) => [t.id, t] as const),
    )
    const described = [...container.querySelectorAll("[aria-describedby]")]
    // The reset, the eye, the theme.
    expect(described).toHaveLength(3)
    for (const el of described) {
      const tip = tips.get(el.getAttribute("aria-describedby") || "")
      expect(tip, `hint for ${el.getAttribute("aria-label") || el.textContent}`).toBeDefined()
      expect(tip!.textContent!.length).toBeGreaterThan(12)
      expect(el.nextElementSibling).toBe(tip)
    }

    const glyphs = [...container.querySelectorAll("button[data-icon]")]
    expect(glyphs).toHaveLength(1)
    for (const b of glyphs) {
      // A picture instead of the word, so the word has to be the name.
      expect(b.textContent).toBe("")
      expect(b.querySelector(".glyph")).not.toBeNull()
      expect(b.getAttribute("aria-label")).toMatch(/theme/)
    }
  })

  /* The total rolls from one figure to the next when the lens or the mask changes it. */
  it("the total is the whole figure, drawn either way", () => {
    const total = (): Element | null => container.querySelector(".total")
    const figure = (): string =>
      total()?.querySelector("[data-snaptext]")?.getAttribute("data-snaptext") ??
      total()?.textContent ??
      ""

    expect(figure()).toMatch(/^\$[\d,]+\.\d\d$/)

    show({ pctOnly: true })
    expect(figure()).toMatch(/^\*+$/)
  })

  /* The picture is the biggest thing on the page and the frame around it is a different shape
     for each chart, so the switch has two jobs. */
  it("each chart arrives in a fresh panel, inside a frame that resizes", () => {
    expect(container.querySelector(".card.t-resize")).not.toBeNull()
    const slot = (): Element | null => container.querySelector(".chartslot.t-panel-slide")
    const before = slot()
    expect(before?.querySelector(".mosaicwrap")).not.toBeNull()

    show({ chart: "sun" })
    expect(slot()).not.toBe(before)
    expect(slot()?.querySelector(".sun")).not.toBeNull()
    /* Still in a column that runs the height of the card, so `flex: 1` has something to measure
       against: the card's own panel is between them now, and it forwards the claim. */
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

  it("typing in the search box keeps focus, and the filter follows a beat later", async () => {
    const input = container.querySelector<HTMLInputElement>("#q")
    expect(input).not.toBeNull()
    input!.focus()
    act(() => {
      /* React tracks the input's value behind a property descriptor and ignores an event whose
         value it believes it already has, so type through the native setter. */
      const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      native!.set!.call(input, "git")
      input!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    /* The box has the letters at once and the breakdown does not, which is the arrangement the
       filter's view transition needs: a keystroke is not a state worth travelling to. */
    expect(input!.value).toBe("git")
    expect(getState().query).toBe("")
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400))
    })
    expect(getState().query).toBe("git")
    // The old renderer replaced the whole subtree on every keystroke and had to restore the caret
    // by hand; the input is now a stable node, so focus simply survives.
    expect(document.activeElement).toBe(container.querySelector("#q"))
  })
})

/* The two faces of one card, and the turn between them. */
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
      r.render(
        <Page
          data={shown}
          leaving={leaving}
          dir={dir}
          sample={false}
          importing={false}
          onData={noop}
          onReset={noop}
        />,
      )
    })
  }

  it("the empty face is the same card, waiting", () => {
    turn(null)
    expect(box.querySelector(".card")?.getAttribute("data-face")).toBe("empty")
    // The drop target is the card's own interior rather than a second box inside it.
    expect(box.querySelector(".cardslot > .dropzone")).not.toBeNull()
    /* The figure's place is held by a zero rather than a dash: the slot the bill arrives in is
       the slot the pricing walk counts up through, so it has to start at a number. */
    expect(box.querySelector(".total")?.textContent).toBe("$0.00")
    expect(box.querySelector(".total")?.getAttribute("data-empty")).toBe("1")
    /* One way to a folder, and it is the folder rather than the files: `webkitdirectory` is what
       makes a file input a folder picker, and asking for files instead meant a hidden dotfile to
       defeat and dozens of identically-named transcripts to multi-select. */
    const inputs = [...box.querySelectorAll(".dropzone input")]
    expect(inputs).toHaveLength(1)
    expect(inputs[0].getAttribute("webkitdirectory")).toBe("")
    /* Two buttons, and only the folder is the primary one: the example is there for a reader who
       has no `~/.claude` to point at -- a phone -- and must not read as the recommended route for
       one who does. */
    const picks = [...box.querySelectorAll<HTMLButtonElement>(".picks .btn")]
    expect(picks).toHaveLength(2)
    expect(picks[0].classList.contains("primary")).toBe(true)
    expect(picks[1].classList.contains("primary")).toBe(false)
    /* And the route into that hidden folder is inside the card, beside the button that opens the
       dialog it describes, rather than in the help below the fold. */
    expect(box.querySelector(".invite .howto p")?.textContent).toMatch(/claude/)
    /* One platform on show, not three: it is guessed from the user agent, and a row of all three
       spends the space on the two that are wrong for any given reader. */
    const sw = box.querySelector<HTMLButtonElement>(".howto .osbtn")
    expect(box.querySelectorAll(".howto button")).toHaveLength(1)
    expect(["macOS", "Windows", "Linux"]).toContain(sw!.textContent!.trim())
    // The platform's own mark rides with the word, and the chevron says there are others behind it.
    expect(sw!.querySelector(".osface .glyph")).not.toBeNull()
    expect(sw!.querySelector(".oscaret")).not.toBeNull()
    const tip = box.querySelector<HTMLElement>('.howto [role="tooltip"]')
    expect(sw!.getAttribute("aria-describedby")).toBe(tip!.id)
    const before = tip!.textContent
    act(() => sw!.click())
    expect(tip!.textContent).not.toBe(before)
    /* Two controls, and the theme switch is the last one in the bar: it is the anchor everything
       else grows leftward from, so it must not have anything to its right. Below the breakpoint
       the same set is the panel's rows read top to bottom, which is why the order is counted in
       `.tool` rather than in the bar's own children. */
    const bar = [...box.querySelectorAll(".tools > .tool")]
    expect(bar.at(-1)?.querySelector(".seg:not(.langseg)")).not.toBeNull()
    expect(bar.at(-2)?.querySelector(".langseg")).not.toBeNull()
    expect(box.querySelectorAll(".toolbar .seg")).toHaveLength(2)
    expect(box.querySelectorAll(".toolbar .langsel option")).toHaveLength(6)
    // Absent rather than disabled: there is nothing yet to discard, copy or reprice.
    expect(box.querySelector('button[aria-label="New analysis"]')).toBeNull()
  })

  /* Which of the two roads the button takes. */
  describe("the way into a folder", () => {
    const picker = (
      impl: ((...args: unknown[]) => Promise<unknown>) | undefined,
    ): (() => number) => {
      const g = globalThis as unknown as Record<string, unknown>
      if (impl) g.showDirectoryPicker = impl
      else delete g.showDirectoryPicker
      turn(null)
      const input = box.querySelector<HTMLInputElement>(".dropzone input")!
      let clicks = 0
      input.addEventListener("click", () => clicks++)
      return () => clicks
    }
    const press = async (): Promise<void> => {
      const btn = box.querySelector<HTMLButtonElement>(".picks .btn")!
      await act(async () => {
        btn.click()
      })
    }
    const fail = (name: string) => (): Promise<never> =>
      Promise.reject(Object.assign(new Error(name), { name }))

    afterAll(() => {
      delete (globalThis as unknown as Record<string, unknown>).showDirectoryPicker
    })

    it("falls back to the input when the browser has no picker", async () => {
      const clicks = picker(undefined)
      await press()
      expect(clicks()).toBe(1)
    })

    it("falls back when the picker is there but refused, as on a file:// page", async () => {
      // `SecurityError` is what a `file://` origin comes back with: the road exists, not here.
      const clicks = picker(fail("SecurityError"))
      await press()
      expect(clicks()).toBe(1)
    })

    it("takes the picker when there is one, and lets a closed dialog be", async () => {
      let asked = 0
      const clicks = picker(() => {
        asked++
        return fail("AbortError")()
      })
      await press()
      expect(asked).toBe(1)
      /* Nothing behind it: a dismissed dialog is the reader saying no, and re-opening a second
         one on top of it -- the one that says "upload" -- would be the page arguing. */
      expect(clicks()).toBe(0)
      expect(box.querySelector(".status")?.textContent).toBe("")
    })

    /* And what a pick does to the card: the note about the hidden folder is help for a dialog
       that has closed, so the transcripts take its place in the same box -- and give it back
       when the folder turns out to be the wrong one, because a reader who has to pick again
       needs the route rather than the names of the files that failed. */
    it("puts the transcripts where the way in was, and takes them back on a bad folder", async () => {
      let open!: () => void
      const gate = new Promise<void>((ready) => {
        open = ready
      })
      /* A transcript that is held open: the assertions in the middle are about the state the
         page is in *while* it reads, which is over in a microtask if nothing holds it. */
      const file = { name: "0f2c9a.jsonl", text: () => gate.then(() => "") }
      const dir = {
        name: "-Users-me-code-thing",
        values: () =>
          (async function* () {
            yield { kind: "file", name: file.name, getFile: () => Promise.resolve(file) }
          })(),
      }
      picker(() => Promise.resolve(dir))
      const btn = box.querySelector<HTMLButtonElement>(".picks .btn")!
      await act(async () => {
        btn.click()
        await new Promise((done) => setTimeout(done, 0))
      })

      const swap = box.querySelector(".swap")!
      expect(swap.getAttribute("data-face")).toBe("files")
      // Both faces are in the box; only one of them is on show.
      expect(swap.querySelector(".howto")?.getAttribute("data-on")).toBe("0")
      const found = swap.querySelector(".found")!
      expect(found.getAttribute("data-on")).toBe("1")
      expect(found.getAttribute("data-busy")).toBe("1")
      /* The panel is up before a byte has been read, saying so: no names yet, nothing counted,
         and the head naming the work rather than a number nobody can check. */
      expect(found.querySelectorAll(".filenm")).toHaveLength(0)
      expect(found.querySelector(".foundlbl")?.textContent).toMatch(/Reading/)
      expect(found.querySelector(".foundnum")?.textContent).toBe("0 / 1")
      expect(box.querySelector(".status")?.textContent).toBe("")

      /* An empty transcript is a folder with nothing billed in it, which is the road back: the
         list retreats, the way in returns, and the reason names the folder that was picked. */
      await act(async () => {
        open()
        await new Promise((done) => setTimeout(done, 600))
      })
      expect(swap.getAttribute("data-face")).toBe("how")
      expect(swap.querySelector(".howto")?.getAttribute("data-on")).toBe("1")
      expect(found.getAttribute("data-on")).toBe("0")
      expect(box.querySelector(".status")?.textContent).toMatch(/-Users-me-code-thing/)
      expect(box.querySelector(".status")?.textContent).toMatch(/has been billed/)

      /* And the panel it left behind holds what it wrote: the file named once, because the walk
         reads it once. */
      expect([...found.querySelectorAll(".filenm")].map((e) => e.textContent)).toEqual([
        "0f2c9a.jsonl",
      ])
      for (const cover of found.querySelectorAll(".filenm .filecover"))
        expect(cover.getAttribute("style")).toMatch(/steps\(12\)/)
    })
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
    /* Four, not five: the corpus records every cache write's TTL, so the switch that reprices
       the unrecorded ones has nothing to offer and is not drawn. */
    expect(box.querySelectorAll(".toolbar .t-grow")).toHaveLength(4)
    /* And the stagger still counts outward from the anchor without a gap in it. Sorted, not read
       in document order: the mask is drawn in the bar rather than in the panel, so the document
       no longer runs the same way the bar does. */
    expect(
      [...box.querySelectorAll(".toolbar .t-grow")].map((s) => s.getAttribute("data-i")).sort(),
    ).toEqual(["0", "1", "2", "3"])
    expect(
      [...box.querySelectorAll(".tools > .tool")].at(-1)?.querySelector(".seg:not(.langseg)"),
    ).not.toBeNull()
  })

  /* Below the breakpoint the bar is a panel behind one button. Which of the two shapes is drawn
     is the stylesheet's business, so what is checked here is the part that is not: the state the
     button and the panel agree on, and every control still being in exactly one place. */
  it("the bar folds into one button, and the panel it opens holds every control", () => {
    turn(data)
    const burger = box.querySelector<HTMLButtonElement>(".burger")!
    const tools = box.querySelector<HTMLElement>(".tools")!
    expect(burger.getAttribute("aria-controls")).toBe(tools.id)
    expect(burger.getAttribute("aria-expanded")).toBe("false")
    expect(tools.getAttribute("data-open")).toBe("0")
    expect(box.querySelector(".scrim")?.getAttribute("data-open")).toBe("0")

    /* One set of controls, not two: every control the bar holds is inside the panel element, so
       there is no second copy to fall out of step with this one. Scoped to the bar because the
       card runs its own switches off the same `.seg`. */
    for (const sel of [".linkish", ".freshbtn", ".langsel"])
      expect(box.querySelectorAll(".toolbar " + sel).length, `${sel} outside the panel`).toBe(
        box.querySelectorAll(".tools " + sel).length,
      )
    /* Except the mask, which is the point of the exception: it is drawn once, in the bar, so
       covering the dollars in front of someone does not cost a trip through the menu. */
    expect(box.querySelectorAll(".toolbar .eyebtn")).toHaveLength(1)
    expect(box.querySelectorAll(".tools .eyebtn")).toHaveLength(0)
    expect(box.querySelectorAll(".toolbar .seg").length).toBe(
      box.querySelectorAll(".tools .seg").length + 1,
    )
    // And every row that is a lens rather than an action says what it sets.
    const named = [...box.querySelectorAll(".tools > .tool")].filter((row) =>
      row.querySelector(".toollbl"),
    )
    expect(named.map((row) => row.querySelector(".toollbl")!.textContent)).toEqual([
      "New analysis",
      "Language",
      "Theme",
    ])

    act(() => burger.click())
    expect(burger.getAttribute("aria-expanded")).toBe("true")
    expect(tools.getAttribute("data-open")).toBe("1")
    expect(box.querySelector(".scrim")?.getAttribute("data-open")).toBe("1")
    // The page under the panel does not scroll while it is up.
    expect(document.body.style.overflow).toBe("hidden")

    /* Escape gives the page back, and gives the focus back to the button that took it -- closing
       must not drop the reader at the top of the document. */
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(tools.getAttribute("data-open")).toBe("0")
    expect(document.body.style.overflow).toBe("")
    expect(document.activeElement).toBe(burger)
  })

  /* Reset is the leg that cannot be done in one state change: React would take the report's DOM
     with it on the same tick, leaving nothing on screen to animate. */
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
    expect(box.querySelector(".total")?.textContent).toBe("$0.00")
    expect(box.querySelector(".toolbar")?.getAttribute("data-leaving")).toBeNull()
  })
})

/* Reading the pick, so the page does not have to ask about it. */
describe("where a pick came from", () => {
  const at = (...paths: string[]): Origin => originOf(paths)

  it("knows the transcript store, however far down it was picked", () => {
    // The ask itself: `~/.claude/projects`, whose children are dash-encoded project folders.
    expect(at("projects/-Users-me-code-thing/a.jsonl", "projects/-Users-me-x/b.jsonl")).toEqual({
      root: "projects",
      store: "claude",
    })
    // A drawer up: `.claude` holds more than transcripts, and the pick still works.
    expect(at(".claude/projects/-Users-me-x/a.jsonl", ".claude/todos/x.json")).toEqual({
      root: ".claude",
      store: "claude",
    })
    /* One project's folder, which the help below the card recommends for one project's bill. */
    expect(at("-Users-me-code-thing/a.jsonl")).toEqual({
      root: "-Users-me-code-thing",
      store: "claude",
    })
    // Same name, made on Windows, where the drive letter survives the flattening.
    expect(at("C--Users-me-code-thing/a.jsonl").store).toBe("claude")
  })

  it("knows the other store, by its folder or by the file's own name", () => {
    // `~/.codex/sessions`, whose children are the dated folders a rollout lands in.
    expect(at("sessions/2026/08/20/rollout-2026-08-20T11-18-30-abc.jsonl")).toEqual({
      root: "sessions",
      store: "codex",
    })
    // A drawer up, where `sessions` and `archived_sessions` sit side by side under `.codex`.
    expect(at(".codex/archived_sessions/rollout-x.jsonl", ".codex/config.toml")).toEqual({
      root: ".codex",
      store: "codex",
    })
    /* The folder alone, for a pick whose files were never named `rollout-`. */
    expect(at(".codex/sessions/2026/08/20/a.jsonl").store).toBe("codex")
    // And the name alone, for a rollout dragged out of its folder.
    expect(at("Downloads/rollout-2026-08-20T11-18-30-abc.jsonl").store).toBe("codex")
  })

  it("does not mistake a folder that merely shares the name", () => {
    // Someone's own `~/projects`, with a `.jsonl` in it.
    expect(at("projects/site/notes.jsonl")).toEqual({ root: "projects", store: null })
    expect(at("Downloads/a.jsonl")).toEqual({ root: "Downloads", store: null })
    // A session id is a session id: the file's own name is not evidence of anything.
    expect(at("Downloads/-Users-me-x.jsonl").store).toBe(null)
    // `sessions` without `.codex` over it is just a word.
    expect(at("notes/sessions/a.jsonl").store).toBe(null)
  })

  it("names one store for a pick that holds both", () => {
    expect(at("projects/-Users-me-x/a.jsonl", ".codex/sessions/rollout-x.jsonl").store).toBe(
      "claude",
    )
  })

  it("names no folder when there was none to name", () => {
    // Loose files dropped in, and two folders at once: neither has one root to report.
    expect(at("a.jsonl", "b.jsonl")).toEqual({ root: null, store: null })
    expect(at("-Users-me-x/a.jsonl", "-Users-me-y/b.jsonl")).toEqual({
      root: null,
      store: "claude",
    })
    expect(at()).toEqual({ root: null, store: null })
  })
})

/* The other half of the TTL switch's rule. */
describe("the TTL lens, where there is one to offer", () => {
  const legacy = analyze(synthetic({ recordTtl: false }))
  let box: HTMLElement
  let r: Root

  beforeAll(() => {
    box = document.createElement("div")
    document.body.appendChild(box)
    r = createRoot(box)
    act(() => {
      r.render(
        <Page
          data={legacy}
          leaving={false}
          dir="fwd"
          sample={false}
          importing={false}
          onData={noop}
          onReset={noop}
        />,
      )
    })
  })

  afterAll(() => {
    act(() => {
      r.unmount()
    })
    box.remove()
  })

  beforeEach(() => {
    act(() => {
      resetState()
      setState({ lang: "en" })
    })
  })

  const ttlBtn = (): HTMLButtonElement =>
    [...box.querySelectorAll<HTMLButtonElement>(".cycbtn")].find((b) =>
      b.getAttribute("aria-label")?.includes("TTL"),
    )!

  it("nothing was recorded, so the switch is there", () => {
    expect(legacy.ttlTokens.unknown).toBeGreaterThan(0)
    expect(legacy.ttlMeasuredShare).toBe(0)
    const btn = ttlBtn()
    expect(btn).toBeDefined()
    /* The abbreviation is the face, and the name is what it stands for -- "1h" on its own is the
       kind of label that means something only to whoever wrote it. */
    expect(btn.textContent?.trim()).toBe("1h")
    expect(btn.getAttribute("aria-label")).toBe("Cache-write TTL: 1h")
    // No pressed state: there is no sibling for it to be pressed instead of.
    expect(btn.hasAttribute("aria-pressed")).toBe(false)
    // Five controls now, and the stagger still runs unbroken outward from the anchor.
    expect(
      [...box.querySelectorAll(".toolbar .t-grow")].map((s) => s.getAttribute("data-i")).sort(),
    ).toEqual(["0", "1", "2", "3", "4"])
  })

  it("pressing it reprices the bill, and walks back", () => {
    const total = (): string => box.querySelector(".total")?.textContent ?? ""
    const at1h = total()

    act(() => {
      ttlBtn().dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(getState().ttl).toBe("5m")
    /* The *name*, not the face. */
    expect(ttlBtn().getAttribute("aria-label")).toBe("Cache-write TTL: 5m")
    expect(box.querySelector(".billed")?.textContent).toContain("5m")
    /* The point of the whole control: with nothing recorded, every cache write in the corpus is
       repriced, so the two lenses cannot agree. */
    expect(total()).not.toBe(at1h)
    expect(legacy.datasets["5m"].total).toBeLessThan(legacy.datasets["1h"].total)

    act(() => {
      ttlBtn().dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(getState().ttl).toBe("1h")
    expect(total()).toBe(at1h)
  })

  it("the hint says what pressing does, not what is already showing", () => {
    const tip = ttlBtn().nextElementSibling
    expect(tip?.id).toBe(ttlBtn().getAttribute("aria-describedby"))
    expect(tip?.textContent).toContain("5m")
    expect(tip?.textContent).toContain("1.25")
  })
})
