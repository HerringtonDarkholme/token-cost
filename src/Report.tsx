/* The report's own parts: thesis strip, the picture, the breakdown, the footnotes.

   What holds them is the page (see `Page.tsx`), which outlives any one of them -- these mount
   when an analysis arrives and unmount when it is discarded, inside a card that does neither.

   One subscription to the view state at the top of the page, one context down. A change to the
   view -- lens, drill, query, units -- re-renders from there, and React diffs it to the handful
   of attributes that actually moved. Hover is the exception: it arrives dozens of times a
   second and is read from its own store slice by the few components that draw a highlight,
   so a pointer sweep does not re-render the header, the footnotes and the ledger. They all
   still read the one hover key from the one place, which is what lets the mosaic, the
   panels and the table stay a single instrument. */

import { useMemo } from "react"
import type { Dataset } from "./engine.ts"
import { useReport } from "./context.ts"
import { count, FOLD_MIN, ledger, money, pctOf } from "./model.ts"
import { setHover, setState, type ViewState } from "./store.ts"
import { Seg, type SegOption } from "./Seg.tsx"
import { Reveal } from "./Motion.tsx"
import { HoverBar, Mosaic } from "./Mosaic.tsx"
import { Panels } from "./Panels.tsx"
import { Sunburst } from "./Sunburst.tsx"
import { LedgerTable, useReconNote } from "./Ledger.tsx"

/* No hints on these two: the words are the whole explanation. */
const VIEWS: ReadonlyArray<SegOption<ViewState["view"]>> = [
  { value: "panels", label: "Panels" },
  { value: "table", label: "Table" },
]

const CHARTS: ReadonlyArray<SegOption<ViewState["chart"]>> = [
  { value: "mosaic", label: "Mosaic" },
  { value: "sun", label: "Sunburst" },
]

/* Written once rather than closed over per render: a pick is a write to the store, which is a
   module away, so neither switch needs anything from the component around it. */
const pickView = (view: ViewState["view"]): void => setState({ view })
const pickChart = (chart: ViewState["chart"]): void => setState({ chart })

function Crumbs(): React.JSX.Element {
  const { state } = useReport()
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <button
        type="button"
        data-cur={state.path.length ? 0 : 1}
        onClick={() => {
          setHover(null)
          setState({ path: [] })
        }}
      >
        all
      </button>
      {state.path.map((p, i) => (
        <span key={p}>
          <span className="sep">/</span>
          <button
            type="button"
            data-cur={i === state.path.length - 1 ? 1 : 0}
            onClick={() => {
              setHover(null)
              setState({ path: state.path.slice(0, i + 1) })
            }}
          >
            {p}
          </button>
        </span>
      ))}
    </nav>
  )
}

/** The four figures that carry the thesis. Each is a mechanism the reader can check in
 *  their own numbers, not a headline figure that belongs to one dataset. */
function Strip(): React.JSX.Element {
  const { d, state, amt, reqs } = useReport()
  const I = d.insights
  return (
    <div className="strip">
      <div>
        <div className="thesis">
          A <em>carry</em> bill, not a usage bill — every request re-bills the whole context.
        </div>
      </div>
      <div>
        <div className="carryrow">
          <span className="from">{amt(I.proseGen)}</span>
          <span className="arrow">→</span>
          <span className="to">{amt(I.proseCarry)}</span>
        </div>
        <div className="cap">
          Written once, carried{" "}
          {I.proseGen > 0 ? (I.proseCarry / I.proseGen).toFixed(1) + "×" : "—"}
        </div>
      </div>
      <div>
        <div className="big">
          {pctOf(d.input, d.total).toFixed(1)}% <span className="sm">/</span>{" "}
          <span className="dim">{pctOf(d.output, d.total).toFixed(1)}%</span>
        </div>
        <div className="cap">
          Input vs output · thinking {pctOf(I.thinking, d.total).toFixed(1)}%
        </div>
      </div>
      <div>
        <div className="big">
          {state.pctOnly
            ? pctOf(I.fixed, d.total).toFixed(1) + "%"
            : "$" + (I.fixed / reqs).toFixed(3)}
          <span className="sm"> of</span>{" "}
          <span className="dim">
            {state.pctOnly ? "the bill" : "$" + (d.total / reqs).toFixed(3)}
          </span>
        </div>
        <div className="cap">
          {state.pctOnly
            ? `Fixed, paid on all ${count(d.requests)} requests`
            : `Fixed, every request · ${money(I.fixed)}`}
        </div>
      </div>
    </div>
  )
}

export function Breakdown(): React.JSX.Element {
  const { d, state, amt } = useReport()
  /* Memoised for its identity rather than its cost -- a ledger walk is microseconds, and the
     memoised rows below it are what actually want a stable `L`. */
  const L = useMemo(
    () => ledger(d, state.path, state.open, state.query),
    [d, state.path, state.open, state.query],
  )
  const note = useReconNote(L)
  return (
    <section className="bsec">
      <div className="bhead">
        <h2>Breakdown</h2>
        <div className="bctl">
          <label htmlFor="q">Find</label>
          <input
            id="q"
            type="search"
            value={state.query}
            placeholder="git diff, thinking, schema…"
            onChange={(e) => setState({ query: e.target.value })}
          />
          <Seg options={VIEWS} value={state.view} onPick={pickView} />
        </div>
      </div>
      <Reveal key={state.view}>
        {state.view === "panels" ? <Panels /> : <LedgerTable L={L} />}
      </Reveal>
      <div className="reconline">
        <span>{note}</span>
        <span>
          Reconciled: <strong>{amt(L.recon)}</strong>
        </span>
      </div>
    </section>
  )
}

export function Footnotes(): React.JSX.Element {
  const { data, d, amt } = useReport()
  const I = d.insights
  const lensGap = Math.abs(data.datasets["1h"].total - data.datasets["5m"].total)
  const density = data.density
    ? `${data.density.code.toFixed(2)} chars/token for machine text and ` +
      `${data.density.text.toFixed(2)} for prose, ` +
      (data.densityCalibrated
        ? "both measured from this dataset"
        : "defaults, too few samples to measure")
    : "~4 chars/token"

  return (
    <section className="foot">
      <div>
        <h3>What to change on Monday</h3>
        <ul>
          <li>
            <strong>Cut the intake, not the output.</strong> {amt(I.ingest)} of the bill is content
            tools pulled <em>into</em> context, against {amt(I.emit)} of arguments sent out and{" "}
            {amt(I.typed)} for everything you typed
            {I.typed > 0 ? ` (${(I.ingest / I.typed).toFixed(0)}× less)` : ""}. Tool output lands in
            the prefix whole and is re-billed until it falls out — ask for narrower slices.
          </li>
          <li>
            <strong>Trim the preamble.</strong> {amt(I.fixed)} of fixed overhead is the only line
            you can delete once and stop paying {count(d.requests)} times.
          </li>
          <li>
            <strong>Compact sooner.</strong> Carry cost is linear in how long a result survives, not
            in how big it looked.
          </li>
        </ul>
      </div>
      <div>
        <h3>Caveats</h3>
        <ul className="cav">
          <li>
            Cache writes bill at 2× input on a 1h TTL and 1.25× on 5m. Where the transcript records
            which applied, that is used verbatim; the switch only reprices what it omitted, which is
            why the two lenses differ by just {money(lensGap)} here.
          </li>
          <li>
            “Model output” exceeds output-token spend because prose written once is re-billed as
            input on every later request.
          </li>
          <li>
            Blocks under {(FOLD_MIN * 100).toFixed(1)}% of their parent are folded into a labelled
            “other”; nothing is dropped. Identity is carried by the table as well as by hue.
          </li>
          <li>
            Totals are exact; the split across line items is estimated from character counts at{" "}
            {density}.
          </li>
          <li>
            Cache-write TTL was recorded for{" "}
            {data.ttlMeasuredShare != null
              ? (data.ttlMeasuredShare * 100).toFixed(1) + "%"
              : "an unknown share"}{" "}
            of written tokens, so the lens above only reprices the remainder.
            {data.models && data.models.length
              ? ` Models: ${data.models.map((m) => m.id).join(", ")}.`
              : ""}
          </li>
        </ul>
      </div>
    </section>
  )
}

/** What the card holds once there is a bill to show: the thesis, the picture, and the two
 *  rules that frame it. The header above it belongs to the card rather than to this, because
 *  the card has a header before there is anything to report -- the heading merely changes
 *  tense when the numbers arrive. */
export function CardBody(): React.JSX.Element {
  const { state } = useReport()
  return (
    <>
      <Strip />
      <div className="mosaichead">
        <span className="lbl">
          {state.chart === "sun"
            ? "Every line item · arc = share of the ring inside it · each ring one level deeper"
            : "Every line item · column width = share of bill · block height = share of column"}
        </span>
        <Crumbs />
      </div>
      {/* Keyed on the chart, so the picture the switch asks for arrives rather than
          appearing: a fresh panel mounts closed and slides up into the space the other
          one left. The frame around it changes shape at the same time -- `.card` is 16/9
          for the mosaic and 4/3 for the sunburst -- and `.t-resize` tweens that too, so
          the whole card moves as one thing instead of snapping to a new height under a
          picture that was already there. */}
      <Reveal key={state.chart} className="chartslot">
        {state.chart === "sun" ? <Sunburst /> : <Mosaic />}
      </Reveal>
      {/* The chart switch lives at the foot of the card, on the footnote's rule: it picks
          the whole picture, so it sits below the picture rather than crowding the
          breadcrumb, which addresses one block inside it. */}
      <div className="cardfoot">
        <HoverBar />
        <Seg options={CHARTS} value={state.chart} onPick={pickChart} nosnap />
      </div>
    </>
  )
}

/** How the card's header describes the dataset: what the report covers, said in the eyebrow
 *  beside the words that are there whether or not a file has been dropped. */
export function scopeOf(d: Dataset): string {
  return [
    `${d.sessions} sessions`,
    d.days ? `${d.days} days` : null,
    `${count(d.requests)} requests`,
  ]
    .filter(Boolean)
    .join(" · ")
}
