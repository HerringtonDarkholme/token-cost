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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Dataset } from "./engine.ts"
import { useReport } from "./context.ts"
import { labelOf, useT, type Dict } from "./copy.tsx"
import { count, FOLD_MIN, ledger, money, moneyFine, pctOf } from "./model.ts"
import { disarmHover, setState, type ViewState } from "./store.ts"
import { Seg, type SegOption } from "./Seg.tsx"
import { cssMs, Reveal, transition } from "./Motion.tsx"
import { HoverBar, Mosaic } from "./Mosaic.tsx"
import { Panels } from "./Panels.tsx"
import { Sunburst } from "./Sunburst.tsx"
import { LedgerTable, useReconNote } from "./Ledger.tsx"

/* No hints on these four: the words are the whole explanation. Built per render, like the
   toolbar's, because the words move when the language does. */
const views = (t: Dict): ReadonlyArray<SegOption<ViewState["view"]>> => [
  { value: "panels", label: t.chart.panels },
  { value: "table", label: t.chart.table },
]

const charts = (t: Dict): ReadonlyArray<SegOption<ViewState["chart"]>> => [
  { value: "mosaic", label: t.chart.mosaic },
  { value: "sun", label: t.chart.sunburst },
]

/* Written once rather than closed over per render: a pick is a write to the store, which is a
   module away, so neither switch needs anything from the component around it.

   Both drop the highlight first, and neither lets the next one arrive until the pointer has
   moved -- see `disarmHover`. A switch replaces the whole picture under a pointer that is
   resting whereever it was left, so a highlight standing through one describes a block that is
   no longer there, and the arrival the browser reports when the new picture lands under the
   cursor describes nothing the reader did. Both are equally true of the legend beside the
   sunburst, the panels and the table's rows, which is why the rule lives in the store rather
   than in whichever view happened to notice it first. */
const pickView = (view: ViewState["view"]): void => {
  disarmHover()
  setState({ view })
}
const pickChart = (chart: ViewState["chart"]): void => {
  disarmHover()
  setState({ chart })
}

function Crumbs(): React.JSX.Element {
  const { state } = useReport()
  const t = useT()
  return (
    <nav className="crumbs" aria-label={t.chart.breadcrumb}>
      <button
        type="button"
        data-cur={state.path.length ? 0 : 1}
        onClick={() => {
          disarmHover()
          setState({ path: [] })
        }}
      >
        {t.chart.all}
      </button>
      {/* The crumb is a node name, which stays English in the state so the link keeps
          working across a change of language -- translated here, on the way out. */}
      {state.path.map((p, i) => (
        <span key={p}>
          <span className="sep">/</span>
          <button
            type="button"
            data-cur={i === state.path.length - 1 ? 1 : 0}
            onClick={() => {
              disarmHover()
              setState({ path: state.path.slice(0, i + 1) })
            }}
          >
            {labelOf(t, p)}
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
  const t = useT()
  const I = d.insights
  return (
    <div className="strip">
      <div>
        <div className="thesis">{t.strip.thesis}</div>
      </div>
      <div>
        <div className="carryrow">
          <span className="from">{amt(I.proseGen)}</span>
          <span className="arrow">→</span>
          <span className="to">{amt(I.proseCarry)}</span>
        </div>
        <div className="cap">
          {t.strip.carried(I.proseGen > 0 ? (I.proseCarry / I.proseGen).toFixed(1) + "×" : "—")}
        </div>
      </div>
      <div>
        <div className="big">
          {pctOf(d.input, d.total).toFixed(1)}% <span className="sm">/</span>{" "}
          <span className="dim">{pctOf(d.output, d.total).toFixed(1)}%</span>
        </div>
        <div className="cap">{t.strip.split(pctOf(I.thinking, d.total).toFixed(1) + "%")}</div>
      </div>
      <div>
        <div className="big">
          {state.pctOnly ? pctOf(I.fixed, d.total).toFixed(1) + "%" : moneyFine(I.fixed / reqs, 3)}
          <span className="sm">{t.strip.of}</span>{" "}
          <span className="dim">
            {state.pctOnly ? t.strip.theBill : moneyFine(d.total / reqs, 3)}
          </span>
        </div>
        <div className="cap">
          {state.pctOnly
            ? t.strip.fixedMasked(count(d.requests))
            : t.strip.fixedOpen(money(I.fixed))}
        </div>
      </div>
    </div>
  )
}

/** The query box.
 *
 *  What the reader types and what the breakdown is filtered by are the same string a beat
 *  apart, and the beat is the point. A view transition needs two settled states to travel
 *  between, and a keystroke is not a settled state: filtering on every one of them would be a
 *  transition started and thrown away five times a second, which is the jump it was supposed
 *  to replace with extra steps. So the box owns what is typed, the store owns what is
 *  filtered, and the store catches up once the typing stops.
 *
 *  `--find-settle` is short enough that the list still reads as following the keys rather than
 *  waiting for them -- a search box is expected to think for a moment, and this one then has
 *  something to show for it.
 *
 *  The store can also change the query without the box: a shared link seeds one, and "New
 *  analysis" clears it. `committed` is how the box tells that apart from its own echo -- the
 *  value it last sent is not news coming back. */
function Find(): React.JSX.Element {
  const { state } = useReport()
  const t = useT()
  const [typed, setTyped] = useState(state.query)
  const committed = useRef(state.query)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (state.query === committed.current) return
    committed.current = state.query
    setTyped(state.query)
  }, [state.query])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value
    setTyped(query)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(
      () => {
        committed.current = query
        transition(() => setState({ query }), { "data-filter": "" })
      },
      cssMs("--find-settle", 150),
    )
  }, [])

  return (
    <>
      <label htmlFor="q">{t.breakdown.find}</label>
      {/* The browser's own suggestions are off because there is nothing here for them to be
          right about: this box filters the line items of one bill, and what it offers instead
          is whatever the reader last typed into a box called `q` on some other site.
          Spellcheck goes with it -- the vocabulary is `mkdir`, `git diff` and tool names, and
          every one of them would be underlined as a mistake. */}
      <input
        id="q"
        type="search"
        value={typed}
        placeholder={t.breakdown.findPlaceholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={onChange}
      />
    </>
  )
}

export function Breakdown(): React.JSX.Element {
  const { d, state, amt } = useReport()
  const t = useT()
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
        <h2>{t.breakdown.title}</h2>
        <div className="bctl">
          <Find />
          <Seg options={views(t)} value={state.view} onPick={pickView} />
        </div>
      </div>
      <Reveal key={state.view}>
        {state.view === "panels" ? <Panels /> : <LedgerTable L={L} />}
      </Reveal>
      <div className="reconline">
        <span>{note}</span>
        <span>{t.breakdown.reconciledIs(amt(L.recon))}</span>
      </div>
    </section>
  )
}

export function Footnotes(): React.JSX.Element {
  const { data, d, amt } = useReport()
  const t = useT()
  const I = d.insights
  const lensGap = Math.abs(data.datasets["1h"].total - data.datasets["5m"].total)
  const density = data.density
    ? t.foot.densityMeasured(
        data.density.code.toFixed(2),
        data.density.text.toFixed(2),
        data.densityCalibrated,
      )
    : t.foot.densityFallback

  return (
    <section className="foot">
      <div>
        <h3>{t.foot.monday}</h3>
        <ul>
          <li>
            {t.foot.intake({
              ingest: amt(I.ingest),
              emit: amt(I.emit),
              typed: amt(I.typed),
              ratio: I.typed > 0 ? (I.ingest / I.typed).toFixed(0) : null,
            })}
          </li>
          <li>{t.foot.preamble(amt(I.fixed), count(d.requests))}</li>
          <li>{t.foot.compact}</li>
        </ul>
      </div>
      <div>
        <h3>{t.foot.caveats}</h3>
        <ul className="cav">
          <li>{t.foot.ttlCaveat(money(lensGap))}</li>
          <li>{t.foot.outputCaveat}</li>
          <li>{t.foot.foldCaveat((FOLD_MIN * 100).toFixed(1) + "%")}</li>
          <li>{t.foot.densityCaveat(density)}</li>
          <li>
            {t.foot.ttlShareCaveat(
              data.ttlMeasuredShare != null
                ? (data.ttlMeasuredShare * 100).toFixed(1) + "%"
                : t.foot.unknownShare,
              /* Model ids are not words -- they are what the API calls itself, and the same
                 string in every language. */
              data.models && data.models.length ? data.models.map((m) => m.id).join(", ") : null,
            )}
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
  const t = useT()
  return (
    <>
      <Strip />
      <div className="mosaichead">
        <span className="lbl">{state.chart === "sun" ? t.chart.headSun : t.chart.headMosaic}</span>
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
        <Seg options={charts(t)} value={state.chart} onPick={pickChart} nosnap />
      </div>
    </>
  )
}

/** How the card's header describes the dataset: what the report covers, said in the eyebrow
 *  beside the words that are there whether or not a file has been dropped. */
export function scopeOf(t: Dict, d: Dataset): string {
  return t.card.scope(count(d.sessions), d.days, count(d.requests))
}
