/* Panels: one card per line item, with its own children ranked inside. The alternate to
   the mosaic rather than a peer of it -- same data, sorted and labelled instead of packed,
   for when you want to read names rather than compare areas. */

import { useReport } from "./context.ts";
import { fold, maxCost, pctOf, type CostNode } from "./model.ts";
import { hoverBind } from "./Mosaic.tsx";

function Panel({ panel, gname, maxPanel, kids }: {
  panel: CostNode; gname: string; maxPanel: number; kids: CostNode[];
}): React.JSX.Element {
  const { state, pal, amt, reqs, drill } = useReport();
  const h = pal.hue(gname);
  const key = gname + "›" + panel.name;
  const dim = !!state.hover && !state.hover.key.startsWith(key);
  const maxKid = maxCost(kids);

  /* Two different footers, and the difference matters: a panel with no children is a
     genuine leaf, while one whose children sum short of it has been filtered by the query
     and must say so rather than appear to under-count. */
  const kidsAll = panel.items || panel.children || [];
  const shown = kids.reduce((a, k) => a + k.cost, 0);
  const foot = !kidsAll.length
    ? "single line item · no further breakdown"
    : (Math.abs(shown - panel.cost) < 0.01 ? "" : `shown: ${amt(shown)} of ${amt(panel.cost)}`);

  return (
    <div className="pan">
      <div className="pantop">
        <button type="button" style={{ borderBottom: `2px solid ${h}`, opacity: dim ? 0.55 : 1 }}
          onClick={() => drill(panel.name)}
          {...hoverBind({ key, name: panel.name, cost: panel.cost, under: null, group: gname })}>
          {panel.name}
        </button>
        <span className="pc">{amt(panel.cost)}</span>
      </div>
      <div className="panbar">
        <span className="track">
          <span style={{ width: `${Math.max(pctOf(panel.cost, maxPanel), 0.8)}%`,
                         background: h, opacity: dim ? 0.5 : 1 }} />
        </span>
        <span className="pr">
          {state.pctOnly ? `${amt(panel.cost)} of bill` : `$${(panel.cost / reqs).toFixed(4)}/req`}
        </span>
      </div>
      <div className="panitems">
        {kids.map(k => {
          const kk = key + "›" + k.name;
          const active = state.hover?.key === kk;
          return (
            <div className="pi" key={kk} data-on={active ? 1 : 0}
              {...hoverBind({ key: kk, name: k.name, cost: k.cost, under: panel.name, group: gname })}>
              <button type="button" data-folded={k.folded ? 1 : 0} onClick={() => drill(panel.name)}>
                {k.name}
              </button>
              <span className="tk">
                <span style={{ width: `${Math.max(pctOf(k.cost, maxKid), 1)}%`,
                               background: h, opacity: active ? 1 : 0.6 }} />
              </span>
              <span className="pv">{amt(k.cost)}</span>
            </div>
          );
        })}
      </div>
      {foot ? <div className="panfoot">{foot}</div> : null}
    </div>
  );
}

export function Panels(): React.JSX.Element {
  const { d, focus, state } = useReport();
  const q = state.query.trim().toLowerCase();
  const rootCost = focus.node.cost || 1;

  /* At the root the nine groups are shown whole -- they are the page's spine, and folding
     one away would hide a role rather than a long tail. Below the root, fold as usual. */
  const src: CostNode[] = focus.groupName
    ? fold(focus.node.items || [], rootCost)
    : d.groups.slice().sort((a, b) => b.cost - a.cost);
  const maxPanel = maxCost(src);

  const panels = src.map(p => {
    const kids = fold(p.items || p.children || [], p.cost)
      .filter(k => !q || k.name.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    return { p, kids };
  }).filter(({ kids }) => !q || kids.length);

  return (
    <div className="panels">
      {panels.map(({ p, kids }) => (
        <Panel key={p.name} panel={p} gname={focus.groupName || p.name}
               maxPanel={maxPanel} kids={kids} />
      ))}
    </div>
  );
}
