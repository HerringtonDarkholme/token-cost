/* Every word on the page, six times over. */

import { GROUPS } from "./engine.ts"
import { LANGS, type Lang } from "./i18n.ts"
import type { CostNode } from "./model.ts"
import { useViewState } from "./store.ts"

/** Which dialog the reader is about to meet. */
export type Os = "mac" | "win" | "linux"

/** One word of the card's heading, and the slot it occupies. */
export interface Word {
  w: string
  text: string
  em?: boolean
  /** No gap before this one. */
  tight?: boolean
}

const EN = {
  /* the toolbar */
  language: "Language",
  /** The bar folds into one button where there is no room for a row of them. */
  menu: { name: "Tools", close: "Close" },
  theme: {
    /** What the cycle picks, said in front of it where there is room for a word. */
    name: "Theme",
    light: "Light theme",
    system: "System theme",
    dark: "Dark theme",
    /** The hint on a control that shows one option and walks to the next: what pressing does,
     *  since which one is current is already the button's name. */
    cycle: (next: string): string => `Press to switch to: ${next}`,
  },
  ttl: {
    name: "Cache-write TTL",
    tip1h:
      "Cache writes the transcript did not label are priced as a 1h TTL, at 2× input. Press to assume 5m instead, at 1.25×.",
    tip5m:
      "Cache writes the transcript did not label are priced as a 5m TTL, at 1.25× input. Press to assume 1h instead, at 2×.",
  },
  mask: {
    name: "Hide dollar amounts",
    tipOn: "Show the dollars again",
    tipOff: "Cover every dollar figure, leaving shares of the bill — for sharing a screen",
  },
  reset: {
    name: "New analysis",
    tip: "Discard this report and pick different transcripts. Nothing was uploaded, so these numbers only exist in this page — they are gone once you do.",
  },
  share: {
    copy: "Copy chart",
    copyBusy: "Rendering…",
    copyDone: "Chart copied",
    copySaved: "Chart saved as a PNG",
    copyFailed: "Could not render the chart",
    to: "Share to",
    name: "Share to X",
    busy: "Rendering…",
    copied: "Image copied — paste it into the post",
    saved: "Image saved — attach it to the post",
    failed: "Could not render the image",
  },

  /* the card's header */
  card: {
    eyebrow: "Cost attribution · Claude Code",
    /** The browser tab, which the shell ships in English because the markup is written before
     *  anyone has guessed anything. */
    title: "Where the money went — Claude Code cost attribution",
    nothingYet: "Nothing dropped yet",
    /** Said in the eyebrow when the bill came from the example rather than from a folder. */
    example: "Example data",
    /** What goes between the heading's words: a space, or nothing in the scripts that set none. */
    gap: " ",
    billed: (ttl: string, masked: boolean): string =>
      `Billed · ${masked ? "amount hidden · " : ""}${ttl} cache TTL`,
    /** The question, before a folder has been dropped. */
    ask: [
      { w: "where", text: "Where" },
      { w: "did", text: "did" },
      { w: "your", text: "your" },
      { w: "money", text: "money", em: true },
      { w: "go", text: "go?" },
    ] as Word[],
    /** And the answer. */
    answer: [
      { w: "where", text: "Where" },
      { w: "your", text: "your" },
      { w: "money", text: "money", em: true },
      { w: "went", text: "went" },
    ] as Word[],
    scope: (sessions: string, days: number | null, requests: string): string =>
      [`${sessions} sessions`, days ? `${days} days` : null, `${requests} requests`]
        .filter(Boolean)
        .join(" · "),
  },

  /* the four figures that carry the thesis */
  strip: {
    thesis: (
      <>
        A <em>carry</em> bill, not a usage bill — every request re-bills the whole context.
      </>
    ),
    carried: (times: string): string => `Written once, carried ${times}`,
    split: (thinking: string): string => `Input vs output · thinking ${thinking}`,
    of: " of",
    theBill: "the bill",
    fixedMasked: (requests: string): string => `Fixed, paid on all ${requests} requests`,
    fixedOpen: (amount: string): string => `Fixed, every request · ${amount}`,
  },

  /* the picture, and the controls that pick it */
  chart: {
    panels: "Panels",
    table: "Table",
    mosaic: "Mosaic",
    sunburst: "Sunburst",
    breadcrumb: "Breadcrumb",
    all: "all",
    headMosaic: "Every line item · column width = share of bill · block height = share of column",
    /* The same two claims, for the narrow window where the chart is turned on its side. Both
       axes swap, so neither half of the sentence survives the rotation. */
    headMosaicRows: "Every line item · row height = share of bill · block width = share of row",
    headSun: "Every line item · arc = share of the ring inside it · each ring one level deeper",
    /* One line of the card's closing rule, in every language: the sentence that used to sit in
       the middle -- carry cost tracks survival, not size -- is the footnotes' `compact` note
       word for word, and saying it twice cost the German and the Japanese a second line. */
    hoverIdle: (gen: string, carry: string): string =>
      `Accented block = prose the model wrote once for ${gen}, re-billed as input for ${carry} more. ` +
      "Hover any block for its line item.",
    hoverLine: (name: string, amount: string, share: string, under: string): string =>
      `${name}   ${amount}   ${share} of ${under}`,
  },

  /* the sunburst's own furniture */
  sun: {
    back: "Back one level",
    goBack: "click to go back",
    drillIn: "click a sector to drill in",
    lineItems: (n: number): string => `${n} line items`,
    aria: (n: number, total: string): string =>
      `Sunburst: ${n} line items totalling ${total}, each ring a share of the one inside it`,
    empty: (label: string): string => `No further breakdown under ${label}.`,
    foldedNote: "the folded tail · shown whole, listed in the table",
    itemsNote: (n: number): string => `${n} item${n === 1 ? "" : "s"}`,
    leafNote: "single line item · no further breakdown",
    ofLabel: (share: React.ReactNode, label: string): React.ReactNode => (
      <>
        {share} of {label}
      </>
    ),
  },

  /* panels */
  panels: {
    leaf: "single line item · no further breakdown",
    shown: (shown: string, whole: string): string => `shown: ${shown} of ${whole}`,
    ofBill: (amount: string): string => `${amount} of bill`,
    perReq: (amount: string): string => `${amount}/req`,
  },

  /* the breakdown, and the table inside it */
  breakdown: {
    title: "Breakdown",
    find: "Find",
    findPlaceholder: "git diff, thinking, schema…",
    reconciled: "Reconciled",
    reconciledIs: (amount: React.ReactNode): React.ReactNode => (
      <>
        Reconciled: <strong>{amount}</strong>
      </>
    ),
    noteFiltered: (amount: string): string =>
      `Filtered view · ${amount} across matching line items, shown in their parents' context; ` +
      "parent rows keep their own full totals.",
    noteWhole: "Children sum to parent at every level; folded rows keep their full value.",
    noteGap: (gap: string): string => ` ${gap} of the billed total is unattributed rounding.`,
  },
  table: {
    lineItem: "Line item",
    cost: "Cost",
    share: "Share",
    magnitude: "Magnitude",
    perRequest: "Per request",
    shareOfBill: "Share of bill",
    matched: "Matched",
    noMatch: (query: string): string => `No line item matches “${query}”.`,
  },

  /* the footnotes */
  foot: {
    monday: "What to change on Monday",
    caveats: "Caveats",
    intake: (p: {
      ingest: string
      emit: string
      typed: string
      ratio: string | null
    }): React.ReactNode => (
      <>
        <strong>Cut the intake, not the output.</strong> {p.ingest} of the bill is content tools
        pulled <em>into</em> context, against {p.emit} of arguments sent out and {p.typed} for
        everything you typed
        {p.ratio ? ` (${p.ratio}× less)` : ""}. Tool output lands in the prefix whole and is
        re-billed until it falls out — ask for narrower slices.
      </>
    ),
    preamble: (fixed: string, requests: string): React.ReactNode => (
      <>
        <strong>Trim the preamble.</strong> {fixed} of fixed overhead is the only line you can
        delete once and stop paying {requests} times.
      </>
    ),
    compact: (
      <>
        <strong>Compact sooner.</strong> Carry cost is linear in how long a result survives, not in
        how big it looked.
      </>
    ),
    ttlCaveat: (gap: string): string =>
      "Cache writes bill at 2× input on a 1h TTL and 1.25× on 5m. Where the transcript records " +
      "which applied, that is used verbatim; the switch only reprices what it omitted, which is " +
      `why the two lenses differ by just ${gap} here.`,
    outputCaveat:
      "“Model output” exceeds output-token spend because prose written once is re-billed as input " +
      "on every later request.",
    foldCaveat: (pct: string): string =>
      `Blocks under ${pct} of their parent are folded into a labelled “other”; nothing is dropped. ` +
      "Identity is carried by the table as well as by hue.",
    densityCaveat: (density: string): string =>
      `Totals are exact; the split across line items is estimated from character counts at ${density}.`,
    densityMeasured: (code: string, text: string, calibrated: boolean): string =>
      `${code} chars/token for machine text and ${text} for prose, ` +
      (calibrated ? "both measured from this dataset" : "defaults, too few samples to measure"),
    densityFallback: "~4 chars/token",
    ttlShareCaveat: (share: string, models: string | null): string =>
      `Cache-write TTL was recorded for ${share} of written tokens, so the lens above only ` +
      "reprices the remainder." +
      (models ? ` Models: ${models}.` : ""),
    unknownShare: "an unknown share",
  },

  /* the empty card */
  intake: {
    heading: (folder: React.ReactNode): React.ReactNode => <>Drop your {folder} folder here</>,
    /** The heading on a device that probably cannot reach the folder. It says what the page does
     *  rather than what to do next: a reader who has not been told what this is cannot be sent
     *  anywhere. Where to go is the note at the foot of the card. */
    headingTouch: "Visualize your AI bill",
    lede: "Chart your AI bill: every tool, every subcommand, every dollar.",
    /** The same line with the heading's words taken out of it, since the heading above now says
     *  them -- and with where the numbers come from put in, which is the other half of what this
     *  page is. */
    ledeTouch: "Every tool, every subcommand, every dollar, read out of your Claude Code sessions.",
    choose: "Choose folder",
    /** The other way in, for a reader with no `~/.claude` to point at -- a phone, or a machine
     *  Claude Code has never run on. */
    example: "Try an example",
    hidden: "The folder is hidden",
    /** The help a phone gets in place of the keystrokes: the one step that gets this reader their
     *  own numbers. An instruction, not a claim about what the device has -- the page reads a
     *  pointer type, and cannot see whether the folder is there. */
    yours: "To chart your own",
    yoursBody: (
      <>
        Open this page on the machine you run Claude Code on, and point it at{" "}
        <code>~/.claude/projects</code>.
      </>
    ),
    osTip: (current: string, next: string): string =>
      `Not ${current}? Press for the ${next} route.`,
    reading: "Reading",
    privacy: "Parsed in this page · nothing is uploaded",
    /** One line per platform, and it is the keystrokes rather than prose about them: this is
     *  read with a file dialog already open on top of it. */
    how: {
      mac: (
        <>
          In the dialog press <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>.</kbd> to reveal hidden folders. Or <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>G</kbd> and paste <code>~/.claude/projects</code>.
        </>
      ),
      win: (
        <>
          Type <code>%USERPROFILE%\.claude\projects</code> into the dialog’s <em>Folder</em> box,
          press <kbd>Enter</kbd>.
        </>
      ),
      linux: (
        <>
          In the dialog press <kbd>Ctrl</kbd>
          <kbd>L</kbd>, type <code>~/.claude/projects</code>, press <kbd>Enter</kbd>.
        </>
      ),
    } as Record<Os, React.ReactNode>,
    errNothing: "No files selected.",
    errNoJsonl: (root: React.ReactNode): React.ReactNode => (
      <>
        {root} holds no <code>.jsonl</code> transcripts. Claude Code writes one per session, under{" "}
        <code>~/.claude/projects</code>.
      </>
    ),
    errLoose: (n: number): React.ReactNode => (
      <>
        None of those {n} file(s) are <code>.jsonl</code> transcripts.
      </>
    ),
    errRead: (message: string): string => `Could not read the files: ${message}`,
    errAnalysis: (message: string): string => `Analysis failed: ${message}`,
    errNoneBilled: (n: number, root: React.ReactNode | null): React.ReactNode => (
      <>
        Read {n} transcript{n > 1 ? "s" : ""} from {root ?? "that folder"}, and none of them holds a
        priced API request — nothing here has been billed.
      </>
    ),
    errNotClaude: (n: number, root: React.ReactNode | null): React.ReactNode => (
      <>
        Those {n} <code>.jsonl</code> file{n > 1 ? "s" : ""} hold no priced API request.{" "}
        {root ? <>{root} is not</> : "They did not come from"} <code>~/.claude/projects</code>,
        which is where Claude Code keeps its transcripts.
      </>
    ),
  },

  /* the help under the empty card */
  where: {
    handingOver: "What you are handing over",
    handingOverBody: (
      <>
        One <code>.jsonl</code> file per session, in one folder per project, under{" "}
        <code>~/.claude/projects/</code> — a dotfile, which is why every file picker hides it until
        you ask for it by name. Everything you pick is combined into a single report — the breakdown
        is by what spent the money, not by which folder it was spent in, so pick one project’s
        folder if that is the bill you want.
      </>
    ),
    terminal: "Prefer the terminal?",
    terminalBody: (
      <>
        Open the folder in your file manager, then drag it onto the card above:{" "}
        <code>open ~/.claude/projects</code>
      </>
    ),
    largest: (
      <>
        Largest projects first: <code>du -sh ~/.claude/projects/*/ | sort -rh | head</code>
      </>
    ),
    noUpload: "Nothing is uploaded",
    noUploadBody:
      "The files are read and the bill worked out in this page: there is no server to send a " +
      "transcript to, and the build fails if anything in here reaches the network. Save the page " +
      "and it works the same from disk.",
    linkTitle: "A shared link carries the view, not the bill",
    linkBody:
      "The address records which lens and which block you are looking at — never the numbers. " +
      "Whoever opens it gets an empty card and drops their own transcripts in.",
  },

  /* the names the engine puts in the tree ---------- Keyed by the English name, which stays in
     the data. */
  labels: {
    all: "all",
    other: "other",
    "Shell commands": "Shell commands",
    "Tools · content read in": "Tools · content read in",
    "Tools · content written out": "Tools · content written out",
    "Tools · two-way": "Tools · two-way",
    "Model output": "Model output",
    "System prompt & tool schemas": "System prompt & tool schemas",
    "Harness & reminders": "Harness & reminders",
    "Images & attachments": "Images & attachments",
    "My typing": "My typing",
    Shell: "Shell",
    "Read in": "Read in",
    "Written out": "Written out",
    "Two-way": "Two-way",
    Output: "Output",
    "System prompt": "System prompt",
    Harness: "Harness",
    Media: "Media",
    "system prompt + tool schemas": "system prompt + tool schemas",
    harness: "harness",
    "your typed messages": "your typed messages",
    thinking: "thinking",
    "assistant prose (generated)": "assistant prose (generated)",
    "tool-call arguments": "tool-call arguments",
    "assistant prose (re-billed as input)": "assistant prose (re-billed as input)",
    "thinking blocks (re-billed as input)": "thinking blocks (re-billed as input)",
    "(output)": "(output)",
    "(no command parsed)": "(no command parsed)",
    "(no path parsed)": "(no path parsed)",
  } as Record<string, string>,
  /** The two suffixes the engine hangs off a tool's own name when both directions cost real
   *  money. */
  suffix: { results: "results", callArgs: "call args" },
  /** The folded tail, which is a count as much as a word. */
  folded: (n: number): string => `other (${n} items)`,
}

export type Dict = typeof EN

const ZH: Dict = {
  language: "语言",
  menu: { name: "工具", close: "关闭" },
  theme: {
    name: "主题",
    light: "浅色主题",
    system: "跟随系统",
    dark: "深色主题",
    cycle: (next) => `点一下切换到：${next}`,
  },
  ttl: {
    name: "缓存写入 TTL",
    tip1h: "转录里没有标注 TTL 的缓存写入，按 1h 计价，即输入的 2×。点一下改按 5m，即 1.25×。",
    tip5m: "转录里没有标注 TTL 的缓存写入，按 5m 计价，即输入的 1.25×。点一下改按 1h，即 2×。",
  },
  mask: {
    name: "隐藏金额",
    tipOn: "重新显示金额",
    tipOff: "遮住所有金额，只留下账单占比 —— 适合共享屏幕时",
  },
  reset: {
    name: "新的分析",
    tip: "丢弃这份报告，重新选择转录文件。什么都没有上传过，这些数字只存在于这个页面里 —— 一旦丢弃就没有了。",
  },
  share: {
    copy: "复制图表",
    copyBusy: "正在渲染…",
    copyDone: "图表已复制",
    copySaved: "图表已存为 PNG",
    copyFailed: "无法渲染图表",
    to: "分享到",
    name: "分享到 X",
    busy: "正在渲染…",
    copied: "图片已复制 —— 粘贴到帖子里",
    saved: "图片已保存 —— 附到帖子里",
    failed: "无法渲染图片",
  },
  card: {
    eyebrow: "成本归因 · Claude Code",
    title: "钱花到哪儿去了 — Claude Code 成本归因",
    nothingYet: "还没有放入任何文件",
    example: "示例数据",
    gap: "",
    billed: (ttl, masked) => `已计费 · ${masked ? "金额已隐藏 · " : ""}${ttl} 缓存 TTL`,
    ask: [
      { w: "your", text: "你的" },
      { w: "money", text: "钱", em: true },
      { w: "go", text: "去哪了？" },
    ],
    answer: [
      { w: "your", text: "你的" },
      { w: "money", text: "钱", em: true },
      { w: "went", text: "花在这儿了" },
    ],
    scope: (sessions, days, requests) =>
      [`${sessions} 个会话`, days ? `${days} 天` : null, `${requests} 次请求`]
        .filter(Boolean)
        .join(" · "),
  },
  strip: {
    thesis: (
      <>
        这是一份<em>结转</em>账单，不是用量账单 —— 每次请求都要为整个上下文重新付费。
      </>
    ),
    carried: (times) => `写一次，结转 ${times}`,
    split: (thinking) => `输入对输出 · 思考 ${thinking}`,
    of: " ／",
    theBill: "整份账单",
    fixedMasked: (requests) => `固定开销，${requests} 次请求每次都付`,
    fixedOpen: (amount) => `固定开销，每次请求都付 · ${amount}`,
  },
  chart: {
    panels: "面板",
    table: "表格",
    mosaic: "马赛克",
    sunburst: "旭日图",
    breadcrumb: "面包屑导航",
    all: "全部",
    headMosaic: "每一条明细 · 列宽＝占账单的比例 · 块高＝占该列的比例",
    headMosaicRows: "每一条明细 · 行高＝占账单的比例 · 块宽＝占该行的比例",
    headSun: "每一条明细 · 弧长＝占内圈的比例 · 每一圈深入一层",
    hoverIdle: (gen, carry) =>
      `高亮的块＝模型写了一次、花了 ${gen} 的文字，之后又作为输入被重新计费 ${carry}。` +
      "把鼠标移到任意块上可以看它的明细。",
    hoverLine: (name, amount, share, under) => `${name}   ${amount}   占${under} ${share}`,
  },
  sun: {
    back: "返回上一层",
    goBack: "点击返回上一层",
    drillIn: "点击扇区可以深入",
    lineItems: (n) => `${n} 条明细`,
    aria: (n, total) => `旭日图：${n} 条明细，合计 ${total}，每一圈都是内圈的一部分`,
    empty: (label) => `${label}下面没有更细的拆分了。`,
    foldedNote: "折叠起来的长尾 · 数额完整，表格里逐条列出",
    itemsNote: (n) => `${n} 项`,
    leafNote: "单条明细 · 没有更细的拆分",
    ofLabel: (share, label) => (
      <>
        占{label} {share}
      </>
    ),
  },
  panels: {
    leaf: "单条明细 · 没有更细的拆分",
    shown: (shown, whole) => `显示 ${shown}，共 ${whole}`,
    ofBill: (amount) => `占账单 ${amount}`,
    perReq: (amount) => `${amount}／次请求`,
  },
  breakdown: {
    title: "明细拆分",
    find: "查找",
    findPlaceholder: "git diff、thinking、schema…",
    reconciled: "已对账",
    reconciledIs: (amount) => (
      <>
        已对账：<strong>{amount}</strong>
      </>
    ),
    noteFiltered: (amount) =>
      `已筛选 · 匹配的明细合计 ${amount}，显示在各自的父项之下；父项行仍保留自己的完整合计。`,
    noteWhole: "每一层的子项都合计为父项；折叠的行保留完整数额。",
    noteGap: (gap) => ` 账单总额中有 ${gap} 是未归因的舍入误差。`,
  },
  table: {
    lineItem: "明细",
    cost: "金额",
    share: "占比",
    magnitude: "量级",
    perRequest: "每次请求",
    shareOfBill: "占账单比例",
    matched: "已匹配",
    noMatch: (query) => `没有明细匹配“${query}”。`,
  },
  foot: {
    monday: "周一可以改的事",
    caveats: "说明与限制",
    intake: (p) => (
      <>
        <strong>砍掉读进来的，而不是写出去的。</strong>账单里有 {p.ingest} 是工具
        <em>读进</em>上下文的内容，相比之下发出去的参数是 {p.emit}，你自己敲的全部只有 {p.typed}
        {p.ratio ? `（少 ${p.ratio}×）` : ""}
        。工具输出会整块落进前缀，直到滑出上下文之前都在被反复计费 —— 要更窄的切片。
      </>
    ),
    preamble: (fixed, requests) => (
      <>
        <strong>精简开场白。</strong>
        {fixed} 的固定开销是唯一一条你删一次、就不用再付 {requests} 遍的账。
      </>
    ),
    compact: (
      <>
        <strong>更早地压缩上下文。</strong>
        结转成本与一条结果活了多久成正比，而不是与它看上去多大成正比。
      </>
    ),
    ttlCaveat: (gap) =>
      "缓存写入在 1h TTL 下按输入的 2× 计费，5m 下按 1.25×。转录里记录了哪一种的，直接照记录算；" +
      `这个开关只重新定价它没记的部分，所以两种视角在这里只差 ${gap}。`,
    outputCaveat:
      "“模型输出”超过输出 token 的花费，是因为写过一次的文字会在之后每次请求里作为输入被重新计费。",
    foldCaveat: (pct) =>
      `占父项不到 ${pct} 的块会被折叠成一个标着“其他”的行；没有任何东西被丢弃。` +
      "身份除了靠颜色，也由表格承载。",
    densityCaveat: (density) => `合计是精确的；分摊到各条明细是按字符数以 ${density} 估算的。`,
    densityMeasured: (code, text, calibrated) =>
      `机器文本 ${code} 字符／token，散文 ${text} 字符／token，` +
      (calibrated ? "两者都由这份数据实测得出" : "均为默认值，样本太少无法实测"),
    densityFallback: "约 4 字符／token",
    ttlShareCaveat: (share, models) =>
      `写入 token 中有 ${share} 记录了缓存写入的 TTL，所以上面的开关只重新定价其余部分。` +
      (models ? ` 模型：${models}。` : ""),
    unknownShare: "未知比例",
  },
  intake: {
    heading: (folder) => <>把你的 {folder} 文件夹拖到这里</>,
    headingTouch: "把你的 AI 账单画出来",
    lede: "把 AI 账单画出来：每个工具、每条子命令、每一块钱。",
    ledeTouch: "每个工具、每条子命令、每一块钱，都从你的 Claude Code 会话记录里读出来。",
    choose: "选择文件夹",
    example: "查看示例",
    hidden: "这个文件夹是隐藏的",
    yours: "想看自己的账单",
    yoursBody: (
      <>
        在你运行 Claude Code 的那台机器上打开本页，然后选择 <code>~/.claude/projects</code>。
      </>
    ),
    osTip: (current, next) => `不是 ${current}？点一下切到 ${next} 的说明。`,
    reading: "正在读取",
    privacy: "在本页解析 · 不上传任何内容",
    how: {
      mac: (
        <>
          在对话框里按 <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>.</kbd> 显示隐藏文件夹。或者按 <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>G</kbd> 粘贴 <code>~/.claude/projects</code>。
        </>
      ),
      win: (
        <>
          在对话框的<em>文件夹</em>框里输入 <code>%USERPROFILE%\.claude\projects</code>，按{" "}
          <kbd>Enter</kbd>。
        </>
      ),
      linux: (
        <>
          在对话框里按 <kbd>Ctrl</kbd>
          <kbd>L</kbd>，输入 <code>~/.claude/projects</code>，按 <kbd>Enter</kbd>。
        </>
      ),
    },
    errNothing: "没有选中任何文件。",
    errNoJsonl: (root) => (
      <>
        {root} 里没有 <code>.jsonl</code> 转录文件。Claude Code 每个会话写一个，放在{" "}
        <code>~/.claude/projects</code> 下面。
      </>
    ),
    errLoose: (n) => (
      <>
        这 {n} 个文件里没有一个是 <code>.jsonl</code> 转录文件。
      </>
    ),
    errRead: (message) => `无法读取这些文件：${message}`,
    errAnalysis: (message) => `分析失败：${message}`,
    errNoneBilled: (n, root) => (
      <>
        从 {root ?? "那个文件夹"} 里读了 {n} 个转录文件，没有一个包含计费的 API 请求 ——
        这里没有任何东西被计过费。
      </>
    ),
    errNotClaude: (n, root) => (
      <>
        这 {n} 个 <code>.jsonl</code> 文件里没有计费的 API 请求。
        {root ? <>{root} 不是</> : "它们不是来自"} <code>~/.claude/projects</code>，而 Claude Code
        的转录文件就放在那里。
      </>
    ),
  },
  where: {
    handingOver: "你交出去的是什么",
    handingOverBody: (
      <>
        每个会话一个 <code>.jsonl</code> 文件，每个项目一个文件夹，都在{" "}
        <code>~/.claude/projects/</code> 下面 ——
        这是个点开头的隐藏目录，所以每个文件选择器都会藏起它，
        除非你指名要。你选的所有内容会合并成一份报告 ——
        拆分依据是钱花在了什么上，而不是花在哪个文件夹里，所以如果你只想看某一个项目的账单，就只选那个项目的文件夹。
      </>
    ),
    terminal: "更习惯用终端？",
    terminalBody: (
      <>
        在文件管理器里打开这个文件夹，然后拖到上面的卡片上：<code>open ~/.claude/projects</code>
      </>
    ),
    largest: (
      <>
        最大的项目排在前面：<code>du -sh ~/.claude/projects/*/ | sort -rh | head</code>
      </>
    ),
    noUpload: "不上传任何内容",
    noUploadBody:
      "文件的读取和账单的计算都在这个页面里完成：没有服务器可以把转录发过去，" +
      "而且只要这里有任何东西访问网络，构建就会失败。把页面保存下来，从本地打开一样能用。",
    linkTitle: "分享出去的链接只带视图，不带账单",
    linkBody:
      "地址栏记录的是你在用哪个视角、在看哪一块 —— 从不记录数字。" +
      "打开它的人看到的是一张空卡片，需要放进他们自己的转录文件。",
  },
  labels: {
    all: "全部",
    other: "其他",
    "Shell commands": "终端命令",
    "Tools · content read in": "工具 · 读进来的内容",
    "Tools · content written out": "工具 · 写出去的内容",
    "Tools · two-way": "工具 · 双向",
    "Model output": "模型输出",
    "System prompt & tool schemas": "系统提示词与工具 schema",
    "Harness & reminders": "框架与提醒",
    "Images & attachments": "图片与附件",
    "My typing": "我敲的字",
    Shell: "终端",
    "Read in": "读进",
    "Written out": "写出",
    "Two-way": "双向",
    Output: "输出",
    "System prompt": "系统提示词",
    Harness: "框架",
    Media: "媒体",
    "system prompt + tool schemas": "系统提示词 + 工具 schema",
    harness: "框架",
    "your typed messages": "你敲的消息",
    thinking: "思考",
    "assistant prose (generated)": "助手文字（生成）",
    "tool-call arguments": "工具调用参数",
    "assistant prose (re-billed as input)": "助手文字（作为输入重新计费）",
    "thinking blocks (re-billed as input)": "思考块（作为输入重新计费）",
    "(output)": "（输出）",
    "(no command parsed)": "（未解析出命令）",
    "(no path parsed)": "（未解析出路径）",
  },
  suffix: { results: "结果", callArgs: "调用参数" },
  folded: (n) => `其他（${n} 项）`,
}

const JA: Dict = {
  language: "言語",
  menu: { name: "ツール", close: "閉じる" },
  theme: {
    name: "テーマ",
    light: "ライトテーマ",
    system: "システムに従う",
    dark: "ダークテーマ",
    cycle: (next) => `押すと ${next} に切り替わります`,
  },
  ttl: {
    name: "キャッシュ書き込みの TTL",
    tip1h:
      "トランスクリプトに TTL の記録がないキャッシュ書き込みは、1h とみなして入力の 2× で計上しています。押すと 5m（1.25×）に切り替わります。",
    tip5m:
      "トランスクリプトに TTL の記録がないキャッシュ書き込みは、5m とみなして入力の 1.25× で計上しています。押すと 1h（2×）に切り替わります。",
  },
  mask: {
    name: "金額を隠す",
    tipOn: "金額を再表示する",
    tipOff: "金額をすべて隠し、請求全体に対する割合だけを残す — 画面共有向け",
  },
  reset: {
    name: "新しい分析",
    tip: "このレポートを破棄して別のトランスクリプトを選びます。何もアップロードしていないので、この数字はこのページの中にしかありません — 破棄すれば消えます。",
  },
  share: {
    copy: "チャートをコピー",
    copyBusy: "描画中…",
    copyDone: "チャートをコピーしました",
    copySaved: "チャートを PNG で保存しました",
    copyFailed: "チャートを描画できませんでした",
    to: "共有先",
    name: "X で共有",
    busy: "描画中…",
    copied: "画像をコピーしました — 投稿に貼り付けてください",
    saved: "画像を保存しました — 投稿に添付してください",
    failed: "画像を描画できませんでした",
  },
  card: {
    eyebrow: "コスト配分 · Claude Code",
    title: "お金はどこへ — Claude Code コスト配分",
    nothingYet: "まだ何も渡されていません",
    example: "サンプルデータ",
    gap: "",
    billed: (ttl, masked) => `課金済み · ${masked ? "金額は非表示 · " : ""}${ttl} キャッシュ TTL`,
    ask: [
      { w: "your", text: "あなたの" },
      { w: "money", text: "お金", em: true },
      { w: "go", text: "はどこへ？" },
    ],
    answer: [
      { w: "your", text: "あなたの" },
      { w: "money", text: "お金", em: true },
      { w: "went", text: "の行き先" },
    ],
    scope: (sessions, days, requests) =>
      [`${sessions} セッション`, days ? `${days} 日` : null, `${requests} リクエスト`]
        .filter(Boolean)
        .join(" · "),
  },
  strip: {
    /* Kept to two lines in the strip's first cell. */
    thesis: (
      <>
        使用量ではなく<em>持ち越し</em>の請求 — 毎回コンテキスト全体が再課金される。
      </>
    ),
    carried: (times) => `書いたのは一度、持ち越し ${times}`,
    split: (thinking) => `入力と出力 · 思考 ${thinking}`,
    of: " ／",
    theBill: "請求全体",
    fixedMasked: (requests) => `固定分、${requests} リクエストすべてで発生`,
    fixedOpen: (amount) => `固定分、毎リクエスト · ${amount}`,
  },
  chart: {
    panels: "パネル",
    table: "テーブル",
    mosaic: "モザイク",
    sunburst: "サンバースト",
    breadcrumb: "パンくずリスト",
    all: "全体",
    headMosaic: "全項目 · 列幅＝請求に占める割合 · ブロックの高さ＝その列に占める割合",
    headMosaicRows: "全項目 · 行の高さ＝請求に占める割合 · ブロックの幅＝その行に占める割合",
    headSun: "全項目 · 弧＝内側のリングに占める割合 · リング一つで一階層深く",
    hoverIdle: (gen, carry) =>
      `強調ブロック＝モデルが一度 ${gen} で書いた文章が、入力として ${carry} 分だけ再課金されたもの。` +
      "ブロックにカーソルを合わせると明細が出ます。",
    hoverLine: (name, amount, share, under) => `${name}   ${amount}   ${under}の ${share}`,
  },
  sun: {
    back: "一つ上の階層へ",
    goBack: "クリックで一つ上へ",
    drillIn: "セクターをクリックで深く",
    lineItems: (n) => `${n} 項目`,
    aria: (n, total) =>
      `サンバースト：${n} 項目、合計 ${total}。各リングは内側のリングに占める割合です`,
    empty: (label) => `${label}の下にこれ以上の内訳はありません。`,
    foldedNote: "折りたたまれた末尾 · 金額はそのまま、テーブルに一覧",
    itemsNote: (n) => `${n} 件`,
    leafNote: "単一項目 · これ以上の内訳なし",
    ofLabel: (share, label) => (
      <>
        {label}の {share}
      </>
    ),
  },
  panels: {
    leaf: "単一項目 · これ以上の内訳なし",
    shown: (shown, whole) => `表示 ${shown} / 全体 ${whole}`,
    ofBill: (amount) => `請求の ${amount}`,
    perReq: (amount) => `${amount}／リクエスト`,
  },
  breakdown: {
    title: "内訳",
    find: "検索",
    findPlaceholder: "git diff、thinking、schema…",
    reconciled: "照合済み",
    reconciledIs: (amount) => (
      <>
        照合済み：<strong>{amount}</strong>
      </>
    ),
    noteFiltered: (amount) =>
      `絞り込み表示 · 一致した項目の合計 ${amount}。親の文脈の中に表示しており、親の行は自分の全額を保ちます。`,
    noteWhole: "どの階層でも子の合計が親と一致します。折りたたまれた行も全額を保っています。",
    noteGap: (gap) => ` 請求総額のうち ${gap} は配分されない丸め誤差です。`,
  },
  table: {
    lineItem: "項目",
    cost: "金額",
    share: "割合",
    magnitude: "大きさ",
    perRequest: "1 リクエストあたり",
    shareOfBill: "請求に占める割合",
    matched: "一致",
    noMatch: (query) => `「${query}」に一致する項目はありません。`,
  },
  foot: {
    monday: "月曜から変えられること",
    caveats: "注意点",
    intake: (p) => (
      <>
        <strong>減らすのは出力ではなく取り込み。</strong>請求のうち {p.ingest}{" "}
        はツールがコンテキストに<em>読み込んだ</em>内容で、送り出した引数は {p.emit}、
        自分で打った分すべてで {p.typed}
        {p.ratio ? `（${p.ratio}× 少ない）` : ""}
        です。ツールの出力はプレフィックスに丸ごと載り、外れるまで再課金され続けます —
        もっと狭い範囲を要求しましょう。
      </>
    ),
    preamble: (fixed, requests) => (
      <>
        <strong>前置きを削る。</strong>固定オーバーヘッドの {fixed} は、一度消せば{requests}{" "}
        回分の支払いが止まる唯一の行です。
      </>
    ),
    compact: (
      <>
        <strong>早めにコンパクトする。</strong>
        持ち越しコストは結果の大きさではなく、それが生き残った長さに比例します。
      </>
    ),
    ttlCaveat: (gap) =>
      "キャッシュ書き込みは 1h TTL で入力の 2×、5m で 1.25× で課金されます。どちらが適用されたか" +
      `トランスクリプトに記録があるものはそのまま使い、切り替えが再計算するのは記録がない分だけです。だから二つの視点の差はここでは ${gap} しかありません。`,
    outputCaveat:
      "「モデル出力」が出力トークンの支出を上回るのは、一度書かれた文章が以降のリクエストごとに入力として再課金されるためです。",
    foldCaveat: (pct) =>
      `親の ${pct} 未満のブロックは「その他」としてまとめられます。捨てられるものはありません。` +
      "識別は色だけでなくテーブルでも担保されます。",
    densityCaveat: (density) =>
      `合計は正確です。項目への配分は文字数から ${density} で推定しています。`,
    densityMeasured: (code, text, calibrated) =>
      `機械的なテキストは ${code} 文字／トークン、散文は ${text} 文字／トークン。` +
      (calibrated
        ? "どちらもこのデータから実測"
        : "いずれも既定値。サンプルが少なく実測できません"),
    densityFallback: "約 4 文字／トークン",
    ttlShareCaveat: (share, models) =>
      `書き込みトークンのうち ${share} でキャッシュ書き込みの TTL が記録されていたため、上の切り替えは残りだけを再計算します。` +
      (models ? ` モデル：${models}。` : ""),
    unknownShare: "不明な割合",
  },
  intake: {
    heading: (folder) => <>{folder} フォルダをここにドロップ</>,
    headingTouch: "AI の請求を図にする",
    lede: "AI の請求を図にする：すべてのツール、すべてのサブコマンド、すべてのドル。",
    ledeTouch:
      "すべてのツール、すべてのサブコマンド、すべてのドルを、Claude Code のセッション記録から読み取ります。",
    choose: "フォルダを選ぶ",
    example: "サンプルを見る",
    hidden: "このフォルダは隠されています",
    yours: "自分の請求を見るには",
    yoursBody: (
      <>
        Claude Code を動かしているマシンでこのページを開き、<code>~/.claude/projects</code>{" "}
        を選んでください。
      </>
    ),
    osTip: (current, next) => `${current} ではない？押すと ${next} の手順に切り替わります。`,
    reading: "読み込み中",
    privacy: "このページ内で解析 · 何もアップロードしません",
    how: {
      mac: (
        <>
          ダイアログで <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>.</kbd> を押すと隠しフォルダが表示されます。または <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>G</kbd> で <code>~/.claude/projects</code> を貼り付け。
        </>
      ),
      win: (
        <>
          ダイアログの<em>フォルダー</em>欄に <code>%USERPROFILE%\.claude\projects</code> と入力し、
          <kbd>Enter</kbd> を押します。
        </>
      ),
      linux: (
        <>
          ダイアログで <kbd>Ctrl</kbd>
          <kbd>L</kbd> を押し、<code>~/.claude/projects</code> と入力して <kbd>Enter</kbd>。
        </>
      ),
    },
    errNothing: "ファイルが選択されていません。",
    errNoJsonl: (root) => (
      <>
        {root} に <code>.jsonl</code> トランスクリプトはありません。Claude Code はセッションごとに 1
        つを <code>~/.claude/projects</code> の下に書き出します。
      </>
    ),
    errLoose: (n) => (
      <>
        その {n} 個のファイルはいずれも <code>.jsonl</code> トランスクリプトではありません。
      </>
    ),
    errRead: (message) => `ファイルを読み込めませんでした：${message}`,
    errAnalysis: (message) => `分析に失敗しました：${message}`,
    errNoneBilled: (n, root) => (
      <>
        {root ?? "そのフォルダ"} から {n} 個のトランスクリプトを読みましたが、課金された API
        リクエストは一つもありません — ここには請求されたものがありません。
      </>
    ),
    errNotClaude: (n, root) => (
      <>
        その {n} 個の <code>.jsonl</code> ファイルに課金された API リクエストはありません。
        {root ? <>{root} は</> : "これらの出どころは"} <code>~/.claude/projects</code>{" "}
        ではありません。Claude Code はそこにトランスクリプトを置きます。
      </>
    ),
  },
  where: {
    handingOver: "何を渡すことになるのか",
    handingOverBody: (
      <>
        セッションごとに <code>.jsonl</code> ファイルが 1 つ、プロジェクトごとにフォルダが 1 つ、
        <code>~/.claude/projects/</code> の下にあります — ドットファイルなので、名前で指定しない限り
        どのファイル選択画面でも隠されています。選んだものはすべて 1 つのレポートにまとめられます —
        内訳はどのフォルダで使ったかではなく何にお金を使ったかで分かれるので、
        特定のプロジェクトの請求が見たいなら、そのプロジェクトのフォルダだけを選んでください。
      </>
    ),
    terminal: "ターミナルのほうが好み？",
    terminalBody: (
      <>
        ファイルマネージャでフォルダを開き、上のカードにドラッグしてください：
        <code>open ~/.claude/projects</code>
      </>
    ),
    largest: (
      <>
        大きいプロジェクトから：<code>du -sh ~/.claude/projects/*/ | sort -rh | head</code>
      </>
    ),
    noUpload: "何もアップロードされません",
    noUploadBody:
      "ファイルの読み込みも請求の計算もこのページの中で行われます。トランスクリプトを送る先のサーバーはなく、" +
      "ここから少しでもネットワークに触れればビルドが失敗します。ページを保存すれば、ディスクからでも同じように動きます。",
    linkTitle: "共有リンクが運ぶのはビューであって請求ではありません",
    linkBody:
      "アドレスに記録されるのは、どの視点でどのブロックを見ているかだけです — 数字は決して入りません。" +
      "開いた人には空のカードが表示され、自分のトランスクリプトを渡すことになります。",
  },
  labels: {
    all: "全体",
    other: "その他",
    "Shell commands": "シェルコマンド",
    "Tools · content read in": "ツール · 読み込んだ内容",
    "Tools · content written out": "ツール · 書き出した内容",
    "Tools · two-way": "ツール · 双方向",
    "Model output": "モデル出力",
    "System prompt & tool schemas": "システムプロンプトとツールスキーマ",
    "Harness & reminders": "ハーネスとリマインダー",
    "Images & attachments": "画像と添付ファイル",
    "My typing": "自分で打った分",
    Shell: "シェル",
    "Read in": "読み込み",
    "Written out": "書き出し",
    "Two-way": "双方向",
    Output: "出力",
    "System prompt": "システムプロンプト",
    Harness: "ハーネス",
    Media: "メディア",
    "system prompt + tool schemas": "システムプロンプト + ツールスキーマ",
    harness: "ハーネス",
    "your typed messages": "自分で打ったメッセージ",
    thinking: "思考",
    "assistant prose (generated)": "アシスタントの文章（生成）",
    "tool-call arguments": "ツール呼び出しの引数",
    "assistant prose (re-billed as input)": "アシスタントの文章（入力として再課金）",
    "thinking blocks (re-billed as input)": "思考ブロック（入力として再課金）",
    "(output)": "（出力）",
    "(no command parsed)": "（コマンドを解析できず）",
    "(no path parsed)": "（パスを解析できず）",
  },
  suffix: { results: "結果", callArgs: "呼び出し引数" },
  folded: (n) => `その他（${n} 件）`,
}

const ES: Dict = {
  language: "Idioma",
  menu: { name: "Herramientas", close: "Cerrar" },
  theme: {
    name: "Tema",
    light: "Tema claro",
    system: "Tema del sistema",
    dark: "Tema oscuro",
    cycle: (next) => `Pulsa para cambiar a: ${next}`,
  },
  ttl: {
    name: "TTL de escritura en caché",
    tip1h:
      "Las escrituras en caché que la transcripción no registró se tarifan como TTL de 1h, a 2× la entrada. Pulsa para suponer 5m, a 1,25×.",
    tip5m:
      "Las escrituras en caché que la transcripción no registró se tarifan como TTL de 5m, a 1,25× la entrada. Pulsa para suponer 1h, a 2×.",
  },
  mask: {
    name: "Ocultar los importes",
    tipOn: "Volver a mostrar los importes",
    tipOff:
      "Tapar todas las cifras y dejar solo porcentajes de la factura — para compartir pantalla",
  },
  reset: {
    name: "Nuevo análisis",
    tip: "Descarta este informe y elige otras transcripciones. No se subió nada, así que estos números solo existen en esta página: al hacerlo desaparecen.",
  },
  share: {
    copy: "Copiar gráfico",
    copyBusy: "Generando…",
    copyDone: "Gráfico copiado",
    copySaved: "Gráfico guardado como PNG",
    copyFailed: "No se pudo generar el gráfico",
    to: "Compartir en",
    name: "Compartir en X",
    busy: "Generando…",
    copied: "Imagen copiada — pégala en la publicación",
    saved: "Imagen guardada — adjúntala a la publicación",
    failed: "No se pudo generar la imagen",
  },
  card: {
    eyebrow: "Atribución de costes · Claude Code",
    title: "En qué se fue el dinero — Atribución de costes de Claude Code",
    nothingYet: "Todavía no hay nada",
    example: "Datos de ejemplo",
    gap: " ",
    billed: (ttl, masked) =>
      `Facturado · ${masked ? "importe oculto · " : ""}TTL de caché de ${ttl}`,
    ask: [
      { w: "where", text: "¿En qué" },
      { w: "went", text: "se fue" },
      { w: "your", text: "tu" },
      { w: "money", text: "dinero", em: true },
      { w: "go", text: "?", tight: true },
    ],
    answer: [
      { w: "where", text: "En esto" },
      { w: "went", text: "se fue" },
      { w: "your", text: "tu" },
      { w: "money", text: "dinero", em: true },
    ],
    scope: (sessions, days, requests) =>
      [`${sessions} sesiones`, days ? `${days} días` : null, `${requests} peticiones`]
        .filter(Boolean)
        .join(" · "),
  },
  strip: {
    thesis: (
      <>
        Una factura de <em>arrastre</em>, no de uso: cada petición vuelve a cobrar todo el contexto.
      </>
    ),
    carried: (times) => `Escrito una vez, arrastrado ${times}`,
    split: (thinking) => `Entrada frente a salida · razonamiento ${thinking}`,
    of: " de",
    theBill: "la factura",
    fixedMasked: (requests) => `Fijo, pagado en las ${requests} peticiones`,
    fixedOpen: (amount) => `Fijo, en cada petición · ${amount}`,
  },
  chart: {
    panels: "Paneles",
    table: "Tabla",
    mosaic: "Mosaico",
    sunburst: "Radial",
    breadcrumb: "Ruta de navegación",
    all: "todo",
    headMosaic:
      "Cada línea · ancho de columna = parte de la factura · alto del bloque = parte de la columna",
    headMosaicRows:
      "Cada línea · alto de fila = parte de la factura · ancho del bloque = parte de la fila",
    headSun: "Cada línea · arco = parte del anillo interior · cada anillo, un nivel más",
    hoverIdle: (gen, carry) =>
      `Bloque acentuado = prosa que el modelo escribió una vez por ${gen}, recobrada como entrada por ${carry} más. ` +
      "Pasa el cursor para ver su línea.",
    hoverLine: (name, amount, share, under) => `${name}   ${amount}   ${share} de ${under}`,
  },
  sun: {
    back: "Un nivel atrás",
    goBack: "haz clic para volver",
    drillIn: "haz clic en un sector para entrar",
    lineItems: (n) => `${n} líneas`,
    aria: (n, total) =>
      `Radial: ${n} líneas que suman ${total}; cada anillo es una parte del anillo interior`,
    empty: (label) => `No hay más desglose bajo ${label}.`,
    foldedNote: "la cola plegada · íntegra, detallada en la tabla",
    itemsNote: (n) => `${n} elemento${n === 1 ? "" : "s"}`,
    leafNote: "línea única · sin más desglose",
    ofLabel: (share, label) => (
      <>
        {share} de {label}
      </>
    ),
  },
  panels: {
    leaf: "línea única · sin más desglose",
    shown: (shown, whole) => `mostrado: ${shown} de ${whole}`,
    ofBill: (amount) => `${amount} de la factura`,
    perReq: (amount) => `${amount}/pet.`,
  },
  breakdown: {
    title: "Desglose",
    find: "Buscar",
    findPlaceholder: "git diff, thinking, schema…",
    reconciled: "Cuadrado",
    reconciledIs: (amount) => (
      <>
        Cuadrado: <strong>{amount}</strong>
      </>
    ),
    noteFiltered: (amount) =>
      `Vista filtrada · ${amount} entre las líneas coincidentes, mostradas en el contexto de sus ` +
      "padres; las filas padre conservan sus totales completos.",
    noteWhole:
      "Los hijos suman el padre en todos los niveles; las filas plegadas conservan su valor íntegro.",
    noteGap: (gap) => ` ${gap} del total facturado es redondeo sin atribuir.`,
  },
  table: {
    lineItem: "Línea",
    cost: "Coste",
    share: "Parte",
    magnitude: "Magnitud",
    perRequest: "Por petición",
    shareOfBill: "Parte de la factura",
    matched: "Coincidencias",
    noMatch: (query) => `Ninguna línea coincide con «${query}».`,
  },
  foot: {
    monday: "Qué cambiar el lunes",
    caveats: "Advertencias",
    intake: (p) => (
      <>
        <strong>Recorta lo que entra, no lo que sale.</strong> {p.ingest} de la factura es contenido
        que las herramientas metieron <em>dentro</em> del contexto, frente a {p.emit} de argumentos
        enviados y {p.typed} de todo lo que escribiste tú
        {p.ratio ? ` (${p.ratio}× menos)` : ""}. La salida de una herramienta entra entera en el
        prefijo y se recobra hasta que sale — pide porciones más estrechas.
      </>
    ),
    preamble: (fixed, requests) => (
      <>
        <strong>Adelgaza el preámbulo.</strong> {fixed} de sobrecarga fija es la única línea que
        puedes borrar una vez y dejar de pagar {requests} veces.
      </>
    ),
    compact: (
      <>
        <strong>Compacta antes.</strong> El coste de arrastre es lineal en cuánto sobrevive un
        resultado, no en lo grande que parecía.
      </>
    ),
    ttlCaveat: (gap) =>
      "Las escrituras en caché se cobran a 2× la entrada con TTL de 1h y a 1,25× con 5m. Donde la " +
      "transcripción registra cuál se aplicó, se usa tal cual; el interruptor solo recalcula lo que " +
      `omitió, y por eso las dos lentes difieren aquí en apenas ${gap}.`,
    outputCaveat:
      "«Salida del modelo» supera el gasto en tokens de salida porque la prosa escrita una vez se " +
      "recobra como entrada en cada petición posterior.",
    foldCaveat: (pct) =>
      `Los bloques por debajo del ${pct} de su padre se pliegan en un «otros» etiquetado; no se ` +
      "descarta nada. La identidad la lleva la tabla además del color.",
    densityCaveat: (density) =>
      `Los totales son exactos; el reparto entre líneas se estima a partir del recuento de caracteres a ${density}.`,
    densityMeasured: (code, text, calibrated) =>
      `${code} caracteres/token para texto de máquina y ${text} para prosa, ` +
      (calibrated
        ? "ambos medidos con este conjunto de datos"
        : "valores por defecto, muestras insuficientes para medir"),
    densityFallback: "~4 caracteres/token",
    ttlShareCaveat: (share, models) =>
      `El TTL de escritura en caché se registró para ${share} de los tokens escritos, así que la ` +
      "lente de arriba solo recalcula el resto." +
      (models ? ` Modelos: ${models}.` : ""),
    unknownShare: "una parte desconocida",
  },
  intake: {
    heading: (folder) => <>Suelta aquí tu carpeta {folder}</>,
    headingTouch: "Visualiza tu factura de IA",
    lede: "Grafica tu factura de IA: cada herramienta, cada subcomando, cada dólar.",
    ledeTouch:
      "Cada herramienta, cada subcomando, cada dólar, leídos de tus sesiones de Claude Code.",
    choose: "Elegir carpeta",
    example: "Ver un ejemplo",
    hidden: "La carpeta está oculta",
    yours: "Para ver la tuya",
    yoursBody: (
      <>
        Abre esta página en la máquina donde ejecutas Claude Code y elige la carpeta{" "}
        <code>~/.claude/projects</code>.
      </>
    ),
    osTip: (current, next) => `¿No usas ${current}? Pulsa para la ruta de ${next}.`,
    reading: "Leyendo",
    privacy: "Analizado en esta página · no se sube nada",
    how: {
      mac: (
        <>
          En el diálogo pulsa <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>.</kbd> para mostrar las carpetas ocultas. O <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>G</kbd> y pega <code>~/.claude/projects</code>.
        </>
      ),
      win: (
        <>
          Escribe <code>%USERPROFILE%\.claude\projects</code> en el campo <em>Carpeta</em> del
          diálogo y pulsa <kbd>Enter</kbd>.
        </>
      ),
      linux: (
        <>
          En el diálogo pulsa <kbd>Ctrl</kbd>
          <kbd>L</kbd>, escribe <code>~/.claude/projects</code> y pulsa <kbd>Enter</kbd>.
        </>
      ),
    },
    errNothing: "No se seleccionó ningún archivo.",
    errNoJsonl: (root) => (
      <>
        {root} no contiene transcripciones <code>.jsonl</code>. Claude Code escribe una por sesión,
        bajo <code>~/.claude/projects</code>.
      </>
    ),
    errLoose: (n) => (
      <>
        Ninguno de esos {n} archivo(s) es una transcripción <code>.jsonl</code>.
      </>
    ),
    errRead: (message) => `No se pudieron leer los archivos: ${message}`,
    errAnalysis: (message) => `El análisis falló: ${message}`,
    errNoneBilled: (n, root) => (
      <>
        Se leyeron {n} transcripcion{n > 1 ? "es" : ""} de {root ?? "esa carpeta"}, y ninguna
        contiene una petición de API con precio — aquí no se ha facturado nada.
      </>
    ),
    errNotClaude: (n, root) => (
      <>
        Esos {n} archivo{n > 1 ? "s" : ""} <code>.jsonl</code> no contienen ninguna petición de API
        con precio. {root ? <>{root} no es</> : "No vienen de"} <code>~/.claude/projects</code>, que
        es donde Claude Code guarda sus transcripciones.
      </>
    ),
  },
  where: {
    handingOver: "Qué estás entregando",
    handingOverBody: (
      <>
        Un archivo <code>.jsonl</code> por sesión, en una carpeta por proyecto, bajo{" "}
        <code>~/.claude/projects/</code> — un dotfile, y por eso todo selector de archivos lo oculta
        hasta que lo pides por su nombre. Todo lo que elijas se combina en un único informe: el
        desglose es por en qué se gastó el dinero, no por en qué carpeta se gastó, así que elige la
        carpeta de un solo proyecto si esa es la factura que quieres.
      </>
    ),
    terminal: "¿Prefieres la terminal?",
    terminalBody: (
      <>
        Abre la carpeta en tu gestor de archivos y arrástrala sobre la tarjeta de arriba:{" "}
        <code>open ~/.claude/projects</code>
      </>
    ),
    largest: (
      <>
        Los proyectos más grandes primero:{" "}
        <code>du -sh ~/.claude/projects/*/ | sort -rh | head</code>
      </>
    ),
    noUpload: "No se sube nada",
    noUploadBody:
      "Los archivos se leen y la factura se calcula en esta página: no hay servidor al que enviar " +
      "una transcripción, y la compilación falla si algo aquí dentro toca la red. Guarda la página y " +
      "funciona igual desde el disco.",
    linkTitle: "Un enlace compartido lleva la vista, no la factura",
    linkBody:
      "La dirección registra qué lente y qué bloque estás mirando, nunca los números. Quien lo abra " +
      "verá una tarjeta vacía y soltará sus propias transcripciones.",
  },
  labels: {
    all: "todo",
    other: "otros",
    "Shell commands": "Comandos de shell",
    "Tools · content read in": "Herramientas · contenido leído",
    "Tools · content written out": "Herramientas · contenido escrito",
    "Tools · two-way": "Herramientas · bidireccional",
    "Model output": "Salida del modelo",
    "System prompt & tool schemas": "Prompt de sistema y esquemas",
    "Harness & reminders": "Harness y recordatorios",
    "Images & attachments": "Imágenes y adjuntos",
    "My typing": "Lo que escribí",
    Shell: "Shell",
    "Read in": "Leído",
    "Written out": "Escrito",
    "Two-way": "Bidireccional",
    Output: "Salida",
    "System prompt": "Prompt de sistema",
    Harness: "Harness",
    Media: "Medios",
    "system prompt + tool schemas": "prompt de sistema + esquemas de herramientas",
    harness: "harness",
    "your typed messages": "tus mensajes escritos",
    thinking: "razonamiento",
    "assistant prose (generated)": "prosa del asistente (generada)",
    "tool-call arguments": "argumentos de llamada",
    "assistant prose (re-billed as input)": "prosa del asistente (recobrada como entrada)",
    "thinking blocks (re-billed as input)": "bloques de razonamiento (recobrados como entrada)",
    "(output)": "(salida)",
    "(no command parsed)": "(sin comando reconocido)",
    "(no path parsed)": "(sin ruta reconocida)",
  },
  suffix: { results: "resultados", callArgs: "argumentos" },
  folded: (n) => `otros (${n} elementos)`,
}

const FR: Dict = {
  language: "Langue",
  menu: { name: "Outils", close: "Fermer" },
  theme: {
    name: "Thème",
    light: "Thème clair",
    system: "Thème du système",
    dark: "Thème sombre",
    cycle: (next) => `Appuyez pour passer à : ${next}`,
  },
  ttl: {
    name: "TTL d’écriture en cache",
    tip1h:
      "Les écritures en cache que la transcription n’a pas notées sont tarifées comme un TTL de 1h, à 2× l’entrée. Appuyez pour supposer 5m, à 1,25×.",
    tip5m:
      "Les écritures en cache que la transcription n’a pas notées sont tarifées comme un TTL de 5m, à 1,25× l’entrée. Appuyez pour supposer 1h, à 2×.",
  },
  mask: {
    name: "Masquer les montants",
    tipOn: "Réafficher les montants",
    tipOff:
      "Masquer chaque montant et ne laisser que les parts de la facture — pour partager un écran",
  },
  reset: {
    name: "Nouvelle analyse",
    tip: "Abandonner ce rapport et choisir d’autres transcriptions. Rien n’a été envoyé, donc ces chiffres n’existent que dans cette page — ils disparaissent avec elle.",
  },
  share: {
    copy: "Copier le graphique",
    copyBusy: "Rendu…",
    copyDone: "Graphique copié",
    copySaved: "Graphique enregistré en PNG",
    copyFailed: "Impossible de rendre le graphique",
    to: "Partager sur",
    name: "Partager sur X",
    busy: "Rendu…",
    copied: "Image copiée — collez-la dans le post",
    saved: "Image enregistrée — joignez-la au post",
    failed: "Impossible de rendre l’image",
  },
  card: {
    eyebrow: "Attribution des coûts · Claude Code",
    title: "Où est passé l’argent — Attribution des coûts Claude Code",
    nothingYet: "Rien n’a encore été déposé",
    example: "Données d’exemple",
    gap: " ",
    billed: (ttl, masked) => `Facturé · ${masked ? "montant masqué · " : ""}TTL de cache ${ttl}`,
    ask: [
      { w: "where", text: "Où" },
      /* The same two words the answer ends on, so they carry the same slot and travel across the
         line rather than fading out here and fading in there. */
      { w: "went", text: "est passé" },
      { w: "your", text: "votre" },
      { w: "money", text: "argent", em: true },
      { w: "go", text: "?" },
    ],
    answer: [
      { w: "where", text: "Où" },
      { w: "your", text: "votre" },
      { w: "money", text: "argent", em: true },
      { w: "went", text: "est passé" },
    ],
    scope: (sessions, days, requests) =>
      [`${sessions} sessions`, days ? `${days} jours` : null, `${requests} requêtes`]
        .filter(Boolean)
        .join(" · "),
  },
  strip: {
    thesis: (
      <>
        Une facture de <em>report</em>, pas d’usage — chaque requête refacture tout le contexte.
      </>
    ),
    carried: (times) => `Écrit une fois, reporté ${times}`,
    split: (thinking) => `Entrée / sortie · réflexion ${thinking}`,
    of: " sur",
    theBill: "la facture",
    fixedMasked: (requests) => `Fixe, payé sur les ${requests} requêtes`,
    fixedOpen: (amount) => `Fixe, à chaque requête · ${amount}`,
  },
  chart: {
    panels: "Panneaux",
    table: "Tableau",
    mosaic: "Mosaïque",
    sunburst: "Rayonnant",
    breadcrumb: "Fil d’Ariane",
    all: "tout",
    headMosaic:
      "Chaque ligne · largeur de colonne = part de la facture · hauteur de bloc = part de la colonne",
    headMosaicRows:
      "Chaque ligne · hauteur de ligne = part de la facture · largeur de bloc = part de la ligne",
    headSun: "Chaque ligne · arc = part de l’anneau intérieur · chaque anneau, un niveau de plus",
    hoverIdle: (gen, carry) =>
      `Bloc accentué = de la prose écrite une fois par le modèle pour ${gen}, refacturée en entrée pour ${carry} de plus. ` +
      "Survolez un bloc pour voir sa ligne.",
    hoverLine: (name, amount, share, under) => `${name}   ${amount}   ${share} de ${under}`,
  },
  sun: {
    back: "Un niveau en arrière",
    goBack: "cliquez pour revenir",
    drillIn: "cliquez sur un secteur pour entrer",
    lineItems: (n) => `${n} lignes`,
    aria: (n, total) =>
      `Rayonnant : ${n} lignes totalisant ${total}, chaque anneau étant une part de celui qu’il entoure`,
    empty: (label) => `Pas de détail supplémentaire sous ${label}.`,
    foldedNote: "la queue repliée · intégrale, détaillée dans le tableau",
    itemsNote: (n) => `${n} élément${n === 1 ? "" : "s"}`,
    leafNote: "ligne unique · pas de détail supplémentaire",
    ofLabel: (share, label) => (
      <>
        {share} de {label}
      </>
    ),
  },
  panels: {
    leaf: "ligne unique · pas de détail supplémentaire",
    shown: (shown, whole) => `affiché : ${shown} sur ${whole}`,
    ofBill: (amount) => `${amount} de la facture`,
    perReq: (amount) => `${amount}/req.`,
  },
  breakdown: {
    title: "Détail",
    find: "Chercher",
    findPlaceholder: "git diff, thinking, schema…",
    reconciled: "Rapproché",
    reconciledIs: (amount) => (
      <>
        Rapproché : <strong>{amount}</strong>
      </>
    ),
    noteFiltered: (amount) =>
      `Vue filtrée · ${amount} sur les lignes correspondantes, montrées dans le contexte de leurs ` +
      "parents ; les lignes parentes gardent leurs totaux complets.",
    noteWhole:
      "Les enfants somment au parent à chaque niveau ; les lignes repliées gardent leur valeur entière.",
    noteGap: (gap) => ` ${gap} du total facturé est un arrondi non attribué.`,
  },
  table: {
    lineItem: "Ligne",
    cost: "Coût",
    share: "Part",
    magnitude: "Ampleur",
    perRequest: "Par requête",
    shareOfBill: "Part de la facture",
    matched: "Correspondances",
    noMatch: (query) => `Aucune ligne ne correspond à « ${query} ».`,
  },
  foot: {
    monday: "Quoi changer lundi",
    caveats: "Réserves",
    intake: (p) => (
      <>
        <strong>Coupez ce qui entre, pas ce qui sort.</strong> {p.ingest} de la facture est du
        contenu que les outils ont tiré <em>dans</em> le contexte, contre {p.emit} d’arguments
        envoyés et {p.typed} pour tout ce que vous avez tapé
        {p.ratio ? ` (${p.ratio}× moins)` : ""}. La sortie d’un outil arrive entière dans le préfixe
        et y est refacturée jusqu’à ce qu’elle en sorte — demandez des tranches plus étroites.
      </>
    ),
    preamble: (fixed, requests) => (
      <>
        <strong>Allégez le préambule.</strong> {fixed} de surcoût fixe est la seule ligne que vous
        pouvez supprimer une fois pour cesser de la payer {requests} fois.
      </>
    ),
    compact: (
      <>
        <strong>Compactez plus tôt.</strong> Le coût de report est linéaire dans la durée de survie
        d’un résultat, pas dans sa taille apparente.
      </>
    ),
    ttlCaveat: (gap) =>
      "Les écritures en cache sont facturées 2× l’entrée avec un TTL de 1h et 1,25× avec 5m. Là où " +
      "la transcription note lequel s’appliquait, c’est repris tel quel ; le commutateur ne retarife " +
      `que ce qu’elle a omis, et c’est pourquoi les deux vues ne diffèrent ici que de ${gap}.`,
    outputCaveat:
      "« Sortie du modèle » dépasse la dépense en jetons de sortie parce que la prose écrite une " +
      "fois est refacturée en entrée à chaque requête ultérieure.",
    foldCaveat: (pct) =>
      `Les blocs sous ${pct} de leur parent sont repliés dans un « autres » étiqueté ; rien n’est ` +
      "perdu. L’identité est portée par le tableau autant que par la teinte.",
    densityCaveat: (density) =>
      `Les totaux sont exacts ; la répartition entre lignes est estimée à partir du nombre de caractères à ${density}.`,
    densityMeasured: (code, text, calibrated) =>
      `${code} caractères/jeton pour le texte machine et ${text} pour la prose, ` +
      (calibrated
        ? "les deux mesurés sur ce jeu de données"
        : "valeurs par défaut, trop peu d’échantillons pour mesurer"),
    densityFallback: "~4 caractères/jeton",
    ttlShareCaveat: (share, models) =>
      `Le TTL d’écriture en cache a été noté pour ${share} des jetons écrits, donc la vue ci-dessus ` +
      "ne retarife que le reste." +
      (models ? ` Modèles : ${models}.` : ""),
    unknownShare: "une part inconnue",
  },
  intake: {
    heading: (folder) => <>Déposez ici votre dossier {folder}</>,
    headingTouch: "Visualisez votre facture d’IA",
    lede: "Cartographiez votre facture d’IA : chaque outil, chaque sous-commande, chaque dollar.",
    ledeTouch:
      "Chaque outil, chaque sous-commande, chaque dollar, lus dans vos sessions Claude Code.",
    choose: "Choisir un dossier",
    example: "Voir un exemple",
    hidden: "Le dossier est masqué",
    yours: "Pour voir la vôtre",
    yoursBody: (
      <>
        Ouvrez cette page sur la machine où vous lancez Claude Code, puis choisissez le dossier{" "}
        <code>~/.claude/projects</code>.
      </>
    ),
    osTip: (current, next) => `Pas ${current} ? Appuyez pour la marche à suivre ${next}.`,
    reading: "Lecture",
    privacy: "Analysé dans cette page · rien n’est envoyé",
    how: {
      mac: (
        <>
          Dans la boîte de dialogue, faites <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>.</kbd> pour révéler les dossiers masqués. Ou <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>G</kbd> puis collez <code>~/.claude/projects</code>.
        </>
      ),
      win: (
        <>
          Tapez <code>%USERPROFILE%\.claude\projects</code> dans le champ <em>Dossier</em> de la
          boîte de dialogue, puis <kbd>Entrée</kbd>.
        </>
      ),
      linux: (
        <>
          Dans la boîte de dialogue, faites <kbd>Ctrl</kbd>
          <kbd>L</kbd>, tapez <code>~/.claude/projects</code>, puis <kbd>Entrée</kbd>.
        </>
      ),
    },
    errNothing: "Aucun fichier sélectionné.",
    errNoJsonl: (root) => (
      <>
        {root} ne contient aucune transcription <code>.jsonl</code>. Claude Code en écrit une par
        session, sous <code>~/.claude/projects</code>.
      </>
    ),
    errLoose: (n) => (
      <>
        Aucun de ces {n} fichier(s) n’est une transcription <code>.jsonl</code>.
      </>
    ),
    errRead: (message) => `Impossible de lire les fichiers : ${message}`,
    errAnalysis: (message) => `L’analyse a échoué : ${message}`,
    errNoneBilled: (n, root) => (
      <>
        {n} transcription{n > 1 ? "s" : ""} lue{n > 1 ? "s" : ""} depuis {root ?? "ce dossier"}, et
        aucune ne contient de requête d’API tarifée — rien ici n’a été facturé.
      </>
    ),
    errNotClaude: (n, root) => (
      <>
        Ces {n} fichier{n > 1 ? "s" : ""} <code>.jsonl</code> ne contiennent aucune requête d’API
        tarifée. {root ? <>{root} n’est pas</> : "Ils ne viennent pas de"}{" "}
        <code>~/.claude/projects</code>, où Claude Code range ses transcriptions.
      </>
    ),
  },
  where: {
    handingOver: "Ce que vous confiez",
    handingOverBody: (
      <>
        Un fichier <code>.jsonl</code> par session, un dossier par projet, sous{" "}
        <code>~/.claude/projects/</code> — un dotfile, et c’est pourquoi tout sélecteur de fichiers
        le masque tant que vous ne le demandez pas par son nom. Tout ce que vous choisissez est
        réuni en un seul rapport : le détail porte sur ce qui a dépensé l’argent, pas sur le dossier
        où il a été dépensé, donc choisissez le dossier d’un seul projet si c’est cette facture que
        vous voulez.
      </>
    ),
    terminal: "Vous préférez le terminal ?",
    terminalBody: (
      <>
        Ouvrez le dossier dans votre gestionnaire de fichiers, puis glissez-le sur la carte
        ci-dessus : <code>open ~/.claude/projects</code>
      </>
    ),
    largest: (
      <>
        Les plus gros projets d’abord : <code>du -sh ~/.claude/projects/*/ | sort -rh | head</code>
      </>
    ),
    noUpload: "Rien n’est envoyé",
    noUploadBody:
      "Les fichiers sont lus et la facture calculée dans cette page : il n’y a aucun serveur à qui " +
      "envoyer une transcription, et la compilation échoue si quoi que ce soit ici touche au réseau. " +
      "Enregistrez la page et elle fonctionne pareil depuis le disque.",
    linkTitle: "Un lien partagé porte la vue, pas la facture",
    linkBody:
      "L’adresse retient quelle vue et quel bloc vous regardez — jamais les chiffres. Qui l’ouvre " +
      "obtient une carte vide et y dépose ses propres transcriptions.",
  },
  labels: {
    all: "tout",
    other: "autres",
    "Shell commands": "Commandes shell",
    "Tools · content read in": "Outils · contenu lu",
    "Tools · content written out": "Outils · contenu écrit",
    "Tools · two-way": "Outils · bidirectionnel",
    "Model output": "Sortie du modèle",
    "System prompt & tool schemas": "Prompt système et schémas",
    "Harness & reminders": "Harness et rappels",
    "Images & attachments": "Images et pièces jointes",
    "My typing": "Ce que j’ai tapé",
    Shell: "Shell",
    "Read in": "Lu",
    "Written out": "Écrit",
    "Two-way": "Bidirectionnel",
    Output: "Sortie",
    "System prompt": "Prompt système",
    Harness: "Harness",
    Media: "Médias",
    "system prompt + tool schemas": "prompt système + schémas d’outils",
    harness: "harness",
    "your typed messages": "vos messages tapés",
    thinking: "réflexion",
    "assistant prose (generated)": "prose de l’assistant (générée)",
    "tool-call arguments": "arguments d’appel d’outil",
    "assistant prose (re-billed as input)": "prose de l’assistant (refacturée en entrée)",
    "thinking blocks (re-billed as input)": "blocs de réflexion (refacturés en entrée)",
    "(output)": "(sortie)",
    "(no command parsed)": "(commande non reconnue)",
    "(no path parsed)": "(chemin non reconnu)",
  },
  suffix: { results: "résultats", callArgs: "arguments" },
  folded: (n) => `autres (${n} éléments)`,
}

const DE: Dict = {
  language: "Sprache",
  menu: { name: "Werkzeuge", close: "Schließen" },
  theme: {
    name: "Design",
    light: "Helles Design",
    system: "System-Design",
    dark: "Dunkles Design",
    cycle: (next) => `Drücken, um zu wechseln zu: ${next}`,
  },
  ttl: {
    name: "TTL für Cache-Schreibvorgänge",
    tip1h:
      "Cache-Schreibvorgänge ohne TTL-Angabe im Transkript werden als 1h bepreist, zum 2-fachen der Eingabe. Drücken, um stattdessen 5m anzunehmen, zum 1,25-fachen.",
    tip5m:
      "Cache-Schreibvorgänge ohne TTL-Angabe im Transkript werden als 5m bepreist, zum 1,25-fachen der Eingabe. Drücken, um stattdessen 1h anzunehmen, zum 2-fachen.",
  },
  mask: {
    name: "Beträge ausblenden",
    tipOn: "Beträge wieder einblenden",
    tipOff: "Jeden Betrag verdecken, nur Anteile an der Rechnung lassen — fürs Bildschirmteilen",
  },
  reset: {
    name: "Neue Analyse",
    tip: "Diesen Bericht verwerfen und andere Transkripte wählen. Nichts wurde hochgeladen, diese Zahlen existieren nur in dieser Seite — danach sind sie weg.",
  },
  share: {
    copy: "Diagramm kopieren",
    copyBusy: "Wird gerendert…",
    copyDone: "Diagramm kopiert",
    copySaved: "Diagramm als PNG gespeichert",
    copyFailed: "Diagramm konnte nicht gerendert werden",
    to: "Teilen auf",
    name: "Auf X teilen",
    busy: "Wird gerendert…",
    copied: "Bild kopiert — füge es in den Post ein",
    saved: "Bild gespeichert — hänge es an den Post an",
    failed: "Bild konnte nicht gerendert werden",
  },
  card: {
    eyebrow: "Kostenzuordnung · Claude Code",
    title: "Wohin das Geld geflossen ist — Claude-Code-Kostenzuordnung",
    nothingYet: "Noch nichts abgelegt",
    example: "Beispieldaten",
    gap: " ",
    billed: (ttl, masked) =>
      `Abgerechnet · ${masked ? "Betrag ausgeblendet · " : ""}${ttl} Cache-TTL`,
    ask: [
      { w: "where", text: "Wohin" },
      { w: "did", text: "ist" },
      { w: "your", text: "dein" },
      { w: "money", text: "Geld", em: true },
      { w: "go", text: "geflossen?" },
    ],
    answer: [
      { w: "where", text: "Wohin" },
      { w: "your", text: "dein" },
      { w: "money", text: "Geld", em: true },
      { w: "went", text: "geflossen ist" },
    ],
    scope: (sessions, days, requests) =>
      [`${sessions} Sitzungen`, days ? `${days} Tage` : null, `${requests} Anfragen`]
        .filter(Boolean)
        .join(" · "),
  },
  strip: {
    thesis: (
      <>
        Eine <em>Mitschlepp</em>-Rechnung, keine Nutzungsrechnung — jede Anfrage berechnet den
        ganzen Kontext neu.
      </>
    ),
    carried: (times) => `Einmal geschrieben, ${times} mitgeschleppt`,
    split: (thinking) => `Eingabe zu Ausgabe · Denken ${thinking}`,
    of: " von",
    theBill: "der Rechnung",
    fixedMasked: (requests) => `Fix, auf allen ${requests} Anfragen gezahlt`,
    fixedOpen: (amount) => `Fix, bei jeder Anfrage · ${amount}`,
  },
  chart: {
    panels: "Panels",
    table: "Tabelle",
    mosaic: "Mosaik",
    sunburst: "Sunburst",
    breadcrumb: "Brotkrumenpfad",
    all: "alles",
    headMosaic:
      "Jeder Posten · Spaltenbreite = Anteil an der Rechnung · Blockhöhe = Anteil an der Spalte",
    headMosaicRows:
      "Jeder Posten · Zeilenhöhe = Anteil an der Rechnung · Blockbreite = Anteil an der Zeile",
    headSun: "Jeder Posten · Bogen = Anteil am inneren Ring · jeder Ring eine Ebene tiefer",
    hoverIdle: (gen, carry) =>
      `Hervorgehobener Block = Prosa, einmal für ${gen} geschrieben, als Eingabe für weitere ${carry} neu berechnet. ` +
      "Für den Posten über einen Block fahren.",
    hoverLine: (name, amount, share, under) => `${name}   ${amount}   ${share} von ${under}`,
  },
  sun: {
    back: "Eine Ebene zurück",
    goBack: "klicken, um zurückzugehen",
    drillIn: "auf einen Sektor klicken, um hineinzugehen",
    lineItems: (n) => `${n} Posten`,
    aria: (n, total) =>
      `Sunburst: ${n} Posten mit insgesamt ${total}, jeder Ring ein Anteil des Rings darin`,
    empty: (label) => `Unter ${label} gibt es keine weitere Aufschlüsselung.`,
    foldedNote: "der eingeklappte Rest · vollständig, in der Tabelle aufgeführt",
    itemsNote: (n) => `${n} Eintr${n === 1 ? "ag" : "äge"}`,
    leafNote: "einzelner Posten · keine weitere Aufschlüsselung",
    ofLabel: (share, label) => (
      <>
        {share} von {label}
      </>
    ),
  },
  panels: {
    leaf: "einzelner Posten · keine weitere Aufschlüsselung",
    shown: (shown, whole) => `gezeigt: ${shown} von ${whole}`,
    ofBill: (amount) => `${amount} der Rechnung`,
    perReq: (amount) => `${amount}/Anfr.`,
  },
  breakdown: {
    title: "Aufschlüsselung",
    find: "Suchen",
    findPlaceholder: "git diff, thinking, schema…",
    reconciled: "Abgestimmt",
    reconciledIs: (amount) => (
      <>
        Abgestimmt: <strong>{amount}</strong>
      </>
    ),
    noteFiltered: (amount) =>
      `Gefilterte Ansicht · ${amount} über die passenden Posten, gezeigt im Kontext ihrer ` +
      "Elternzeilen; die Elternzeilen behalten ihre vollen Summen.",
    noteWhole:
      "Auf jeder Ebene summieren sich die Kinder zum Elternteil; eingeklappte Zeilen behalten ihren vollen Wert.",
    noteGap: (gap) => ` ${gap} der abgerechneten Summe sind nicht zugeordnete Rundung.`,
  },
  table: {
    lineItem: "Posten",
    cost: "Kosten",
    share: "Anteil",
    magnitude: "Größe",
    perRequest: "Pro Anfrage",
    shareOfBill: "Anteil an der Rechnung",
    matched: "Treffer",
    noMatch: (query) => `Kein Posten passt zu „${query}“.`,
  },
  foot: {
    monday: "Was du am Montag ändern kannst",
    caveats: "Vorbehalte",
    intake: (p) => (
      <>
        <strong>Kürze, was hereinkommt, nicht was hinausgeht.</strong> {p.ingest} der Rechnung sind
        Inhalte, die Tools <em>in</em> den Kontext gezogen haben, gegenüber {p.emit} an gesendeten
        Argumenten und {p.typed} für alles, was du getippt hast
        {p.ratio ? ` (${p.ratio}× weniger)` : ""}. Tool-Ausgaben landen vollständig im Präfix und
        werden neu berechnet, bis sie herausfallen — verlange engere Ausschnitte.
      </>
    ),
    preamble: (fixed, requests) => (
      <>
        <strong>Kürze die Präambel.</strong> {fixed} fixer Overhead ist die einzige Zeile, die du
        einmal löschen kannst, um sie nicht {requests} Mal zu bezahlen.
      </>
    ),
    compact: (
      <>
        <strong>Kompaktiere früher.</strong> Die Mitschleppkosten sind linear darin, wie lange ein
        Ergebnis überlebt, nicht darin, wie groß es aussah.
      </>
    ),
    ttlCaveat: (gap) =>
      "Cache-Schreibvorgänge kosten bei 1h TTL das 2-fache der Eingabe und bei 5m das 1,25-fache. " +
      "Wo das Transkript festhält, was galt, wird das wörtlich übernommen; der Schalter bepreist nur " +
      `neu, was es ausgelassen hat — deshalb unterscheiden sich die beiden Sichten hier nur um ${gap}.`,
    outputCaveat:
      "„Modellausgabe“ übersteigt die Ausgaben für Ausgabe-Tokens, weil einmal geschriebene Prosa " +
      "bei jeder späteren Anfrage als Eingabe neu berechnet wird.",
    foldCaveat: (pct) =>
      `Blöcke unter ${pct} ihres Elternteils werden zu einem beschrifteten „Sonstige“ zusammengefasst; ` +
      "nichts geht verloren. Die Identität trägt die Tabelle ebenso wie der Farbton.",
    densityCaveat: (density) =>
      `Die Summen sind exakt; die Aufteilung auf die Posten wird aus Zeichenzahlen mit ${density} geschätzt.`,
    densityMeasured: (code, text, calibrated) =>
      `${code} Zeichen/Token für Maschinentext und ${text} für Prosa, ` +
      (calibrated
        ? "beide an diesem Datensatz gemessen"
        : "Standardwerte, zu wenige Stichproben zum Messen"),
    densityFallback: "~4 Zeichen/Token",
    ttlShareCaveat: (share, models) =>
      `Die Cache-TTL war für ${share} der geschriebenen Tokens festgehalten, daher bepreist die ` +
      "Sicht oben nur den Rest neu." +
      (models ? ` Modelle: ${models}.` : ""),
    unknownShare: "einen unbekannten Anteil",
  },
  intake: {
    heading: (folder) => <>Lege deinen Ordner {folder} hier ab</>,
    headingTouch: "Visualisiere deine KI-Rechnung",
    lede: "Zeichne deine KI-Rechnung: jedes Tool, jedes Unterkommando, jeden Dollar.",
    ledeTouch:
      "Jedes Tool, jedes Unterkommando, jeden Dollar — gelesen aus deinen Claude-Code-Sitzungen.",
    choose: "Ordner wählen",
    example: "Beispiel ansehen",
    hidden: "Der Ordner ist versteckt",
    yours: "Für deine eigene Rechnung",
    yoursBody: (
      <>
        Öffne diese Seite auf dem Rechner, auf dem du Claude Code ausführst, und wähle den Ordner{" "}
        <code>~/.claude/projects</code>.
      </>
    ),
    osTip: (current, next) => `Nicht ${current}? Drücken für den Weg unter ${next}.`,
    reading: "Lesen",
    privacy: "In dieser Seite ausgewertet · nichts wird hochgeladen",
    how: {
      mac: (
        <>
          Im Dialog <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>.</kbd> drücken, um versteckte Ordner zu zeigen. Oder <kbd>⇧</kbd>
          <kbd>⌘</kbd>
          <kbd>G</kbd> und <code>~/.claude/projects</code> einfügen.
        </>
      ),
      win: (
        <>
          Tippe <code>%USERPROFILE%\.claude\projects</code> in das Feld <em>Ordner</em> des Dialogs
          und drücke <kbd>Enter</kbd>.
        </>
      ),
      linux: (
        <>
          Im Dialog <kbd>Strg</kbd>
          <kbd>L</kbd> drücken, <code>~/.claude/projects</code> tippen, <kbd>Enter</kbd>.
        </>
      ),
    },
    errNothing: "Keine Dateien ausgewählt.",
    errNoJsonl: (root) => (
      <>
        {root} enthält keine <code>.jsonl</code>-Transkripte. Claude Code schreibt eines pro
        Sitzung, unter <code>~/.claude/projects</code>.
      </>
    ),
    errLoose: (n) => (
      <>
        Keine dieser {n} Datei(en) ist ein <code>.jsonl</code>-Transkript.
      </>
    ),
    errRead: (message) => `Die Dateien konnten nicht gelesen werden: ${message}`,
    errAnalysis: (message) => `Die Analyse ist fehlgeschlagen: ${message}`,
    errNoneBilled: (n, root) => (
      <>
        {n} Transkript{n > 1 ? "e" : ""} aus {root ?? "diesem Ordner"} gelesen, und keines davon
        enthält eine bepreiste API-Anfrage — hier wurde nichts abgerechnet.
      </>
    ),
    errNotClaude: (n, root) => (
      <>
        Diese {n} <code>.jsonl</code>-Datei{n > 1 ? "en" : ""} enthalten keine bepreiste
        API-Anfrage. {root ? <>{root} ist nicht</> : "Sie stammen nicht aus"}{" "}
        <code>~/.claude/projects</code>, wo Claude Code seine Transkripte ablegt.
      </>
    ),
  },
  where: {
    handingOver: "Was du aus der Hand gibst",
    handingOverBody: (
      <>
        Eine <code>.jsonl</code>-Datei pro Sitzung, ein Ordner pro Projekt, unter{" "}
        <code>~/.claude/projects/</code> — ein Dotfile, weshalb jeder Dateidialog ihn versteckt, bis
        du ihn beim Namen verlangst. Alles, was du wählst, wird zu einem Bericht zusammengeführt:
        die Aufschlüsselung erfolgt danach, wofür das Geld ausgegeben wurde, nicht danach, in
        welchem Ordner — wähle also den Ordner eines einzelnen Projekts, wenn du dessen Rechnung
        willst.
      </>
    ),
    terminal: "Lieber im Terminal?",
    terminalBody: (
      <>
        Öffne den Ordner im Dateimanager und ziehe ihn auf die Karte oben:{" "}
        <code>open ~/.claude/projects</code>
      </>
    ),
    largest: (
      <>
        Die größten Projekte zuerst: <code>du -sh ~/.claude/projects/*/ | sort -rh | head</code>
      </>
    ),
    noUpload: "Nichts wird hochgeladen",
    noUploadBody:
      "Die Dateien werden in dieser Seite gelesen und die Rechnung hier berechnet: Es gibt keinen " +
      "Server, an den ein Transkript ginge, und der Build schlägt fehl, wenn hier drin irgendetwas " +
      "das Netz berührt. Speichere die Seite, und sie funktioniert von der Festplatte genauso.",
    linkTitle: "Ein geteilter Link trägt die Ansicht, nicht die Rechnung",
    linkBody:
      "Die Adresse hält fest, welche Sicht und welchen Block du ansiehst — nie die Zahlen. Wer sie " +
      "öffnet, bekommt eine leere Karte und legt seine eigenen Transkripte hinein.",
  },
  labels: {
    all: "alles",
    other: "Sonstige",
    "Shell commands": "Shell-Befehle",
    "Tools · content read in": "Tools · hereingelesen",
    "Tools · content written out": "Tools · hinausgeschrieben",
    "Tools · two-way": "Tools · beidseitig",
    "Model output": "Modellausgabe",
    "System prompt & tool schemas": "System-Prompt und Tool-Schemas",
    "Harness & reminders": "Harness und Reminder",
    "Images & attachments": "Bilder und Anhänge",
    "My typing": "Mein Getipptes",
    Shell: "Shell",
    "Read in": "Hereingelesen",
    "Written out": "Hinausgeschrieben",
    "Two-way": "Beidseitig",
    Output: "Ausgabe",
    "System prompt": "System-Prompt",
    Harness: "Harness",
    Media: "Medien",
    "system prompt + tool schemas": "System-Prompt + Tool-Schemas",
    harness: "harness",
    "your typed messages": "deine getippten Nachrichten",
    thinking: "Denken",
    "assistant prose (generated)": "Assistenz-Prosa (erzeugt)",
    "tool-call arguments": "Argumente des Tool-Aufrufs",
    "assistant prose (re-billed as input)": "Assistenz-Prosa (als Eingabe neu berechnet)",
    "thinking blocks (re-billed as input)": "Denkblöcke (als Eingabe neu berechnet)",
    "(output)": "(Ausgabe)",
    "(no command parsed)": "(kein Befehl erkannt)",
    "(no path parsed)": "(kein Pfad erkannt)",
  },
  suffix: { results: "Ergebnisse", callArgs: "Aufrufargumente" },
  folded: (n) => `Sonstige (${n} Einträge)`,
}

const DICTS: Record<Lang, Dict> = { en: EN, zh: ZH, ja: JA, es: ES, fr: FR, de: DE }

export function dict(l: Lang): Dict {
  return DICTS[l]
}

/** The words for the language the page is currently in. */
export function useT(): Dict {
  return DICTS[useViewState().lang]
}

/** The languages, for the switcher. */
export { LANGS }

/* the names in the tree ---------- The engine's labels stay English inside the analysis: they
   key the palette, they are what `state.path` carries into the shared link, and one of them is
   what the mosaic and the sunburst test to find the block this page argues about. */

/** The two suffixes the engine hangs off a tool's own name when both directions cost real money. */
const SUFFIXES: ReadonlyArray<[string, (t: Dict) => string]> = [
  [" · results", (t) => t.suffix.results],
  [" · call args", (t) => t.suffix.callArgs],
]

export function labelOf(t: Dict, name: string): string {
  const known = t.labels[name]
  if (known !== undefined) return known
  for (const [suffix, word] of SUFFIXES)
    if (name.endsWith(suffix)) return `${labelOf(t, name.slice(0, -suffix.length))} · ${word(t)}`
  return name
}

/** A node as the reader should see it named. */
export function nodeName(t: Dict, n: CostNode): string {
  return n.folded ? t.folded(n.foldCount ?? 0) : labelOf(t, n.name)
}

/** The group whose rows are programs rather than tools. */
const SHELL = GROUPS.find((g) => g.id === "shell")?.name

/** Whether a name is text off the reader's own machine -- `git status`, `*.ts`, a path -- and so
 *  is set as code rather than as prose. */
export function isCode(t: Dict, name: string, under: string | null, group: string): boolean {
  if (t.labels[name] !== undefined) return false
  if (under !== null && under !== group && under !== name) return true
  return group === SHELL
}
