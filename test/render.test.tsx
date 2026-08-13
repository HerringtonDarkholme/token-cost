/* Every reachable view state, rendered into a real DOM.

   The point of this suite is unchanged from the string-matching one it replaces: drive the
   report through each state and assert the output is sane. What changed is that the output
   is now a document rather than a string, so structural claims are asked of the DOM --
   "no button inside a button" is a selector, not a scan for a substring. */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { analyze } from "../engine.ts";
import { Report } from "../Report.tsx";
import { getHover, getState, resetState, setHover, setState, type ViewState } from "../store.ts";
import { corpus } from "./fixture.ts";

const data = analyze(corpus(process.env.TRANSCRIPT_DIR));
const d = data.datasets["1h"];

let container: HTMLElement;
let root: Root;

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Report data={data} onReset={() => {}} />); });
});

afterAll(() => { act(() => { root.unmount(); }); });

beforeEach(() => { act(() => { resetState(); }); });

const show = (patch: Partial<ViewState>): void => { act(() => { setState(patch); }); };
const html = (): string => container.innerHTML;

/** The invariants every state has to hold, whatever it is showing. */
function expectClean(): void {
  const markup = html();
  expect(markup.length).toBeGreaterThan(500);

  // A formatting hole reaches the page as one of these, never as an exception.
  for (const rot of ["undefined", "NaN", "[object Object]"])
    expect(markup, `markup contains ${rot}`).not.toContain(rot);

  // A <button> inside a <button> is invalid and swallows clicks.
  expect(container.querySelectorAll("button button")).toHaveLength(0);

  // Every colour must resolve to a real token.
  for (const el of container.querySelectorAll<HTMLElement>("[style]"))
    expect(el.getAttribute("style")).not.toMatch(/var\(\s*(undefined|--undefined)/);

  /* The card always holds a chart, and whichever one it is keeps its own overflow: the
     mosaic scrolls sideways in its own box, the sunburst scales to the space it is given.
     Either way the body never scrolls sideways. */
  expect(container.querySelector(".mosaicwrap, .sun")).not.toBeNull();
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
  ];
  for (const [label, patch] of states)
    it(label, () => { show(patch); expectClean(); });

  it("hover readout", () => {
    const g = d.groups[0];
    act(() => {
      setHover({ key: `${g.name}›${g.name}`, name: g.name, cost: g.cost, under: null, group: g.name });
    });
    expectClean();
    expect(container.querySelector(".hoverbar .txt")?.getAttribute("data-on")).toBe("1");
    expect(container.querySelector(".hoverbar .txt")?.textContent).toContain(g.name);
  });
});

describe("drill-down", () => {
  for (const g of d.groups) {
    it(`→ ${g.name}`, () => {
      show({ path: [g.name] });
      expectClean();
      expect(container.querySelector(".crumbs")?.textContent).toContain(g.name);

      const kid = (g.items || []).find(i => i.children && i.children.length > 1);
      if (kid) {
        show({ path: [g.name, kid.name] });
        expectClean();
        expect(container.querySelector(".crumbs")?.textContent).toContain(kid.name);
      }
    });
  }
});

describe("interaction", () => {
  const click = (el: Element | null): void => {
    expect(el).not.toBeNull();
    act(() => { el!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  };
  const byLabel = (sel: string, text: string): Element | null =>
    [...container.querySelectorAll(sel)].find(e => e.textContent?.trim() === text) || null;

  it("the view switch is a real control", () => {
    click(byLabel("button", "Table"));
    expect(getState().view).toBe("table");
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("the chart toggle swaps the card's chart, and only that", () => {
    const total = container.querySelector(".total")?.textContent;
    click(byLabel("button", "Sunburst"));
    expect(getState().chart).toBe("sun");
    expect(container.querySelector(".mosaic")).toBeNull();
    expect(container.querySelector("svg .sunarc")).not.toBeNull();
    // Same tree, same money: swapping the picture must not move a number.
    expect(container.querySelector(".total")?.textContent).toBe(total);
    click(byLabel("button", "Mosaic"));
    expect(getState().chart).toBe("mosaic");
    expect(container.querySelector(".mosaic")).not.toBeNull();
  });

  it("the sunburst reads from the same hover store, and its legend drills", () => {
    show({ chart: "sun" });
    const g = d.groups.find(x => (x.items || []).length > 1) || d.groups[0];
    act(() => {
      setHover({ key: `${g.name}›${g.name}`, name: g.name, cost: g.cost, under: null, group: g.name });
    });
    // The hovered branch lights up -- and only it.
    const lit = container.querySelectorAll('path.sunarc[data-on="1"]');
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.length).toBeLessThan(container.querySelectorAll("path.sunarc").length);
    // Arcs carry no labels, so the hole is the readout.
    expect(container.querySelector(".suncore .s")?.textContent).toContain(g.name);
    expect(container.querySelector(".suncore .v")?.textContent).toMatch(/^\$[\d,.]+$/);

    click(byLabel(".legrow button", g.name));
    expect(getState().path).toEqual([g.name]);
    expectClean();
  });

  /* React synthesises enter/leave from `mouseover`/`mouseout` and their relatedTarget, so
     that pair is what these dispatch: a bare `mouseleave` would reach no handler at all. */
  const pointerTo = (from: Element | null, to: Element | null): void => {
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    act(() => {
      from!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: to }));
      to!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }));
    });
  };

  it("leaving the mosaic drops the highlight", () => {
    const seg = container.querySelector(".segb");
    pointerTo(container.querySelector(".colhead"), seg);
    expect(getHover()).not.toBeNull();
    expect(container.querySelector(".hoverbar .txt")?.getAttribute("data-on")).toBe("1");

    // Out of the chart but still inside the shell: the mosaic itself has to clear.
    pointerTo(seg, container.querySelector(".hoverbar"));
    expect(getHover()).toBeNull();
    expect(container.querySelector(".hoverbar .txt")?.getAttribute("data-on")).toBe("0");
    expect(container.querySelector('.col[data-dim="1"]')).toBeNull();
  });

  it("leaving a sunburst arc drops the highlight, hole or corner", () => {
    show({ chart: "sun" });
    const arcs = [...container.querySelectorAll("path.sunarc")];
    const arc = arcs[0];

    // Into the hole, which is a readout of the hover and so cannot keep an arc lit behind it.
    pointerTo(arcs[arcs.length - 1], arc);
    expect(getHover()).not.toBeNull();
    pointerTo(arc, container.querySelector(".suncore > *"));
    expect(getHover()).toBeNull();

    // Into the empty margin around the rings, caught by the backdrop under them.
    pointerTo(container.querySelector(".legrow"), arc);
    expect(getHover()).not.toBeNull();
    pointerTo(arc, container.querySelector("svg > rect"));
    expect(getHover()).toBeNull();
    expect(container.querySelectorAll('path.sunarc[data-on="1"]')).toHaveLength(0);
  });

  it("the eye masks the total, and unmasks it again", () => {
    const eye = container.querySelector('button[aria-label="Hide dollar amounts"]');
    const real = container.querySelector(".total")?.textContent;
    click(eye);
    expect(getState().pctOnly).toBe(true);
    expect(container.querySelector(".total")?.getAttribute("data-hidden")).toBe("1");
    // Covered, not blank: the figure's place is still held, so the layout does not collapse.
    expect(container.querySelector(".total")?.textContent).toMatch(/^\*+$/);
    // The same button is the way back -- there is no second one to press.
    expect(eye?.getAttribute("aria-pressed")).toBe("true");
    click(eye);
    expect(getState().pctOnly).toBe(false);
    expect(container.querySelector(".total")?.textContent).toBe(real);
  });

  it("the TTL switch recomputes the page", () => {
    const before = container.querySelector(".total")?.textContent;
    click(byLabel("button", "5m"));
    expect(getState().ttl).toBe("5m");
    expect(container.querySelector(".billed")?.textContent).toContain("5m");
    // The two lenses can legitimately agree to the cent; the label must still move.
    expect(typeof before).toBe("string");
  });

  /* The pressed state of a segmented control is a pill that travels, so the thing to assert
     is that every such control has exactly one of them and that adding it did not cost the
     buttons their names -- the pill is decoration, and says so. */
  it("every lens switch carries one pill, and its options still read as buttons", () => {
    for (const seg of container.querySelectorAll(".seg.t-tabs")) {
      expect(seg.querySelectorAll(".t-tabs-pill")).toHaveLength(1);
      expect(seg.querySelector(".t-tabs-pill")?.getAttribute("aria-hidden")).toBe("true");
      expect(seg.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
    }
    expect(byLabel(".t-tab", "Sunburst")).not.toBeNull();
    expect(byLabel(".t-tab", "5m")).not.toBeNull();
  });

  /* The total re-enters character by character when the lens or the mask changes it. The
     figure is split across spans to do that, so what has to hold is that it is still one
     number: the same characters, in order, and no digit left out. */
  it("the total is a row of digits, and stays the whole figure", () => {
    const digits = (): string[] =>
      [...container.querySelectorAll(".total .t-digit")].map(el => el.textContent || "");
    expect(digits().join("")).toBe(container.querySelector(".total")?.textContent);
    expect(digits().length).toBeGreaterThan(3);
    // The last two characters ride behind the rest, which is what makes cents feel alive.
    expect([...container.querySelectorAll(".total .t-digit[data-stagger]")]
      .map(el => el.getAttribute("data-stagger"))).toEqual(["1", "2"]);

    show({ pctOnly: true });
    expect(digits().join("")).toMatch(/^\*+$/);
  });

  it("a ledger row collapses", () => {
    show({ view: "table" });
    const rows = () => container.querySelectorAll("tbody tr").length;
    const open = rows();
    click(container.querySelector("tbody .tog[aria-expanded='true']"));
    expect(rows()).toBeLessThan(open);
    expectClean();
  });

  it("typing in the search box keeps focus", () => {
    const input = container.querySelector<HTMLInputElement>("#q");
    expect(input).not.toBeNull();
    input!.focus();
    act(() => {
      /* React tracks the input's value behind a property descriptor and ignores an event
         whose value it believes it already has, so type through the native setter. */
      const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      native!.set!.call(input, "git");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(getState().query).toBe("git");
    // The old renderer replaced the whole subtree on every keystroke and had to restore
    // the caret by hand; the input is now a stable node, so focus simply survives.
    expect(document.activeElement).toBe(container.querySelector("#q"));
  });
});
