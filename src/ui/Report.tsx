/* The report's own parts: thesis strip, the picture, the breakdown, the footnotes. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Dataset } from "../core/engine.ts"
import { useReport } from "./context.ts"
import { labelOf, useT, type Dict } from "./copy.tsx"
import { count, FOLD_MIN, ledger, money, moneyFine, pctOf } from "../core/model.ts"
import { disarmHover, setState, useNarrow, type ViewState } from "./store.ts"
import { Seg, type SegOption } from "./Seg.tsx"
import { cssMs, Reveal, transition } from "./Motion.tsx"
import { HoverBar, Mosaic } from "./Mosaic.tsx"
import { Panels } from "./Panels.tsx"
import { Sunburst } from "./Sunburst.tsx"
import { LedgerTable, useReconNote } from "./Ledger.tsx"

/* No hints on these four: the words are the whole explanation. */
const views = (t: Dict): ReadonlyArray<SegOption<ViewState["view"]>> => [
  { value: "panels", label: t.chart.panels },
  { value: "table", label: t.chart.table },
]

const charts = (t: Dict): ReadonlyArray<SegOption<ViewState["chart"]>> => [
  { value: "mosaic", label: t.chart.mosaic },
  { value: "sun", label: t.chart.sunburst },
]

/* Written once rather than closed over per render: a pick is a write to the store, a module
   away. */
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
      {/* The crumb is a node name, English in the state so the link survives a change of language,
          translated here on the way out. */}
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

/** The thesis and the three figures that carry it, rendered in two places on a narrow window: the
 *  sentence stays under the bill, the figures go below the breakdown. `only` is which half this
 *  instance draws; unset, it draws both. */
export function Strip({ only }: { only?: "thesis" | "figures" }): React.JSX.Element {
  const { d, state, amt, reqs } = useReport()
  const t = useT()
  const I = d.insights
  if (only === "thesis")
    return (
      <div className="strip" data-only="thesis">
        <div>
          <div className="thesis">{t.strip.thesis}</div>
        </div>
      </div>
    )
  return (
    <div className="strip" data-only={only}>
      {only ? null : (
        <div>
          <div className="thesis">{t.strip.thesis}</div>
        </div>
      )}
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

/** The query box. */
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
      {/* The browser's suggestions are off because there is nothing here for them to be right
          about: this box filters the line items of one bill. Spellcheck goes with it -- the
          vocabulary is `mkdir`, `git diff` and tool names. */}
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
  /* Memoised for its identity rather than its cost: the memoised rows below want a stable `L`. */
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
          {data.filesSkipped ? <li>{t.foot.skippedCaveat(count(data.filesSkipped))}</li> : null}
          <li>{t.foot.ttlCaveat(money(lensGap))}</li>
          <li>{t.foot.outputCaveat}</li>
          <li>{t.foot.foldCaveat((FOLD_MIN * 100).toFixed(1) + "%")}</li>
          <li>{t.foot.densityCaveat(density)}</li>
          <li>
            {t.foot.ttlShareCaveat(
              data.ttlMeasuredShare != null
                ? (data.ttlMeasuredShare * 100).toFixed(1) + "%"
                : t.foot.unknownShare,
              /* Model ids are not words: they are what the API calls itself, in every language. */
              data.models && data.models.length ? data.models.map((m) => m.id).join(", ") : null,
            )}
          </li>
        </ul>
      </div>
    </section>
  )
}

/** What the card holds once there is a bill: the thesis, the picture, and the rules that frame
 *  it. */
export function CardBody(): React.JSX.Element {
  const { state } = useReport()
  const t = useT()
  /* The three figures leave the card at this width -- see `Strip`, and `Page`, where they land. */
  const narrow = useNarrow()
  return (
    <>
      <Strip only={narrow ? "thesis" : undefined} />
      <div className="mosaichead">
        <span className="lbl">
          {state.chart === "sun"
            ? t.chart.headSun
            : narrow
              ? t.chart.headMosaicRows
              : t.chart.headMosaic}
        </span>
        <Crumbs />
      </div>
      {/* Keyed on the chart, so the picture the switch asks for arrives rather than appearing. The
          frame changes shape at the same time -- 16/9 for the mosaic, 4/3 for the sunburst -- and
          `.t-resize` tweens that too, so the card moves as one thing. */}
      <Reveal key={state.chart} className="chartslot">
        {state.chart === "sun" ? <Sunburst /> : <Mosaic />}
      </Reveal>
      {/* The chart switch sits at the foot of the card: it picks the whole picture, unlike the
          breadcrumb, which addresses one block inside it. */}
      <div className="cardfoot">
        <HoverBar />
        <Seg options={charts(t)} value={state.chart} onPick={pickChart} nosnap />
      </div>
    </>
  )
}

/** How the card's header describes the dataset, in the eyebrow beside the words that are always
 *  there. */
export function scopeOf(t: Dict, d: Dataset): string {
  return t.card.scope(count(d.sessions), d.days, count(d.requests))
}
