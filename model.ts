/* The report's view model: everything that turns an `Analysis` into the rows, columns and
   numbers the components draw, with no React and no DOM in sight.

   It lives apart from the components on purpose. Folding, drill-down and the ledger walk
   are where the arithmetic that has to reconcile actually happens, and keeping them as
   plain functions means they can be asserted directly -- `node test/model.test.ts` runs
   this file with no renderer, no DOM and no test runner between the assertion and the
   code. */

import type { Analysis, Dataset, GroupId } from "./engine.ts";

/* Every level of the tree -- group, item, child, and the synthetic "other" row folding
   produces -- is drawn by the same components, so they share one shape. The engine's
   TreeGroup / TreeItem / TreeChild all satisfy it structurally; `folded` and `self` mark
   the two nodes this file synthesises. */
export interface CostNode {
  name: string;
  cost: number;
  items?: CostNode[];
  children?: CostNode[] | null;
  folded?: boolean;
  self?: boolean;
  id?: GroupId;
  short?: string;
}

/** Rows below this share of their parent, or past this rank, fold into one labelled
 *  "other". The threshold is relative so it holds for a $3 session and a $3,000 quarter. */
export const FOLD_MIN = 0.008;
export const FOLD_MAX = 14;

/** Percentage of a maximum, guarded. Every row in a group can legitimately round to $0.00
 *  on a small dataset, which makes the group maximum 0 and any bare v/max a NaN that lands
 *  straight in a style attribute. */
export const pctOf = (v: number, max: number): number => (max > 0 && v >= 0) ? v / max * 100 : 0;

export const maxCost = (list: CostNode[] | null | undefined): number =>
  (list && list.length) ? Math.max(...list.map(x => x.cost || 0)) : 0;

export const money = (n: number): string =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const count = (n: number): string => n.toLocaleString("en-US");

/** Keep the top items, fold the tail into one labelled row. Nothing is dropped. */
export function fold(list: CostNode[] | null | undefined, parentCost: number, noFold?: boolean): CostNode[] {
  if (!list || !list.length) return [];
  const sorted = list.slice().sort((a, b) => b.cost - a.cost);
  if (noFold) return sorted;
  const keep: CostNode[] = [], rest: CostNode[] = [];
  sorted.forEach((n, i) => ((i < FOLD_MAX && n.cost >= parentCost * FOLD_MIN) ? keep : rest).push(n));
  if (rest.length) keep.push({
    name: `other (${rest.length} items)`,
    cost: +rest.reduce((s, n) => s + n.cost, 0).toFixed(2), children: null, folded: true,
  });
  return keep;
}

/** A node is only worth opening if it actually branches. Drilling into a single-child
 *  group renders one full-width 100% block, which reads as broken. */
export function branches(node: CostNode | null | undefined): boolean {
  const k = (node && (node.items || node.children)) || [];
  return k.length > 1 || (k.length === 1 && ((k[0].items || k[0].children) || []).length > 1);
}

/** The same question, answered with the list: the children worth drawing as a level of
 *  their own, or null. A lone child that does not itself branch is the parent restated
 *  under a second name -- the fused preamble row is the standing case -- so every view
 *  treats such a node as the leaf it is instead of repeating it at 100%. Routing all four
 *  views through one predicate is what keeps the mosaic's flat column, the sunburst's
 *  missing ring, the panel's "no further breakdown" and the ledger's absent chevron from
 *  ever disagreeing about which rows are worth opening. */
export function kidsOf(node: CostNode | null | undefined): CostNode[] | null {
  if (!node || !branches(node)) return null;
  return node.items || node.children || null;
}

/* ---------- palette ---------- */

/** Colour follows the group's stable ID from the engine, in the engine's declared order --
 *  so a group keeps its hue when you drill in, switch view or change the TTL lens, and a
 *  dataset containing tools this file has never heard of still colours consistently. The
 *  palette caps at 8 hues; a 9th group takes a deliberate neutral rather than an invented
 *  colour. Display names and short labels come from the engine too, so nothing here needs
 *  a table of the tools or commands one particular person happens to use. */
export interface Palette {
  hue(group: string | null | undefined): string;
  short(name: string): string | undefined;
}

export function palette(data: Analysis, d: Dataset): Palette {
  const hues = new Map<string, string>(), shorts = new Map<string, string>();
  const order = (data.groupDefs || []).map(g => g.id);
  (d.groups || []).forEach(g => {
    const i = order.indexOf(g.id);
    hues.set(g.name, (i >= 0 && i < 8) ? `var(--c${i + 1})` : "var(--cn)");
    if (g.short) shorts.set(g.name, g.short);
  });
  return {
    hue: g => (g && hues.get(g)) || "var(--cn)",
    short: name => shorts.get(name),
  };
}

/* ---------- drill-down ---------- */

export interface Focus {
  node: CostNode;
  groupName: string | null;
}

/** The subtree the page is currently focused on, from a breadcrumb path of at most two
 *  levels. An unknown name in the path falls back to the level above rather than throwing,
 *  because the path can arrive from a URL hash someone edited or a stale bookmark. */
export function focusOf(d: Dataset, path: string[]): Focus {
  let node: CostNode = { name: "all", cost: d.total, items: d.groups };
  let group: CostNode | null = null;
  if (path[0]) {
    const g = d.groups.find(x => x.name === path[0]);
    if (g) { group = g; node = { name: g.name, cost: g.cost, items: g.items }; }
    if (path[1] && group) {
      const it = (group.items || []).find(x => x.name === path[1]);
      if (it) node = { name: it.name, cost: it.cost, items: it.children || [] };
    }
  }
  return { node, groupName: group ? group.name : null };
}

/* ---------- sunburst ---------- */

/** One node's slice of the circle. Angles are degrees clockwise from twelve o'clock, so a
 *  component has only to turn them into a path -- where the rings sit and how thick they are
 *  is a layout decision and stays out of here. */
export interface SunArc {
  key: string;
  name: string;
  cost: number;
  /** 0 is the innermost ring. */
  ring: number;
  a0: number;
  a1: number;
  under: string | null;
}

/** An innermost sector and everything beneath it. Grouped this way because a branch is also
 *  the unit of re-render: hovering an arc changes the highlight of its own branch and no
 *  other, which is the same bargain the mosaic's columns make. */
export interface SunBranch {
  key: string;
  name: string;
  group: string;
  cost: number;
  /** Line items under this sector *before* folding, so the legend can say how many there
   *  really are rather than how many survived the fold. */
  items: number;
  /** True for the synthetic tail row: it stands for many line items, and saying it has none
   *  underneath would read as "this is one thing" when it is the opposite. */
  folded: boolean;
  arcs: SunArc[];
}

export const SUN_RINGS = 3;

/** A sector thinner than this many degrees is not subdivided. Its children would be
 *  sub-pixel hairlines: impossible to see, worse to point at. Nothing is dropped -- the
 *  sector still carries their cost, and the table still lists them. */
export const SUN_MIN_SPLIT = 4;

/** Each node's share of the sweep it sits in. Every row can legitimately round to $0.00 on
 *  a small dataset, and dividing by that sum would draw an empty circle where there are
 *  real line items -- so a level that costs nothing measurable is split evenly instead. It
 *  is the same bargain as the mosaic's floor on column width: a $0.00 line item is still a
 *  line item, and the reader has to be able to see it to click into it. */
function shareIn(list: CostNode[]): (cost: number) => number {
  const total = list.reduce((s, n) => s + n.cost, 0);
  return total > 0 ? (c => c / total) : (() => 1 / (list.length || 1));
}

/** Lay the focused subtree out as nested rings. Each ring exactly tiles the one inside it,
 *  which is the property that makes the picture readable as shares: an arc's sweep is its
 *  share of the whole circle, at every depth. */
export function sunburst(focus: Focus, rings: number = SUN_RINGS): SunBranch[] {
  const top = fold(focus.node.items || [], focus.node.cost || 1, !focus.groupName);
  const share = shareIn(top);
  const out: SunBranch[] = [];
  let at = 0;

  for (const n of top) {
    /* Colour is the group's, at every depth -- the whole branch is one hue getting lighter
       outward, so a ring reads as "more detail about this" and not as new information. */
    const group = focus.groupName || n.name;
    const arcs: SunArc[] = [];

    const walk = (node: CostNode, ring: number, a0: number, span: number,
                  key: string, under: string | null): void => {
      arcs.push({ key, name: node.name, cost: node.cost, ring, a0, a1: a0 + span, under });
      if (ring + 1 >= rings || span < SUN_MIN_SPLIT) return;
      const kids = fold(kidsOf(node) || [], node.cost);
      if (!kids.length) return;
      /* Scaled by what the children actually sum to, so the ring fills its parent's sweep
         even where rounding leaves the two a cent apart. */
      const kidShare = shareIn(kids);
      let a = a0;
      for (const k of kids) {
        const s = kidShare(k.cost) * span;
        walk(k, ring + 1, a, s, key + "›" + k.name, node.name);
        a += s;
      }
    };

    const span = share(n.cost) * 360;
    walk(n, 0, at, span, group + "›" + n.name, null);
    at += span;
    out.push({
      key: group + "›" + n.name, name: n.name, group, cost: n.cost,
      items: (kidsOf(n) || []).length, folded: !!n.folded, arcs,
    });
  }
  return out;
}

/* ---------- ledger ---------- */

export interface LedgerRow {
  node: CostNode;
  depth: number;
  group: string | null;
  key: string;
  open: boolean;
  hasKids: boolean;
  /** The hover key for this row, built the way the charts build theirs: `group›item` for a
   *  top-level row and `group›item›child` below it. One store feeds the highlight in every
   *  view, so a row and its block in the mosaic have to name the same thing -- with the group
   *  alone in front of the name, a child row named nothing on the chart at all, and hovering
   *  it lit its parent column by accident of a prefix match. */
  hkey: string;
  /** What this row hangs under, or null at the top level. The readout says "git › git diff"
   *  rather than "git diff" for the same reason the chart's blocks do. */
  under: string | null;
}

export interface Ledger {
  rows: LedgerRow[];
  recon: number;
  rootCost: number;
}

/** Whether a ledger row is open, given the reader's toggles. Depth-0 rows default to open
 *  so the breakdown is visible without a click; the toggle handler asks the same question
 *  before inverting, which is why it is a function and not an inline ternary. */
export const rowIsOpen = (open: Record<string, boolean>, key: string, depth: number): boolean =>
  open[key] !== undefined ? open[key] : depth === 0;

/** Flatten the focused subtree into ledger rows, honouring open state and the query.
 *  `recon` is what the footer reconciles: the sum of the top-level rows, or of the matched
 *  rows when a query is active. */
export function ledger(d: Dataset, path: string[], open: Record<string, boolean>, query: string): Ledger {
  const at = focusOf(d, path);
  const q = query.trim().toLowerCase();
  const rows: LedgerRow[] = [];
  let recon = 0;

  const walk = (list: CostNode[], depth: number, inherit: string | null,
                parent: string | null): void => {
    const parentCost = list.reduce((s, n) => s + n.cost, 0) || 1;
    fold(list, parentCost, depth === 0 && !at.groupName).forEach(n => {
      const g = (depth === 0 && !at.groupName) ? n.name : inherit;
      const kids = kidsOf(n);
      const key = g + "›" + n.name + "›" + depth;
      /* The disclosure key above is this table's own and carries the depth; the hover key is
         shared with the charts and carries the path, which is why they are not one string. */
      const hkey = parent ? `${g}›${parent}›${n.name}` : `${g}›${n.name}`;
      const match = !q || n.name.toLowerCase().includes(q);
      const kidMatch = kids ? kids.some(k => k.name.toLowerCase().includes(q)
        || (k.children || []).some(c => c.name.toLowerCase().includes(q))) : false;
      if (q && !match && !kidMatch) return;
      const isOpen = q ? (kidMatch || (match && depth === 0)) : rowIsOpen(open, key, depth);
      if (q) { if (match && !(kids && kids.length && isOpen)) recon += n.cost; }
      else if (depth === 0) recon += n.cost;
      rows.push({ node: n, depth, group: g, key, open: isOpen, hasKids: !!(kids && kids.length),
                  hkey, under: parent });
      if (kids && kids.length && isOpen) walk(kids, depth + 1, g, n.name);
    });
  };

  walk(at.node.items || [], 0, at.groupName, null);
  return { rows, recon: +recon.toFixed(2), rootCost: at.node.cost || 1 };
}

/* ---------- the post ---------- */

/** How long a post can be before the composer starts refusing it. Nothing written here is
 *  close to it, but a group name is a heading someone else's transcript decides the length
 *  of, so the ceiling is enforced rather than assumed. */
export const POST_MAX = 280;

/** X bills a link at 23 characters however long it is, so the ceiling is measured the way
 *  the composer measures it rather than on the raw string. */
export const postLength = (s: string): number =>
  s.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;

/** How a group is said out loud. The chart's names are column headings -- "Tools · content
 *  read in" -- and a heading dropped into a sentence reads as a spreadsheet. A post is a
 *  sentence, so each group gets a phrase. Anything unmapped falls back to the heading. */
const SAID: Partial<Record<GroupId, string>> = {
  shell: "shell commands",
  ingest: "what tools read into the context",
  emit: "what tools wrote back out",
  twoway: "tool traffic, both directions",
  output: "the model's own output",
  preamble: "the system prompt and tool schemas",
  harness: "harness scaffolding and reminders",
  media: "images and attachments",
  typed: "the part I actually typed",
};

/** Programs a caption is allowed to name out loud.
 *
 *  This is not a classifier, and it is not the list-of-things-one-author-uses that the
 *  engine refuses to keep: nothing is grouped, priced or drilled by it, and a program's
 *  absence costs it nothing but a mention. It answers a question the engine never has to
 *  ask -- which names are safe to *publish*. An item name comes from the reader's own shell
 *  history, so it can be an internal CLI, a client's tool, or a deploy script with a
 *  hostname in it, and a caption that quotes one hands it to everyone who reads the post.
 *  These give nothing away. Anything else still counts, still charts, and is simply never
 *  said by name. */
export const PUBLIC_PROGS = new Set([
  "awk", "bash", "cargo", "cat", "cp", "curl", "diff", "docker", "du", "echo", "find", "gh",
  "git", "go", "grep", "head", "jq", "kubectl", "ls", "make", "mkdir", "mv", "node", "npm",
  "pnpm", "psql", "python", "python3", "rg", "rm", "rsync", "ruby", "rustc", "sed", "sh",
  "sort", "ssh", "tail", "tar", "terraform", "touch", "tr", "uniq", "wc", "which", "xargs",
  "yarn", "zsh",
]);

/** Tools a caption may name out loud, for the same reason and with a sharper edge: an MCP
 *  tool is displayed as `server · tool`, and the server is the reader's own -- often the
 *  employer's name, or a product that has not shipped. These are the harness's own tools,
 *  which every reader already has. A split row keeps its ` · results` / ` · call args`
 *  suffix when it is said, but is vouched for by the tool underneath it. */
export const PUBLIC_TOOLS = new Set([
  "Agent", "Bash", "BashOutput", "Edit", "ExitPlanMode", "Glob", "Grep", "KillShell",
  "MultiEdit", "NotebookEdit", "NotebookRead", "Read", "SlashCommand", "Task", "TodoWrite",
  "WebFetch", "WebSearch", "Write",
]);

/** What a leaf is vouched for by, ignoring the direction suffix the engine adds when a tool
 *  earns two rows. Shell items are program names; everything else in a tool-shaped group is
 *  a tool display name. */
export const vouched = (gid: GroupId, name: string): boolean =>
  gid === "shell" ? PUBLIC_PROGS.has(name)
                  : PUBLIC_TOOLS.has(name.replace(/ · (results|call args)$/, ""));

/** A share said the way a caption needs it. The figures worth posting here are often well
 *  under one percent -- "0% of it was me typing" is not the joke -- so a small share keeps a
 *  decimal that a large one has no use for. */
const share = (cost: number, total: number): string => {
  const p = pctOf(cost, total);
  return (p > 0 && p < 1 ? p.toFixed(1) : p.toFixed(0)) + "%";
};

/** What every caption draws on, gathered once so the variants below are only sentences.
 *
 *  `amt` and `outOf` are the masked lens in one place: a reader who covered the dollars to
 *  share their screen has said they do not want the total published, and a variant that
 *  had to remember that itself would eventually forget. */
interface Facts {
  d: Dataset;
  masked: boolean;
  scope: string;
  /** Nameable leaves from the tool-shaped groups, biggest first. Vouched, and item names
   *  only -- never a child, which for a shell row is the full command line the reader ran. */
  tools: CostNode[];
  /** The shell half of the same list: programs, biggest first. */
  progs: CostNode[];
  typed: CostNode | null;
  /** How many times the model's prose was re-billed as input for every dollar spent
   *  generating it. 0 when there is no prose either side to compare. */
  carry: number;
  amt: (cost: number) => string;
  outOf: (cost: number) => string;
  /** Whether a figure survives being formatted. Both lenses round, and a real line item can
   *  round to `$0.00` or `0%` on a single session -- which is true, and says nothing. A
   *  caption built on one reads as broken rather than as cheap, so the variants that would
   *  quote it stand aside instead. Asked of the formatted string rather than of a threshold,
   *  so it cannot drift away from whatever `amt` actually prints. */
  sayable: (cost: number) => boolean;
}

function factsOf(d: Dataset, pctOnly: boolean): Facts {
  const amt = (cost: number): string => pctOnly ? share(cost, d.total) : money(cost);
  const sayable = (cost: number): boolean => /[1-9]/.test(amt(cost));

  const leaves = (...ids: GroupId[]): CostNode[] =>
    d.groups.filter(g => ids.includes(g.id))
      .flatMap(g => (g.items as CostNode[]).filter(n => vouched(g.id, n.name)))
      .filter(n => sayable(n.cost))
      .sort((a, b) => b.cost - a.cost);

  const { proseGen, proseCarry } = d.insights;
  return {
    d,
    masked: pctOnly,
    scope: d.days ? `${d.days} day${d.days === 1 ? "" : "s"}`
                  : `${count(d.sessions)} session${d.sessions === 1 ? "" : "s"}`,
    tools: leaves("shell", "ingest", "emit", "twoway"),
    progs: leaves("shell"),
    typed: d.groups.find(g => g.id === "typed") as CostNode | undefined || null,
    carry: proseGen > 0 && proseCarry > 0 ? proseCarry / proseGen : 0,
    amt,
    sayable,
    outOf: (cost) => pctOnly ? `${share(cost, d.total)} of it`
                             : `${money(cost)} of ${money(d.total)}`,
  };
}

/** One caption: the body, and the verb that introduces the link.
 *
 *  `lines` is ordered by what has to survive. The first is the hook, which is what X shows
 *  before the fold and is never cut; anything after it is dropped from the end until the
 *  post fits, because a trailing claim is the one part the image already makes on its own.
 *  The link is never a candidate -- an invitation that got truncated is just a boast. */
interface Draft {
  lines: string[];
  cta: string;
}

/** The variants, each returning null when the data cannot support it honestly rather than
 *  printing a hole. They open with a question because a question gets answered: a reply
 *  costs the reader nothing and carries a post further than a like does.
 *
 *  What is being posted either way is one developer's own working week -- what their tools
 *  pulled in, what the model thought about, what they typed. The picture is the evidence
 *  and carries the figures; the text gets the one number worth stopping on and the ask. */
const VARIANTS: ((f: Facts) => Draft | null)[] = [
  /* A. The tool question. Viable whenever anything tool-shaped cost money, which is every
        transcript that ran a single command -- so this is the general case, and it names a
        leaf rather than a group because "shell commands, 32%" is a category and "git, $334"
        is a punchline. */
  (f) => {
    const [a, b] = f.tools;
    if (!a) return null;
    /* Covered, the scope has nowhere good to sit: "12% of it over 31 days" reads as a rate
       rather than as a share of one bill, and the image carries the span anyway. */
    const mine = f.masked ? `Mine's ${a.name}, at ${f.amt(a.cost)} of the bill.`
                          : `Mine's ${a.name}, at ${f.outOf(a.cost)} over ${f.scope}.`;
    return {
      lines: [
        "What's the most expensive tool on your Claude Code bill?",
        b ? `${mine} Second was ${b.name}, at ${f.amt(b.cost)}.` : mine,
      ],
      cta: "Find yours",
    };
  },

  /* B. The commands nobody prices. The escalation is the joke, so it wants two names at
        least; with one it is just a number, which variant A already tells better. */
  (f) => {
    if (f.progs.length < 2) return null;
    const [a, ...rest] = f.progs.slice(0, 3);
    return {
      lines: [
        `Guess what ${a.name} costs you in Claude Code.`,
        (f.masked ? `Mine was ${f.amt(a.cost)} of my bill. `
                  : `Mine was ${f.amt(a.cost)} over ${f.scope}. `)
          + rest.map(n => `${n.name} was ${f.amt(n.cost)}.`).join(" "),
        "Every command's output sits in your context and gets re-billed on every turn after it.",
      ],
      cta: "Yours",
    };
  },

  /* C. The agent framing, and the one that is always viable: it asks nothing of the shape
        of the tree, so there is never a dataset with no caption to pick. */
  (f) => ({
    lines: [
      "What's your AI agent actually costing you?",
      `Mine: ${f.masked || !f.sayable(f.d.total) ? "" : `${money(f.d.total)} over `}`
        + `${f.scope} and ${count(f.d.requests)} requests.`
        + (f.typed && /[1-9]/.test(share(f.typed.cost, f.d.total))
            ? ` I typed ${share(f.typed.cost, f.d.total)} of it.` : ""),
    ],
    cta: "Itemise yours",
  }),

  /* D. The self-own. It needs the reader's typing to actually be the small number -- on a
        transcript where they did most of the talking the line is true but no longer funny,
        and a joke that lands wrong reads as a lie about the chart underneath it. */
  (f) => {
    if (!f.typed || !f.sayable(f.typed.cost) || pctOf(f.typed.cost, f.d.total) >= 5) return null;
    return {
      lines: [
        "Quick — what's the biggest line on your Claude Code bill?",
        `It isn't what you type. That was ${f.outOf(f.typed.cost)}.`,
        "The rest is rent on context you never see.",
      ],
      cta: "See yours",
    };
  },

  /* E. Generation against carry, which is this page's whole thesis in one ratio. Below 2×
        there is no reframe to offer, so it stands aside for one of the others. */
  (f) => {
    if (f.carry < 2) return null;
    const { proseGen, proseCarry } = f.d.insights;
    const times = `${f.carry.toFixed(0)}×`;
    return {
      lines: [
        "Which costs more in Claude Code: what the model writes, or what it re-reads?",
        f.masked || !f.sayable(proseGen)
          ? `Mine: re-reading its own prose cost ${times} what writing it did.`
          : `Mine: ${money(proseGen)} to write. ${money(proseCarry)} to re-read the same `
            + `prose on later turns. ${times}.`,
      ],
      cta: "Check yours",
    };
  },

  /* F. The receipt: a statement where the others ask, so the rotation is not five questions
        in a trench coat. It is the only one that names a group rather than a leaf, which
        makes it the answer for a transcript that ran no tools at all -- and the number leads,
        because a digit in the first column survives every preview crop X applies. */
  (f) => {
    const top = f.d.groups[0];
    if (!top || !(f.d.total > 0)) return null;
    const heading = SAID[top.id] || top.name.toLowerCase();
    const said = heading.length > 44 ? heading.slice(0, 43).trimEnd() + "…" : heading;
    return {
      lines: [
        f.masked || !f.sayable(f.d.total)
          ? `Itemised ${f.scope} of my Claude Code bill.`
          : `${money(f.d.total)} of Claude Code over ${f.scope}, itemised.`,
        `Biggest line: ${said}, ${share(top.cost, f.d.total)} of it.`,
        "You don't pay for what the model writes — you pay rent on your context.",
      ],
      cta: "Show me yours",
    };
  },
];

/** A draft as the composer will receive it, trimmed to fit.
 *
 *  `home` is where a reader can run their own, and is dropped when there is nowhere to point
 *  -- a page opened from disk has an address that means nothing to anyone else, so it gets
 *  no link rather than a dead one, and the call to action goes with it. */
function assemble(draft: Draft, home?: string | null): string {
  const link = home ? [`${draft.cta}: ${home}`] : [];
  for (let keep = draft.lines.length; keep > 1; keep--) {
    const out = [...draft.lines.slice(0, keep), ...link].join("\n\n");
    if (postLength(out) <= POST_MAX) return out;
  }
  /* Nothing left to drop: the hook itself is over the ceiling, which takes a leaf name long
     enough that no sentence built around it would have fitted. Cut the name, not the link. */
  const [hook] = draft.lines;
  const room = POST_MAX - (link.length ? postLength(link[0]) + 2 : 0);
  return [hook.slice(0, Math.max(0, room - 1)).trimEnd() + "…", ...link].join("\n\n");
}

/** Every caption this dataset can honestly carry, in a stable order. Exported so the tests
 *  can hold all of them to the ceiling and to the mask, rather than whichever one a random
 *  draw happened to return. */
export function postVariants(d: Dataset, pctOnly: boolean, home?: string | null): string[] {
  const f = factsOf(d, pctOnly);
  return VARIANTS.map(v => v(f)).filter((x): x is Draft => x !== null)
    .map(draft => assemble(draft, home));
}

/** The caption that travels with the shared image, drawn at random from the ones this
 *  dataset supports.
 *
 *  Random because the post is meant to spread, and a timeline that has seen the same
 *  sentence four times stops reading it -- the variant is the difference between a format
 *  and a template. `pick` is a fraction of the way through the list, taken as an argument so
 *  that this file stays as testable as the rest of it: nothing else here needs a seed, and a
 *  function that reaches for `Math.random` on its own cannot be asserted about. */
export function postText(d: Dataset, pctOnly: boolean, home?: string | null,
                         pick: number = Math.random()): string {
  const all = postVariants(d, pctOnly, home);
  const i = Math.min(all.length - 1, Math.max(0, Math.floor(pick * all.length)));
  return all[i];
}
