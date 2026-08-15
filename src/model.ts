/* The report's view model: everything that turns an `Analysis` into the rows, columns and
   numbers the components draw, with no React and no DOM in sight. */

import type { Analysis, Dataset, GroupId } from "./engine.ts"
import { lang, tag, type Lang } from "./i18n.ts"
import { postCopy, type PostCopy } from "./post-copy.ts"

/* Every level of the tree -- group, item, child, and the synthetic "other" row folding produces
   -- is drawn by the same components, so they share one shape. */
export interface CostNode {
  name: string
  cost: number
  items?: CostNode[]
  children?: CostNode[] | null
  folded?: boolean
  /** How many rows the folded tail stands for. */
  foldCount?: number
  self?: boolean
  id?: GroupId
  short?: string
}

/** Rows below this share of their parent, or past this rank, fold into one labelled "other". */
export const FOLD_MIN = 0.008
export const FOLD_MAX = 14

/** Percentage of a maximum, guarded. */
export const pctOf = (v: number, max: number): number => (max > 0 && v >= 0 ? (v / max) * 100 : 0)

export const maxCost = (list: CostNode[] | null | undefined): number =>
  list && list.length ? Math.max(...list.map((x) => x.cost || 0)) : 0

/* Both formatters ask `i18n` for the current tag rather than taking one, because they are called
   by name from inside JSX at some fifteen sites and threading a language through all of them
   would put a fact about the toolbar into the arithmetic. */
const fmt = (digits: number): Intl.NumberFormat =>
  new Intl.NumberFormat(tag(), {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

export const money = (n: number): string => fmt(2).format(n)

/** The same, at the precision the per-request figures want. */
export const moneyFine = (n: number, digits: number): string => fmt(digits).format(n)

export const count = (n: number): string => n.toLocaleString(tag())

/** Keep the top items, fold the tail into one labelled row. */
export function fold(
  list: CostNode[] | null | undefined,
  parentCost: number,
  noFold?: boolean,
): CostNode[] {
  if (!list || !list.length) return []
  const sorted = list.slice().sort((a, b) => b.cost - a.cost)
  if (noFold) return sorted
  const keep: CostNode[] = [],
    rest: CostNode[] = []
  sorted.forEach((n, i) => (i < FOLD_MAX && n.cost >= parentCost * FOLD_MIN ? keep : rest).push(n))
  if (rest.length)
    keep.push({
      /* The name is an identifier here, not a label: it keys the hover, the view-transition name
         and the drill path, all of which have to survive a change of language. */
      name: "other",
      cost: +rest.reduce((s, n) => s + n.cost, 0).toFixed(2),
      children: null,
      folded: true,
      foldCount: rest.length,
    })
  return keep
}

/** A node is only worth opening if it actually branches. */
export function branches(node: CostNode | null | undefined): boolean {
  const k = (node && (node.items || node.children)) || []
  return k.length > 1 || (k.length === 1 && (k[0].items || k[0].children || []).length > 1)
}

/** The same question, answered with the list: the children worth drawing as a level of their
 *  own, or null. */
export function kidsOf(node: CostNode | null | undefined): CostNode[] | null {
  if (!node || !branches(node)) return null
  return node.items || node.children || null
}

/* palette */

/** Colour follows the group's stable ID from the engine, in the engine's declared order -- so a
 *  group keeps its hue when you drill in, switch view or change the TTL lens, and a dataset
 *  containing tools this file has never heard of still colours consistently. */
export interface Palette {
  hue(group: string | null | undefined): string
  short(name: string): string | undefined
}

export function palette(data: Analysis, d: Dataset): Palette {
  const hues = new Map<string, string>(),
    shorts = new Map<string, string>()
  const order = (data.groupDefs || []).map((g) => g.id)
  ;(d.groups || []).forEach((g) => {
    const i = order.indexOf(g.id)
    hues.set(g.name, i >= 0 && i < 8 ? `var(--c${i + 1})` : "var(--cn)")
    if (g.short) shorts.set(g.name, g.short)
  })
  return {
    hue: (g) => (g && hues.get(g)) || "var(--cn)",
    short: (name) => shorts.get(name),
  }
}

/* drill-down */

export interface Focus {
  node: CostNode
  groupName: string | null
}

/** The subtree the page is currently focused on, from a breadcrumb path of at most two levels. */
export function focusOf(d: Dataset, path: string[]): Focus {
  let node: CostNode = { name: "all", cost: d.total, items: d.groups }
  let group: CostNode | null = null
  if (path[0]) {
    const g = d.groups.find((x) => x.name === path[0])
    if (g) {
      group = g
      node = { name: g.name, cost: g.cost, items: g.items }
    }
    if (path[1] && group) {
      const it = (group.items || []).find((x) => x.name === path[1])
      if (it) node = { name: it.name, cost: it.cost, items: it.children || [] }
    }
  }
  return { node, groupName: group ? group.name : null }
}

/* sunburst */

/** One node's slice of the circle. */
export interface SunArc {
  key: string
  name: string
  cost: number
  /** 0 is the innermost ring. */
  ring: number
  a0: number
  a1: number
  under: string | null
}

/** An innermost sector and everything beneath it. */
export interface SunBranch {
  key: string
  name: string
  group: string
  cost: number
  /** Line items under this sector *before* folding, so the legend can say how many there really
   *  are rather than how many survived the fold. */
  items: number
  /** True for the synthetic tail row: it stands for many line items, and saying it has none
   *  underneath would read as "this is one thing" when it is the opposite. */
  folded: boolean
  arcs: SunArc[]
}

export const SUN_RINGS = 3

/** A sector thinner than this many degrees is not subdivided. */
export const SUN_MIN_SPLIT = 4

/** Each node's share of the sweep it sits in. */
function shareIn(list: CostNode[]): (cost: number) => number {
  const total = list.reduce((s, n) => s + n.cost, 0)
  return total > 0 ? (c) => c / total : () => 1 / (list.length || 1)
}

/** Lay the focused subtree out as nested rings. */
export function sunburst(focus: Focus, rings: number = SUN_RINGS): SunBranch[] {
  const top = fold(focus.node.items || [], focus.node.cost || 1, !focus.groupName)
  const share = shareIn(top)
  const out: SunBranch[] = []
  let at = 0

  for (const n of top) {
    /* Colour is the group's, at every depth -- the whole branch is one hue getting lighter
       outward, so a ring reads as "more detail about this" and not as new information. */
    const group = focus.groupName || n.name
    const arcs: SunArc[] = []

    const walk = (
      node: CostNode,
      ring: number,
      a0: number,
      span: number,
      key: string,
      under: string | null,
    ): void => {
      arcs.push({ key, name: node.name, cost: node.cost, ring, a0, a1: a0 + span, under })
      if (ring + 1 >= rings || span < SUN_MIN_SPLIT) return
      const kids = fold(kidsOf(node) || [], node.cost)
      if (!kids.length) return
      /* Scaled by what the children actually sum to, so the ring fills its parent's sweep even
         where rounding leaves the two a cent apart. */
      const kidShare = shareIn(kids)
      let a = a0
      for (const k of kids) {
        const s = kidShare(k.cost) * span
        walk(k, ring + 1, a, s, key + "›" + k.name, node.name)
        a += s
      }
    }

    const span = share(n.cost) * 360
    walk(n, 0, at, span, group + "›" + n.name, null)
    at += span
    out.push({
      key: group + "›" + n.name,
      name: n.name,
      group,
      cost: n.cost,
      items: (kidsOf(n) || []).length,
      folded: !!n.folded,
      arcs,
    })
  }
  return out
}

/* ledger */

export interface LedgerRow {
  node: CostNode
  depth: number
  group: string | null
  key: string
  open: boolean
  hasKids: boolean
  /** The hover key for this row, built the way the charts build theirs: `group›item` for a
   *  top-level row and `group›item›child` below it. */
  hkey: string
  /** What this row hangs under, or null at the top level. */
  under: string | null
}

export interface Ledger {
  rows: LedgerRow[]
  recon: number
  rootCost: number
}

/** Whether a ledger row is open, given the reader's toggles. */
export const rowIsOpen = (open: Record<string, boolean>, key: string, depth: number): boolean =>
  open[key] !== undefined ? open[key] : depth === 0

/** Flatten the focused subtree into ledger rows, honouring open state and the query. */
export function ledger(
  d: Dataset,
  path: string[],
  open: Record<string, boolean>,
  query: string,
): Ledger {
  const at = focusOf(d, path)
  const q = query.trim().toLowerCase()
  const rows: LedgerRow[] = []
  let recon = 0

  const walk = (
    list: CostNode[],
    depth: number,
    inherit: string | null,
    parent: string | null,
  ): void => {
    const parentCost = list.reduce((s, n) => s + n.cost, 0) || 1
    fold(list, parentCost, depth === 0 && !at.groupName).forEach((n) => {
      const g = depth === 0 && !at.groupName ? n.name : inherit
      const kids = kidsOf(n)
      const key = g + "›" + n.name + "›" + depth
      /* The disclosure key above is this table's own and carries the depth; the hover key is
         shared with the charts and carries the path, which is why they are not one string. */
      const hkey = parent ? `${g}›${parent}›${n.name}` : `${g}›${n.name}`
      const match = !q || n.name.toLowerCase().includes(q)
      const kidMatch = kids
        ? kids.some(
            (k) =>
              k.name.toLowerCase().includes(q) ||
              (k.children || []).some((c) => c.name.toLowerCase().includes(q)),
          )
        : false
      if (q && !match && !kidMatch) return
      const isOpen = q ? kidMatch || (match && depth === 0) : rowIsOpen(open, key, depth)
      if (q) {
        if (match && !(kids && kids.length && isOpen)) recon += n.cost
      } else if (depth === 0) recon += n.cost
      rows.push({
        node: n,
        depth,
        group: g,
        key,
        open: isOpen,
        hasKids: !!(kids && kids.length),
        hkey,
        under: parent,
      })
      if (kids && kids.length && isOpen) walk(kids, depth + 1, g, n.name)
    })
  }

  walk(at.node.items || [], 0, at.groupName, null)
  return { rows, recon: +recon.toFixed(2), rootCost: at.node.cost || 1 }
}

/* the post */

/** How long a post can be before the composer starts refusing it. */
export const POST_MAX = 280

/** The characters X counts double: CJK ideographs, kana, hangul and the fullwidth forms. */
const WIDE = /[ᄀ-ᇿ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

/** X bills a link at 23 characters however long it is, so the ceiling is measured the way the
 *  composer measures it rather than on the raw string. */
export const postLength = (s: string): number =>
  [...s.replace(/https?:\/\/\S+/g, "x".repeat(23))].reduce(
    (n, ch) => n + (WIDE.test(ch) ? 2 : 1),
    0,
  )

/** Programs a caption is allowed to name out loud. */
export const PUBLIC_PROGS = new Set([
  "awk",
  "bash",
  "cargo",
  "cat",
  "cp",
  "curl",
  "diff",
  "docker",
  "du",
  "echo",
  "find",
  "gh",
  "git",
  "go",
  "grep",
  "head",
  "jq",
  "kubectl",
  "ls",
  "make",
  "mkdir",
  "mv",
  "node",
  "npm",
  "pnpm",
  "psql",
  "python",
  "python3",
  "rg",
  "rm",
  "rsync",
  "ruby",
  "rustc",
  "sed",
  "sh",
  "sort",
  "ssh",
  "tail",
  "tar",
  "terraform",
  "touch",
  "tr",
  "uniq",
  "wc",
  "which",
  "xargs",
  "yarn",
  "zsh",
])

/** Tools a caption may name out loud, for the same reason and with a sharper edge: an MCP tool
 *  is displayed as `server · tool`, and the server is the reader's own -- often the employer's
 *  name, or a product that has not shipped. */
export const PUBLIC_TOOLS = new Set([
  "Agent",
  "Bash",
  "BashOutput",
  "Edit",
  "ExitPlanMode",
  "Glob",
  "Grep",
  "KillShell",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "Read",
  "SlashCommand",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
])

/** What a leaf is vouched for by, ignoring the direction suffix the engine adds when a tool
 *  earns two rows. */
export const vouched = (gid: GroupId, name: string): boolean =>
  gid === "shell"
    ? PUBLIC_PROGS.has(name)
    : PUBLIC_TOOLS.has(name.replace(/ · (results|call args)$/, ""))

/** A share said the way a caption needs it. */
const share = (cost: number, total: number): string => {
  const p = pctOf(cost, total)
  return (p > 0 && p < 1 ? p.toFixed(1) : p.toFixed(0)) + "%"
}

/** What every caption draws on, gathered once so the variants below are only sentences. */
export interface Facts {
  d: Dataset
  masked: boolean
  /** The sentences, in the language the page is currently in. */
  c: PostCopy
  scope: string
  /** Nameable leaves from the tool-shaped groups, biggest first. */
  tools: CostNode[]
  /** The shell half of the same list: programs, biggest first. */
  progs: CostNode[]
  typed: CostNode | null
  /** How many times the model's prose was re-billed as input for every dollar spent generating
   *  it. */
  carry: number
  amt: (cost: number) => string
  outOf: (cost: number) => string
  /** Whether a figure survives being formatted. */
  sayable: (cost: number) => boolean
}

function factsOf(d: Dataset, pctOnly: boolean, l: Lang): Facts {
  const c = postCopy(l)
  const amt = (cost: number): string => (pctOnly ? share(cost, d.total) : money(cost))
  const sayable = (cost: number): boolean => /[1-9]/.test(amt(cost))

  const leaves = (...ids: GroupId[]): CostNode[] =>
    d.groups
      .filter((g) => ids.includes(g.id))
      .flatMap((g) => (g.items as CostNode[]).filter((n) => vouched(g.id, n.name)))
      .filter((n) => sayable(n.cost))
      .sort((a, b) => b.cost - a.cost)

  const { proseGen, proseCarry } = d.insights
  return {
    d,
    masked: pctOnly,
    c,
    scope: d.days ? c.scopeDays(d.days) : c.scopeSessions(d.sessions, count(d.sessions)),
    tools: leaves("shell", "ingest", "emit", "twoway"),
    progs: leaves("shell"),
    typed: (d.groups.find((g) => g.id === "typed") as CostNode | undefined) || null,
    carry: proseGen > 0 && proseCarry > 0 ? proseCarry / proseGen : 0,
    amt,
    sayable,
    outOf: (cost) =>
      pctOnly ? c.outOfMasked(share(cost, d.total)) : c.outOf(money(cost), money(d.total)),
  }
}

/** One caption: the body, and the verb that introduces the link. */
export interface Draft {
  lines: string[]
  cta: string
}

/** The variants, each returning null when the data cannot support it honestly rather than
 *  printing a hole. */
const VARIANTS: ((f: Facts) => Draft | null)[] = [
  /* A. The tool question. */
  (f) => {
    const [a, b] = f.tools
    if (!a) return null
    /* Covered, the scope has nowhere good to sit: "12% of it over 31 days" reads as a rate
       rather than as a share of one bill, and the image carries the span anyway. */
    return f.c.a({
      name: a.name,
      amt: f.amt(a.cost),
      outOf: f.outOf(a.cost),
      scope: f.scope,
      masked: f.masked,
      second: b ? b.name : null,
      secondAmt: b ? f.amt(b.cost) : "",
    })
  },

  /* B. The commands nobody prices. */
  (f) => {
    if (f.progs.length < 2) return null
    const [a, ...rest] = f.progs.slice(0, 3)
    return f.c.b({
      name: a.name,
      amt: f.amt(a.cost),
      scope: f.scope,
      masked: f.masked,
      rest: rest.map((n) => ({ name: n.name, amt: f.amt(n.cost) })),
    })
  },

  /* C. The agent framing, and the one that is always viable: it asks nothing of the shape of the
     tree, so there is never a dataset with no caption to pick. */
  (f) => {
    const typedShare = f.typed ? share(f.typed.cost, f.d.total) : null
    return f.c.c({
      total: f.masked || !f.sayable(f.d.total) ? null : money(f.d.total),
      scope: f.scope,
      requests: count(f.d.requests),
      typedShare: typedShare && /[1-9]/.test(typedShare) ? typedShare : null,
    })
  },

  /* D. The self-own. */
  (f) => {
    if (!f.typed || !f.sayable(f.typed.cost) || pctOf(f.typed.cost, f.d.total) >= 5) return null
    return f.c.d({ outOf: f.outOf(f.typed.cost) })
  },

  /* E. Generation against carry, which is this page's whole thesis in one ratio. */
  (f) => {
    if (f.carry < 2) return null
    const { proseGen, proseCarry } = f.d.insights
    const open = !f.masked && f.sayable(proseGen)
    return f.c.e({
      times: `${f.carry.toFixed(0)}×`,
      gen: open ? money(proseGen) : null,
      carry: open ? money(proseCarry) : "",
    })
  },

  /* F. The receipt: a statement where the others ask, so the rotation is not five questions in a
     trench coat. */
  (f) => {
    const top = f.d.groups[0]
    if (!top || !(f.d.total > 0)) return null
    const heading = f.c.said[top.id] || top.name.toLowerCase()
    return f.c.f({
      total: f.masked || !f.sayable(f.d.total) ? null : money(f.d.total),
      scope: f.scope,
      said: heading.length > 44 ? heading.slice(0, 43).trimEnd() + "…" : heading,
      share: share(top.cost, f.d.total),
    })
  },
]

/** A draft as the composer will receive it, trimmed to fit. */
function assemble(draft: Draft, home?: string | null): string {
  const link = home ? [`${draft.cta}: ${home}`] : []
  for (let keep = draft.lines.length; keep > 1; keep--) {
    const out = [...draft.lines.slice(0, keep), ...link].join("\n\n")
    if (postLength(out) <= POST_MAX) return out
  }
  /* Nothing left to drop: the hook itself is over the ceiling, which takes a leaf name long
     enough that no sentence built around it would have fitted. */
  const [hook] = draft.lines
  const room = POST_MAX - (link.length ? postLength(link[0]) + 2 : 0)
  return [hook.slice(0, Math.max(0, room - 1)).trimEnd() + "…", ...link].join("\n\n")
}

/** Every caption this dataset can honestly carry, in a stable order. */
export function postVariants(
  d: Dataset,
  pctOnly: boolean,
  home?: string | null,
  /** Which language to write them in. */
  l: Lang = lang(),
): string[] {
  const f = factsOf(d, pctOnly, l)
  return VARIANTS.map((v) => v(f))
    .filter((x): x is Draft => x !== null)
    .map((draft) => assemble(draft, home))
}

/** The caption that travels with the shared image, drawn at random from the ones this dataset
 *  supports. */
export function postText(
  d: Dataset,
  pctOnly: boolean,
  home?: string | null,
  pick: number = Math.random(),
  l: Lang = lang(),
): string {
  const all = postVariants(d, pctOnly, home, l)
  const i = Math.min(all.length - 1, Math.max(0, Math.floor(pick * all.length)))
  return all[i]
}
