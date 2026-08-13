/* The sunburst: the same tree as the mosaic, wrapped into a circle.

   The mosaic answers "how big is this line item" by area on a common baseline, which is the
   honest comparison. This answers a different question — "how deep does the money go" — by
   putting the drill-down itself on screen: ring 0 is the line item, ring 1 the command or
   block inside it, ring 2 the level under that, each one a share of the arc it sits in. It
   is the same numbers, the same hues and the same hover store, so nothing here can disagree
   with the mosaic or the table about what a thing costs.

   Arcs are pictures, not controls: the legend beside the chart carries the real buttons, so
   the keyboard gets one tab stop per line item rather than three hundred, and the table view
   remains the exhaustive keyboard path into the deeper rings. */

import { memo, useMemo } from "react";
import { useReport } from "./context.ts";
import { pctOf, sunburst, type SunBranch } from "./model.ts";
import { hoverBind, setHover, setState, useHover } from "./store.ts";

/* Ring geometry, in the viewBox's own units: the box is 200 across and centred on the
   origin, so 100 is the outer edge. The hole is wide enough to hold the readout, which is
   what this chart uses instead of labelling arcs it has no room to label. */
const RINGS: Array<[number, number]> = [
  [37, 59],
  [59, 79],
  [79, 96],
];

const rad = (deg: number): number => ((deg - 90) * Math.PI) / 180;
const pt = (deg: number, r: number): string =>
  `${(Math.cos(rad(deg)) * r).toFixed(3)},${(Math.sin(rad(deg)) * r).toFixed(3)}`;

/** An annular wedge. A full turn has no gap to draw between its own start and end, so it is
 *  trimmed by a tenth of a degree — 1/3600 of the ring, well under a pixel at any size this
 *  renders at — rather than special-cased into a pair of half circles. */
function arcPath(a0: number, a1: number, r0: number, r1: number): string {
  const end = a1 - a0 >= 360 ? a0 + 359.9 : a1;
  const big = end - a0 > 180 ? 1 : 0;
  return (
    `M${pt(a0, r1)}A${r1},${r1} 0 ${big} 1 ${pt(end, r1)}` +
    `L${pt(end, r0)}A${r0},${r0} 0 ${big} 0 ${pt(a0, r0)}Z`
  );
}

/* Memoised on the same two primitives as the mosaic's columns, plus the query: `hit` is the
   hovered key when it lands in this branch and null when it does not. A pointer crossing an
   arc therefore redraws the branch entered and the branch left, not all nine. */
const Sector = memo(function Sector({
  branch,
  hit,
  anyHover,
  q,
}: {
  branch: SunBranch;
  hit: string | null;
  anyHover: boolean;
  q: string;
}): React.JSX.Element {
  const { pal, amt, drill } = useReport();
  const h = pal.hue(branch.group);

  return (
    <g>
      {branch.arcs.map((a) => {
        const [r0, r1] = RINGS[a.ring];
        /* Prose re-billed as input is the one arc the page argues about, so it keeps full
           strength and a dashed edge — the same mark the mosaic gives the same block. */
        const carry = a.name.includes("re-billed");
        /* An arc lights up with its own descendants, so hovering a leaf traces the path
           back to the centre instead of stranding it in a dimmed ring. */
        const on = hit === a.key || (!!hit && hit.startsWith(a.key + "›"));
        /* The query dims rather than filters: dropping arcs would leave a circle whose
           sweeps no longer read as shares of anything. */
        const miss = !!q && !a.key.toLowerCase().includes(q);
        const dim = (anyHover && !on) || miss;
        return (
          <g key={a.key}>
            <path
              className="sunarc"
              data-on={on ? 1 : 0}
              d={arcPath(a.a0, a.a1, r0, r1)}
              fill={h}
              opacity={dim ? 0.24 : on || carry ? 1 : 1 - a.ring * 0.14}
              onClick={() => drill(branch.name)}
              {...hoverBind({
                key: a.key,
                name: a.name,
                cost: a.cost,
                under: a.under,
                group: branch.group,
              })}
            >
              <title>{`${a.name} · ${amt(a.cost)}`}</title>
            </path>
            {carry && !on && !dim ? (
              <path className="suncarry" d={arcPath(a.a0 + 0.6, a.a1 - 0.6, r0 + 1.6, r1 - 1.6)} />
            ) : null}
          </g>
        );
      })}
    </g>
  );
});

/** The hole. It is the readout — hovered line item, its amount, its share — and falls back
 *  to the focused total, which is the number the ring around it adds up to. */
function Core({
  rootCost,
  label,
  kids,
}: {
  rootCost: number;
  label: string;
  kids: number;
}): React.JSX.Element {
  const { state, amt } = useReport();
  const h = useHover();
  const up = state.path.length > 0;

  const inner = h ? (
    <>
      <span className="k">{h.under ? h.under : h.group}</span>
      <span className="v">{amt(h.cost)}</span>
      <span className="s">
        {h.name}
        <br />
        <span className="dim">
          {pctOf(h.cost, rootCost).toFixed(pctOf(h.cost, rootCost) < 1 ? 2 : 1)}% of {label}
        </span>
      </span>
    </>
  ) : (
    <>
      <span className="k">{label}</span>
      <span className="v">{amt(rootCost)}</span>
      <span className="s">
        {kids} line items
        <br />
        <span className="dim">{up ? "click to go back" : "click a sector to drill in"}</span>
      </span>
    </>
  );

  return (
    <div className="suncore">
      {up ? (
        <button
          type="button"
          title="Back one level"
          onClick={() => {
            setHover(null);
            setState({ path: state.path.slice(0, -1) });
          }}
        >
          {inner}
        </button>
      ) : (
        <div>{inner}</div>
      )}
    </div>
  );
}

/* One row per innermost sector: the names the arcs have no room to carry. Memoised for the
   same reason the sectors are — a hover moves the highlight, it does not rebuild the list. */
const LegRow = memo(function LegRow({
  branch,
  hue,
  on,
  dim,
}: {
  branch: SunBranch;
  hue: string;
  on: boolean;
  dim: boolean;
}): React.JSX.Element {
  const { amt, drill } = useReport();
  const kids = branch.arcs.filter((a) => a.ring === 1);
  const note = branch.folded
    ? "the folded tail · shown whole, listed in the table"
    : branch.items
      ? `${branch.items} item${branch.items === 1 ? "" : "s"}` +
        (kids.length
          ? " · " +
            kids
              .slice(0, 2)
              .map((k) => `${k.name} ${amt(k.cost)}`)
              .join(" · ")
          : "")
      : "single line item · no further breakdown";

  return (
    <div
      className="legrow"
      data-on={on ? 1 : 0}
      data-dim={dim ? 1 : 0}
      {...hoverBind({
        key: branch.key,
        name: branch.name,
        cost: branch.cost,
        under: null,
        group: branch.group,
      })}
    >
      <span className="sw" style={{ background: hue }} />
      <button type="button" data-folded={branch.folded ? 1 : 0} onClick={() => drill(branch.name)}>
        {branch.name}
      </button>
      <span className="note">{note}</span>
      <span className="val">{amt(branch.cost)}</span>
    </div>
  );
});

export function Sunburst(): React.JSX.Element {
  const { focus, state, pal, amt } = useReport();
  const hover = useHover();
  const hk = hover?.key ?? null;
  const q = state.query.trim().toLowerCase();
  const rootCost = focus.node.cost || 1;

  /* Memoised for node identity, so a hover leaves the memoised sectors' props untouched.
     The layout walk is microseconds; what it buys is the arcs not being rebuilt. */
  const branches = useMemo(() => sunburst(focus), [focus]);

  const label = focus.node.name === "all" ? "the bill" : focus.node.name;
  if (!branches.length) return <div className="sunempty">No further breakdown under {label}.</div>;

  return (
    <div className="sun">
      <div className="sunchart">
        <svg
          viewBox="-100 -100 200 200"
          role="img"
          aria-label={
            `Sunburst: ${branches.length} line items totalling ${amt(rootCost)}, ` +
            "each ring a share of the one inside it"
          }
        >
          {/* Sits under the arcs and catches everything they do not cover -- the margin
              outside the outer ring, the corners of the box -- so sliding off an arc into
              empty space is a pointer arriving somewhere unmarked, which is what drops the
              highlight. `pointer-events` is spelled out because an unfilled shape is not
              hit-tested, and an arrival nothing can see is an arrival nobody reports. */}
          <rect x={-100} y={-100} width={200} height={200} fill="none" pointerEvents="all" />
          {branches.map((b) => (
            <Sector
              key={b.name}
              branch={b}
              q={q}
              anyHover={!!hk}
              hit={hk && (hk === b.key || hk.startsWith(b.key + "›")) ? hk : null}
            />
          ))}
        </svg>
        <Core rootCost={rootCost} label={label} kids={branches.length} />
      </div>
      <div className="sunlegend">
        {branches.map((b) => {
          const on = hk === b.key || (!!hk && hk.startsWith(b.key + "›"));
          return (
            <LegRow
              key={b.name}
              branch={b}
              hue={pal.hue(b.group)}
              on={on}
              dim={
                (!!hk && !on) ||
                (!!q &&
                  !b.key.toLowerCase().includes(q) &&
                  !b.arcs.some((a) => a.key.toLowerCase().includes(q)))
              }
            />
          );
        })}
      </div>
    </div>
  );
}
