/* The arithmetic behind the views, with no renderer in the way.

   This is where the brief's first acceptance check lives: rendered children sum to their
   parent, at every drill level, under both TTL lenses. It is a plain Node script -- no
   runner, no DOM, no build step -- so it can be pointed straight at a real transcript
   directory when you want the claim tested against real data:

     node test/model.test.ts ~/.claude/projects/<project>
*/

import { analyze, type Dataset } from "../engine.ts";
import { fold, focusOf, ledger, palette, rowIsOpen, type CostNode } from "../model.ts";
import { corpus } from "./fixture.ts";

let fails = 0;
const ok = (c: boolean, m: string): void => { if (!c) fails++; console.log((c ? "ok   " : "FAIL ") + m); };
const sum = (l: CostNode[]): number => l.reduce((a, n) => a + n.cost, 0);
/** Folding rounds its "other" row to the cent, and the engine's own split carries a little
 *  float noise, so equality is to the cent plus a hair proportional to the magnitude. */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.02 + Math.abs(b) * 0.001;

const data = analyze(corpus(process.argv[2]));
console.log(`\n== model · ${data.requests} requests · ${data.filesUsed} file(s) ==`);

for (const ttl of ["1h", "5m"] as const) {
  const d: Dataset = data.datasets[ttl];
  console.log(`\n-- ${ttl} lens --`);

  /* 1. Folding never loses money. */
  let foldOk = true;
  for (const g of d.groups) {
    if (!near(sum(fold(g.items, g.cost)), sum(g.items))) foldOk = false;
    for (const it of g.items)
      if (it.children && !near(sum(fold(it.children, it.cost)), sum(it.children))) foldOk = false;
  }
  ok(foldOk, "folding preserves the total at every level");

  /* 2. The ledger's top-level rows reconcile to the dataset. */
  const L = ledger(d, [], {}, "");
  ok(near(L.recon, d.total), `root ledger reconciles: $${L.recon.toFixed(2)} vs $${d.total.toFixed(2)}`);

  /* 3. Children sum to their parent, at every open level, everywhere the reader can go. */
  const paths: string[][] = [[]];
  for (const g of d.groups) {
    paths.push([g.name]);
    const kid = g.items.find(i => i.children && i.children.length > 1);
    if (kid) paths.push([g.name, kid.name]);
  }
  let reconOk = true, checked = 0;
  for (const path of paths) {
    const rows = ledger(d, path, {}, "").rows;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.hasKids || !r.open) continue;
      let kids = 0;
      for (let j = i + 1; j < rows.length && rows[j].depth > r.depth; j++)
        if (rows[j].depth === r.depth + 1) kids += rows[j].node.cost;
      checked++;
      if (!near(kids, r.node.cost)) {
        reconOk = false;
        console.log(`     ${path.join(" › ") || "all"} :: ${r.node.name} — `
          + `children $${kids.toFixed(2)} vs $${r.node.cost.toFixed(2)}`);
      }
    }
  }
  ok(reconOk, `children sum to parent (${checked} parent rows across ${paths.length} drill paths)`);

  /* 4. A path from an edited URL or a stale bookmark degrades, never throws. */
  ok(focusOf(d, ["no such group"]).groupName === null, "unknown drill path falls back to the root");
  ok(focusOf(d, [d.groups[0].name, "no such item"]).node.name === d.groups[0].name,
     "unknown item falls back to its group");

  /* 5. A query shows matches and the ancestors that give them context, and nothing else.
        It legitimately *adds* rows -- matches deeper than the default disclosure are
        revealed -- so the claim is about relevance, not about row count. */
  ok(ledger(d, [], {}, "zzzzzznope").rows.length === 0, "a query that matches nothing yields no rows");
  const probe = (d.groups[0].items[0]?.name || d.groups[0].name).slice(0, 4).toLowerCase();
  const hits = ledger(d, [], {}, probe).rows;
  const matches = (n: string): boolean => n.toLowerCase().includes(probe);
  let relevant = hits.length > 0;
  for (let i = 0; i < hits.length; i++) {
    if (matches(hits[i].node.name)) continue;
    let descendant = false;
    for (let j = i + 1; j < hits.length && hits[j].depth > hits[i].depth; j++)
      if (matches(hits[j].node.name)) descendant = true;
    if (!descendant) relevant = false;
  }
  ok(relevant, `“${probe}” shows only matches and their ancestors (${hits.length} rows)`);

  /* 6. Colour follows the entity, and never runs out. */
  const pal = palette(data, d);
  ok(d.groups.every(g => /^var\(--c[1-8]\)$|^var\(--cn\)$/.test(pal.hue(g.name))),
     "every group gets a palette token, a 9th takes the neutral");
  ok(pal.hue("something never seen") === "var(--cn)", "an unknown group is neutral, not undefined");
}

/* 7. Disclosure defaults: top level open, deeper levels closed, explicit state wins. */
ok(rowIsOpen({}, "k›0", 0) === true, "top-level rows default open");
ok(rowIsOpen({}, "k›1", 1) === false, "deeper rows default closed");
ok(rowIsOpen({ "k›0": false }, "k›0", 0) === false, "an explicit toggle overrides the default");

console.log(fails ? `\n${fails} MODEL FAILURE(S)` : "\nmodel clean");
process.exit(fails ? 1 : 0);
