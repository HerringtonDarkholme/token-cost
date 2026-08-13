/* The report itself: header, thesis strip, mosaic, breakdown, footnotes.

   One subscription to the view state at the top, one context down. A change to the view --
   lens, drill, query, units -- re-renders from here, and React diffs it to the handful of
   attributes that actually moved. Hover is the exception: it arrives dozens of times a
   second and is read from its own store slice by the few components that draw a highlight,
   so a pointer sweep does not re-render the header, the footnotes and the ledger. They all
   still read the one hover key from the one place, which is what lets the mosaic, the
   panels and the table stay a single instrument. */

import { useCallback, useEffect, useMemo } from "react";
import type { Analysis } from "./engine.ts";
import { ReportContext, useReport, type ReportCtx } from "./context.ts";
import {
  branches, count, focusOf, FOLD_MIN, ledger, money, palette, pctOf, type Ledger,
} from "./model.ts";
import { hashFor, readHash, setHover, setState, useViewState, type ViewState } from "./store.ts";
import { Toolbar } from "./Toolbar.tsx";
import { HoverBar, Mosaic } from "./Mosaic.tsx";
import { Panels } from "./Panels.tsx";
import { Sunburst } from "./Sunburst.tsx";
import { LedgerTable, useReconNote } from "./Ledger.tsx";

/** The hash is the shareable view. Writing it is best-effort because `replaceState` can
 *  refuse on a `file://` page, which is how this is normally opened.
 *
 *  The effect keys on the hash *string*, not on the state object: most state changes do not
 *  reach the URL at all, and browsers rate-limit `replaceState` hard enough to start
 *  throwing if it is called on every one of them. */
function useUrlSync(state: ViewState): void {
  const hash = hashFor(state);
  useEffect(() => {
    try {
      history.replaceState(null, "", hash || location.pathname + location.search);
    } catch { /* file:// can refuse */ }
  }, [hash]);

  useEffect(() => {
    const onHash = (): void => setState(readHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
}

function Crumbs(): React.JSX.Element {
  const { state } = useReport();
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <button type="button" data-cur={state.path.length ? 0 : 1}
        onClick={() => { setHover(null); setState({ path: [] }); }}>all</button>
      {state.path.map((p, i) => (
        <span key={p}>
          <span className="sep">/</span>
          <button type="button" data-cur={i === state.path.length - 1 ? 1 : 0}
            onClick={() => { setHover(null); setState({ path: state.path.slice(0, i + 1) }); }}>{p}</button>
        </span>
      ))}
    </nav>
  );
}

/** The four figures that carry the thesis. Each is a mechanism the reader can check in
 *  their own numbers, not a headline figure that belongs to one dataset. */
function Strip(): React.JSX.Element {
  const { d, state, amt, reqs } = useReport();
  const I = d.insights;
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
          Written once, carried {I.proseGen > 0 ? (I.proseCarry / I.proseGen).toFixed(1) + "×" : "—"}
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
          {state.pctOnly ? pctOf(I.fixed, d.total).toFixed(1) + "%" : "$" + (I.fixed / reqs).toFixed(3)}
          <span className="sm"> of</span>{" "}
          <span className="dim">{state.pctOnly ? "the bill" : "$" + (d.total / reqs).toFixed(3)}</span>
        </div>
        <div className="cap">
          {state.pctOnly
            ? `Fixed, paid on all ${count(d.requests)} requests`
            : `Fixed, every request · ${money(I.fixed)}`}
        </div>
      </div>
    </div>
  );
}

function Breakdown({ L }: { L: Ledger }): React.JSX.Element {
  const { state, amt } = useReport();
  const note = useReconNote(L);
  return (
    <section className="bsec">
      <div className="bhead">
        <h2>Breakdown</h2>
        <div className="bctl">
          <label htmlFor="q">Find</label>
          <input id="q" type="search" value={state.query} placeholder="git diff, thinking, schema…"
                 onChange={e => setState({ query: e.target.value })} />
          <span className="seg">
            <button type="button" aria-pressed={state.view === "panels"}
              onClick={() => setState({ view: "panels" })}>Panels</button>
            <button type="button" aria-pressed={state.view === "table"}
              onClick={() => setState({ view: "table" })}>Table</button>
          </span>
        </div>
      </div>
      {state.view === "panels" ? <Panels /> : <LedgerTable L={L} />}
      <div className="reconline">
        <span>{note}</span>
        <span>Reconciled: <strong>{amt(L.recon)}</strong></span>
      </div>
    </section>
  );
}

function Footnotes(): React.JSX.Element {
  const { data, d, amt } = useReport();
  const I = d.insights;
  const lensGap = Math.abs(data.datasets["1h"].total - data.datasets["5m"].total);
  const density = data.density
    ? `${data.density.code.toFixed(2)} chars/token for machine text and `
      + `${data.density.text.toFixed(2)} for prose, `
      + (data.densityCalibrated ? "both measured from this dataset"
                                : "defaults, too few samples to measure")
    : "~4 chars/token";

  return (
    <section className="foot">
      <div>
        <h3>What to change on Monday</h3>
        <ul>
          <li><strong>Cut the intake, not the output.</strong> {amt(I.ingest)} of the bill is
            content tools pulled <em>into</em> context, against {amt(I.emit)} of arguments sent
            out and {amt(I.typed)} for everything you typed
            {I.typed > 0 ? ` (${(I.ingest / I.typed).toFixed(0)}× less)` : ""}. Tool output lands
            in the prefix whole and is re-billed until it falls out — ask for narrower slices.</li>
          <li><strong>Trim the preamble.</strong> {amt(I.fixed)} of fixed overhead is the only
            line you can delete once and stop paying {count(d.requests)} times.</li>
          <li><strong>Compact sooner.</strong> Carry cost is linear in how long a result
            survives, not in how big it looked.</li>
        </ul>
      </div>
      <div>
        <h3>Caveats</h3>
        <ul className="cav">
          <li>Cache writes bill at 2× input on a 1h TTL and 1.25× on 5m. Where the transcript
            records which applied, that is used verbatim; the switch only reprices what it
            omitted, which is why the two lenses differ by just {money(lensGap)} here.</li>
          <li>“Model output” exceeds output-token spend because prose written once is re-billed
            as input on every later request.</li>
          <li>Blocks under {(FOLD_MIN * 100).toFixed(1)}% of their parent are folded into a
            labelled “other”; nothing is dropped. Identity is carried by the table as well
            as by hue.</li>
          <li>Totals are exact; the split across line items is estimated from character counts
            at {density}.</li>
          <li>Cache-write TTL was recorded for {data.ttlMeasuredShare != null
            ? (data.ttlMeasuredShare * 100).toFixed(1) + "%" : "an unknown share"} of written
            tokens, so the lens above only reprices the remainder.
            {data.models && data.models.length
              ? ` Models: ${data.models.map(m => m.id).join(", ")}.` : ""}</li>
        </ul>
      </div>
    </section>
  );
}

export function Report({ data, onReset }: {
  data: Analysis; onReset: () => void;
}): React.JSX.Element {
  const state = useViewState();
  useUrlSync(state);

  const d = data.datasets[state.ttl];
  const reqs = d.requests || 1;

  /* Memoised so their *identity* survives a re-render, not because they are slow -- a ledger
     walk is microseconds. Stable nodes are what let the memoised columns, panels and rows
     below skip the re-render entirely when only a highlight moved. */
  const focus = useMemo(() => focusOf(d, state.path), [d, state.path]);
  const pal = useMemo(() => palette(data, d), [data, d]);
  const L = useMemo(
    () => ledger(d, state.path, state.open, state.query),
    [d, state.path, state.open, state.query]);

  const amt = useCallback<ReportCtx["amt"]>((cost, base) => {
    if (!state.pctOnly) return money(cost);
    const denom = base || d.total;
    const r = denom > 0 ? cost / denom * 100 : 0;
    return (r < 1 ? r.toFixed(2) : r.toFixed(1)) + "%";
  }, [state.pctOnly, d.total]);

  const drill = useCallback((name: string) => {
    const it = (focus.node.items || []).find(x => x.name === name);
    if (!branches(it)) return;                         // nothing to show one level down
    setHover(null);
    if (!focus.groupName) setState({ path: [name] });
    else if (state.path.length === 1) setState({ path: [focus.groupName, name] });
  }, [focus, state.path]);

  const ctx = useMemo<ReportCtx>(
    () => ({ data, d, state, pal, focus, reqs, amt, drill }),
    [data, d, state, pal, focus, reqs, amt, drill]);

  const scope = [`${d.sessions} sessions`, d.days ? `${d.days} days` : null,
                 `${count(d.requests)} requests`].filter(Boolean).join(" · ");

  return (
    <ReportContext.Provider value={ctx}>
      <div className="shell" onMouseLeave={() => setHover(null)}>
        <Toolbar onReset={onReset} />
        <section className="card" data-chart={state.chart}>
          <span className="br br1" /><span className="br br2" />
          <span className="br br3" /><span className="br br4" />
          <header className="chead">
            <div>
              <div className="eyebrow">Cost attribution · Claude Code · {scope}</div>
              <h1>Where the money went</h1>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="billed">
                Billed · {state.pctOnly ? "amount hidden · " : ""}{state.ttl} cache TTL
              </div>
              <div className="total" data-hidden={state.pctOnly ? 1 : 0}>
                {state.pctOnly ? <span className="mask">****</span> : money(d.total)}
              </div>
            </div>
          </header>
          <Strip />
          <div className="mosaichead">
            <span className="lbl">
              {state.chart === "sun"
                ? "Every line item · arc = share of the ring inside it · each ring one level deeper"
                : "Every line item · column width = share of bill · block height = share of column"}
            </span>
            <Crumbs />
          </div>
          {state.chart === "sun" ? <Sunburst /> : <Mosaic />}
          {/* The chart switch lives at the foot of the card, on the footnote's rule: it picks
              the whole picture, so it sits below the picture rather than crowding the
              breadcrumb, which addresses one block inside it. */}
          <div className="cardfoot">
            <HoverBar />
            <span className="seg">
              <button type="button" aria-pressed={state.chart === "mosaic"}
                onClick={() => setState({ chart: "mosaic" })}>Mosaic</button>
              <button type="button" aria-pressed={state.chart === "sun"}
                onClick={() => setState({ chart: "sun" })}>Sunburst</button>
            </span>
          </div>
        </section>
        <Breakdown L={L} />
        <Footnotes />
      </div>
    </ReportContext.Provider>
  );
}
