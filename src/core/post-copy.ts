/* The captions that travel with the shared image, in every language the page speaks. */

import type { GroupId } from "./engine.ts"
import type { Draft } from "./model.ts"
import type { Lang } from "./i18n.ts"

/** One language's captions. */
export interface PostCopy {
  /** The span a caption is about: days where the transcripts carry dates, sessions otherwise. */
  scopeDays: (n: number) => string
  scopeSessions: (n: number, formatted: string) => string
  /** "$12.30 of $98.00", and the covered form that names no total. */
  outOf: (amt: string, total: string) => string
  outOfMasked: (share: string) => string
  /** How a group is said out loud. */
  said: Partial<Record<GroupId, string>>

  a: (p: {
    name: string
    amt: string
    outOf: string
    scope: string
    masked: boolean
    second: string | null
    secondAmt: string
  }) => Draft
  b: (p: {
    name: string
    amt: string
    scope: string
    masked: boolean
    rest: Array<{ name: string; amt: string }>
  }) => Draft
  c: (p: {
    total: string | null
    scope: string
    requests: string
    typedShare: string | null
  }) => Draft
  d: (p: { outOf: string }) => Draft
  e: (p: { times: string; gen: string | null; carry: string }) => Draft
  f: (p: { total: string | null; scope: string; said: string; share: string }) => Draft

  /* The styles below carry two or three phrasings each, drawn from the same flat list as the
     six above: a style that survives its guard on most datasets would otherwise arrive in the
     same words every time it came up. */

  g: (p: {
    total: string | null
    scope: string
    requests: string
    each: string | null
    said: string
    share: string
  }) => Draft[]
  h: (p: { perDay: string; perRequest: string | null; days: string; requests: string }) => Draft[]
  i: (p: { times: string; scope: string; requests: string }) => Draft[]
  j: (p: { amt: string; share: string | null; scope: string; masked: boolean }) => Draft[]
  k: (p: { amt: string; requests: string; scope: string }) => Draft[]
  l: (p: { amt: string; scope: string; masked: boolean }) => Draft[]
  m: () => Draft[]
  n: (p: { scope: string; rows: Array<{ name: string; amt: string }> }) => Draft[]
  o: (p: { wroteMore: boolean; hi: string; lo: string }) => Draft[]
  p: (p: { name: string; amt: string }) => Draft[]
  q: (p: { name: string; amt: string; scope: string; masked: boolean }) => Draft[]
  r: () => Draft[]
}

const EN: PostCopy = {
  scopeDays: (n) => `${n} day${n === 1 ? "" : "s"}`,
  scopeSessions: (n, f) => `${f} session${n === 1 ? "" : "s"}`,
  outOf: (amt, total) => `${amt} of ${total}`,
  outOfMasked: (share) => `${share} of it`,
  said: {
    shell: "shell commands",
    ingest: "what tools read into the context",
    emit: "what tools wrote back out",
    twoway: "tool traffic, both directions",
    output: "the model's own output",
    preamble: "the system prompt and tool schemas",
    harness: "harness scaffolding and reminders",
    media: "images and attachments",
    typed: "the part I actually typed",
  },
  a: (p) => {
    const mine = p.masked
      ? `Mine's ${p.name}, at ${p.amt} of the bill.`
      : `Mine's ${p.name}, at ${p.outOf} over ${p.scope}.`
    return {
      lines: [
        "What's the most expensive tool on your Claude Code bill?",
        p.second ? `${mine} Second was ${p.second}, at ${p.secondAmt}.` : mine,
      ],
      cta: "Find yours",
    }
  },
  b: (p) => ({
    lines: [
      `Guess what ${p.name} costs you in Claude Code.`,
      (p.masked ? `Mine was ${p.amt} of my bill. ` : `Mine was ${p.amt} over ${p.scope}. `) +
        p.rest.map((n) => `${n.name} was ${n.amt}.`).join(" "),
      "Every command's output sits in your context and gets re-billed on every turn after it.",
    ],
    cta: "Yours",
  }),
  c: (p) => ({
    lines: [
      "What's your AI agent actually costing you?",
      `Mine: ${p.total ? `${p.total} over ` : ""}${p.scope} and ${p.requests} requests.` +
        (p.typedShare ? ` I typed ${p.typedShare} of it.` : ""),
    ],
    cta: "Itemise yours",
  }),
  d: (p) => ({
    lines: [
      "Quick — what's the biggest line on your Claude Code bill?",
      `It isn't what you type. That was ${p.outOf}.`,
      "The rest is rent on context you never see.",
    ],
    cta: "See yours",
  }),
  e: (p) => ({
    lines: [
      "Which costs more in Claude Code: what the model writes, or what it re-reads?",
      p.gen
        ? `Mine: ${p.gen} to write. ${p.carry} to re-read the same prose on later turns. ${p.times}.`
        : `Mine: re-reading its own prose cost ${p.times} what writing it did.`,
    ],
    cta: "Check yours",
  }),
  f: (p) => ({
    lines: [
      p.total
        ? `${p.total} of Claude Code over ${p.scope}, itemised.`
        : `Itemised ${p.scope} of my Claude Code bill.`,
      `Biggest line: ${p.said}, ${p.share} of it.`,
      "You don't pay for what the model writes — you pay rent on your context.",
    ],
    cta: "Show me yours",
  }),

  g: (p) => [
    {
      lines: [
        p.total ? `${p.total} — Claude Code, ${p.scope}.` : `Claude Code, ${p.scope}.`,
        `${p.requests} requests${p.each ? `, ${p.each} each` : ""}. Biggest line: ${p.said}, ${p.share}.`,
      ],
      cta: "Yours",
    },
    {
      lines: [
        `${p.scope}. ${p.requests} requests.${p.total ? ` ${p.total}.` : ""}`,
        `${p.share} of it went on ${p.said}.`,
      ],
      cta: "Itemise yours",
    },
    {
      lines: [
        `Claude Code${p.total ? `, ${p.total}` : ""}, ${p.scope}.`,
        `No tips, no thread. Just the receipt: ${p.said}, ${p.share} of the bill.`,
      ],
      cta: "Pull yours",
    },
  ],

  h: (p) => [
    {
      lines: [
        `My Claude Code habit runs ${p.perDay} a day.`,
        `${p.days} days, ${p.requests} requests${p.perRequest ? `, ${p.perRequest} a request` : ""}. I thought I was buying answers. I was renting context.`,
      ],
      cta: "Price yours",
    },
    {
      lines: [
        p.perRequest
          ? `Every time I hit enter in Claude Code it costs ${p.perRequest}.`
          : `Claude Code is a ${p.perDay}-a-day habit.`,
        `${p.requests} requests over ${p.days} days, ${p.perDay} a day — and most of it isn't the answer.`,
      ],
      cta: "Work out yours",
    },
  ],

  i: (p) => [
    {
      lines: [
        `Typing is the cheapest thing I do in Claude Code. The context around it costs ${p.times} more.`,
        `${p.scope}, ${p.requests} requests.`,
      ],
      cta: "Check yours",
    },
    {
      lines: [
        `For every dollar of what I actually typed into Claude Code, the context around it cost ${p.times} that.`,
        "You aren't paying for your prompt. You're paying rent on everything it drags in behind it.",
      ],
      cta: "Do the maths on yours",
    },
  ],

  j: (p) => [
    {
      lines: [
        p.masked
          ? `${p.amt} of my Claude Code bill was thinking I never read.`
          : `I paid ${p.amt} for thinking I never read.`,
        `Reasoning bills like any other output${p.share ? `, and mine came to ${p.share} of ${p.scope}` : ` — that over ${p.scope}`}.`,
      ],
      cta: "Check yours",
    },
    {
      lines: [
        "The model thinks before it answers, and you buy the thinking too.",
        `Mine was ${p.amt} over ${p.scope}. Not the answer — the deliberation in front of it.`,
      ],
      cta: "See yours",
    },
  ],

  k: (p) => [
    {
      lines: [
        "Every Claude Code request has a price before you type a character.",
        `System prompt and tool schemas, sent again ${p.requests} times: ${p.amt}. I never saw a token of it.`,
      ],
      cta: "Price yours",
    },
    {
      lines: [
        `${p.amt} of my Claude Code bill was spent before I said anything.`,
        `That's the system prompt and the tool schemas, shipped again on every one of ${p.requests} requests.`,
      ],
      cta: "Find yours",
    },
  ],

  l: (p) => [
    {
      lines: [
        p.masked
          ? `${p.amt} of my Claude Code bill was the model re-reading its own thoughts.`
          : `Today I learned I paid ${p.amt} to have a model re-read its own thoughts.`,
      ],
      cta: "Your turn",
    },
    {
      lines: [
        `${p.amt} of ${p.scope} of Claude Code went on the model reading back what it had already written.`,
        "Nobody sends you an invoice for that. The transcript does.",
      ],
      cta: "See yours",
    },
  ],

  m: () => [
    {
      lines: [
        "The most expensive line on my Claude Code bill isn't the model's answers.",
        "It isn't what I typed either. It's the same text, re-read on every turn after it.",
      ],
      cta: "Find yours",
    },
    {
      lines: [
        "I itemised my Claude Code bill and the biggest line was something I never looked at once.",
      ],
      cta: "See yours",
    },
    {
      lines: [
        "Everyone's off optimising their prompts.",
        "The bill isn't in the prompt. It's in everything the prompt drags into the context behind it, charged again every turn.",
      ],
      cta: "Look at yours",
    },
  ],

  n: (p) => [
    {
      lines: [
        `${p.scope} of Claude Code, itemised.`,
        p.rows.map((r) => `${r.name} — ${r.amt}`).join("\n"),
      ],
      cta: "Itemise yours",
    },
    {
      lines: [
        "My Claude Code bill, biggest line first:",
        p.rows.map((r) => `${r.amt} — ${r.name}`).join("\n"),
        `That's ${p.scope}.`,
      ],
      cta: "Yours",
    },
  ],

  o: (p) => [
    {
      lines: [
        "Which is bigger on your Claude Code bill: everything the model wrote, or everything your tools read in?",
        p.wroteMore
          ? `I'd have said the second. It was the first, ${p.hi} to ${p.lo}.`
          : `I'd have said the first. It was the second, ${p.hi} to ${p.lo}.`,
      ],
      cta: "Settle yours",
    },
    {
      lines: [
        p.wroteMore
          ? `On my Claude Code bill, what the model wrote (${p.hi}) beat what my tools read in (${p.lo}).`
          : `On my Claude Code bill, what my tools read in (${p.hi}) beat what the model wrote (${p.lo}).`,
        "One of those I asked for. The other just turned up.",
      ],
      cta: "Compare yours",
    },
  ],

  p: (p) => [
    {
      lines: [
        `The most expensive program on my Claude Code bill is ${p.name}.`,
        "Not the model. The program.",
      ],
      cta: "Find yours",
    },
    {
      lines: [
        `${p.name} cost me ${p.amt} of Claude Code.`,
        "It doesn't think and it doesn't answer. It just puts things in the context that get billed again every turn after.",
      ],
      cta: "See yours",
    },
  ],

  q: (p) => [
    {
      lines: [
        "The cheapest optimisation in Claude Code isn't a better prompt.",
        `It's keeping a huge tool output out of the context at all — you pay for it again on every turn after. ${p.name} alone: ${p.amt}${p.masked ? "" : ` over ${p.scope}`}.`,
      ],
      cta: "Check yours",
    },
    {
      lines: [
        p.masked
          ? `${p.name} was ${p.amt} of my Claude Code bill.`
          : `${p.name} was ${p.amt} of my Claude Code bill over ${p.scope}.`,
        "Not because I called it a lot. Because what it returned sat in the context and got re-billed every turn after.",
      ],
      cta: "Check yours",
    },
  ],

  r: () => [
    {
      lines: [
        "Guess the biggest line on my Claude Code bill. One try.",
        "It isn't the model writing code.",
      ],
      cta: "Then go and find yours",
    },
    {
      lines: [
        "Bet you can't say what you're actually paying for in Claude Code.",
        "It isn't the answers. It's what sits in the context while you get them.",
      ],
      cta: "Prove me wrong",
    },
    {
      lines: [
        "Reply with the biggest line on your Claude Code bill. I'll go first: it wasn't anything I typed.",
      ],
      cta: "Get yours",
    },
  ],
}

const ZH: PostCopy = {
  scopeDays: (n) => `${n} 天`,
  scopeSessions: (_n, f) => `${f} 个会话`,
  outOf: (amt, total) => `${amt}（总计 ${total}）`,
  outOfMasked: (share) => `账单的 ${share}`,
  said: {
    shell: "终端命令",
    ingest: "工具读进上下文的内容",
    emit: "工具写出去的内容",
    twoway: "双向的工具流量",
    output: "模型自己的输出",
    preamble: "系统提示词和工具 schema",
    harness: "框架脚手架和提醒",
    media: "图片和附件",
    typed: "我自己敲的那部分",
  },
  a: (p) => {
    const mine = p.masked
      ? `我的是 ${p.name}，占账单的 ${p.amt}。`
      : `${p.scope}里，我的是 ${p.name}，${p.outOf}。`
    return {
      lines: [
        "你的 Claude Code 账单上，最贵的工具是哪个？",
        p.second ? `${mine}第二名是 ${p.second}，${p.secondAmt}。` : mine,
      ],
      cta: "查你的",
    }
  },
  b: (p) => ({
    lines: [
      `猜猜 ${p.name} 在 Claude Code 里花了你多少钱。`,
      (p.masked ? `我的是账单的 ${p.amt}。` : `我这 ${p.scope}花了 ${p.amt}。`) +
        p.rest.map((n) => `${n.name} ${n.amt}。`).join(""),
      "每条命令的输出都留在上下文里，之后每一轮都要重新计费。",
    ],
    cta: "看你的",
  }),
  c: (p) => ({
    lines: [
      "你的 AI agent 到底在花你多少钱？",
      `我的：${p.scope}、${p.requests} 次请求` +
        (p.total ? `，共 ${p.total}` : "") +
        "。" +
        (p.typedShare ? ` 我自己敲的只占 ${p.typedShare}。` : ""),
    ],
    cta: "逐项看你的",
  }),
  d: (p) => ({
    lines: [
      "快说 —— 你 Claude Code 账单上最大的一笔是什么？",
      `不是你敲的字。那只有 ${p.outOf}。`,
      "剩下的都是你看不见的上下文的租金。",
    ],
    cta: "看看你的",
  }),
  e: (p) => ({
    lines: [
      "Claude Code 里哪个更贵：模型写下的，还是它反复重读的？",
      p.gen
        ? `我的：写花了 ${p.gen}，之后每轮重读同样的话又花了 ${p.carry}，${p.times}。`
        : `我的：重读自己写的话，花了写它的 ${p.times}。`,
    ],
    cta: "查你的",
  }),
  f: (p) => ({
    lines: [
      p.total
        ? `${p.scope}里 ${p.total} 的 Claude Code 账单，逐项列出。`
        : `${p.scope}的 Claude Code 账单，逐项列出。`,
      `最大的一笔：${p.said}，占 ${p.share}。`,
      "你付的不是模型写的字，是上下文的租金。",
    ],
    cta: "给我看你的",
  }),

  g: (p) => [
    {
      lines: [
        p.total ? `${p.total} —— Claude Code，${p.scope}。` : `Claude Code，${p.scope}。`,
        `${p.requests} 次请求${p.each ? `，每次 ${p.each}` : ""}。最大一笔：${p.said}，${p.share}。`,
      ],
      cta: "看你的",
    },
    {
      lines: [
        `${p.scope}，${p.requests} 次请求。${p.total ? `共 ${p.total}。` : ""}`,
        `其中 ${p.share} 花在了${p.said}上。`,
      ],
      cta: "逐项看你的",
    },
    {
      lines: [
        `Claude Code${p.total ? ` ${p.total}` : ""}，${p.scope}。`,
        `不讲技巧，只有账单：${p.said}，占 ${p.share}。`,
      ],
      cta: "拉你的",
    },
  ],

  h: (p) => [
    {
      lines: [
        `我的 Claude Code，一天 ${p.perDay}。`,
        `${p.days} 天，${p.requests} 次请求${p.perRequest ? `，每次 ${p.perRequest}` : ""}。我以为买的是答案，其实租的是上下文。`,
      ],
      cta: "算算你的",
    },
    {
      lines: [
        p.perRequest
          ? `在 Claude Code 里每按一次回车，${p.perRequest}。`
          : `Claude Code 是个一天 ${p.perDay} 的习惯。`,
        `${p.days} 天 ${p.requests} 次请求，一天 ${p.perDay} —— 而且大部分不是答案。`,
      ],
      cta: "看你的",
    },
  ],

  i: (p) => [
    {
      lines: [
        `在 Claude Code 里，我敲的字是最便宜的。围着它的上下文贵 ${p.times}。`,
        `${p.scope}，${p.requests} 次请求。`,
      ],
      cta: "查你的",
    },
    {
      lines: [
        `我自己敲的每一块钱，周围的上下文要花掉 ${p.times}。`,
        "你付的不是提示词的钱，是它拖进来的一切的租金。",
      ],
      cta: "算算你的",
    },
  ],

  j: (p) => [
    {
      lines: [
        p.masked
          ? `账单的 ${p.amt}，是我从没读过的思考。`
          : `我为自己从没读过的思考付了 ${p.amt}。`,
        `思考和别的输出一样计费${p.share ? `，我这 ${p.scope}占了 ${p.share}` : `，这是 ${p.scope}的量`}。`,
      ],
      cta: "查你的",
    },
    {
      lines: [
        "模型回答之前先思考，而思考也是你买的。",
        `我这 ${p.scope}是 ${p.amt}。不是答案，是答案前面的斟酌。`,
      ],
      cta: "看你的",
    },
  ],

  k: (p) => [
    {
      lines: [
        "在 Claude Code 里，你还没敲字，这次请求就已经有价钱了。",
        `系统提示词和工具 schema，重发了 ${p.requests} 次：${p.amt}。我一个 token 都没看见。`,
      ],
      cta: "算你的",
    },
    {
      lines: [
        `我的 Claude Code 账单里，${p.amt} 是我开口之前就花掉的。`,
        `那是系统提示词和工具 schema，${p.requests} 次请求每次都重发一遍。`,
      ],
      cta: "找你的",
    },
  ],

  l: (p) => [
    {
      lines: [
        p.masked
          ? `账单的 ${p.amt}，是模型在重读自己写下的话。`
          : `今天才知道，我付了 ${p.amt} 让模型重读它自己的话。`,
      ],
      cta: "轮到你了",
    },
    {
      lines: [
        `${p.scope}的 Claude Code，${p.amt} 花在模型回头读它已经写过的东西上。`,
        "没人会为这个给你开发票，但记录里写着。",
      ],
      cta: "看你的",
    },
  ],

  m: () => [
    {
      lines: [
        "我 Claude Code 账单上最贵的一笔，不是模型的回答。",
        "也不是我敲的字。是同样的文字，在之后每一轮里被重读一次。",
      ],
      cta: "查你的",
    },
    {
      lines: ["把 Claude Code 账单逐项列出来，最大的一笔是我一眼都没看过的东西。"],
      cta: "看你的",
    },
    {
      lines: [
        "大家都在琢磨怎么把提示词写得更好。",
        "钱不在提示词里。在它拖进上下文的那一堆东西里，而且之后每一轮都重新计费。",
      ],
      cta: "看看你的",
    },
  ],

  n: (p) => [
    {
      lines: [
        `${p.scope}的 Claude Code，逐项列出。`,
        p.rows
          .slice(0, 3)
          .map((r) => `${r.name} —— ${r.amt}`)
          .join("\n"),
      ],
      cta: "列你的",
    },
    {
      lines: [
        "我的 Claude Code 账单，从大到小：",
        p.rows
          .slice(0, 3)
          .map((r) => `${r.amt} —— ${r.name}`)
          .join("\n"),
        `以上是${p.scope}。`,
      ],
      cta: "看你的",
    },
  ],

  o: (p) => [
    {
      lines: [
        "你的 Claude Code 账单上，哪个更大：模型写出来的，还是工具读进去的？",
        p.wroteMore
          ? `我本来会选后者。结果是前者，${p.hi} 对 ${p.lo}。`
          : `我本来会选前者。结果是后者，${p.hi} 对 ${p.lo}。`,
      ],
      cta: "验你的",
    },
    {
      lines: [
        p.wroteMore
          ? `我的账单里，模型写出来的（${p.hi}）压过了工具读进去的（${p.lo}）。`
          : `我的账单里，工具读进去的（${p.hi}）压过了模型写出来的（${p.lo}）。`,
        "一个是我要的，另一个是自己冒出来的。",
      ],
      cta: "比比你的",
    },
  ],

  p: (p) => [
    {
      lines: [`我 Claude Code 账单上最贵的程序是 ${p.name}。`, "不是模型。是那个程序。"],
      cta: "找你的",
    },
    {
      lines: [
        `${p.name} 在 Claude Code 里花了我 ${p.amt}。`,
        "它不思考也不回答，只是把东西塞进上下文，然后之后每一轮都重新计费。",
      ],
      cta: "看你的",
    },
  ],

  q: (p) => [
    {
      lines: [
        "Claude Code 里最省钱的优化，不是把提示词写得更好。",
        `是别让一大坨工具输出进上下文 —— 之后每轮都要再付一次。光 ${p.name} 就 ${p.amt}${p.masked ? "" : `（${p.scope}）`}。`,
      ],
      cta: "查你的",
    },
    {
      lines: [
        p.masked
          ? `${p.name} 占了我 Claude Code 账单的 ${p.amt}。`
          : `${p.scope}里，${p.name} 花了我 ${p.amt}。`,
        "不是因为我调用得多，是它返回的东西留在上下文里，之后每一轮都重新计费。",
      ],
      cta: "查你的",
    },
  ],

  r: () => [
    {
      lines: ["猜猜我 Claude Code 账单上最大的一笔是什么。只给一次机会。", "不是模型写代码。"],
      cta: "然后去查你的",
    },
    {
      lines: [
        "你多半说不出自己在 Claude Code 里到底为什么付钱。",
        "不是答案。是你拿到答案时，一直待在上下文里的那些东西。",
      ],
      cta: "来证明我错",
    },
    {
      lines: ["回复你 Claude Code 账单上最大的一笔。我先来：不是我敲的任何东西。"],
      cta: "拿你的",
    },
  ],
}

const JA: PostCopy = {
  scopeDays: (n) => `${n}日`,
  scopeSessions: (_n, f) => `${f}セッション`,
  outOf: (amt, total) => `${total} 中 ${amt}`,
  outOfMasked: (share) => `請求額の ${share}`,
  said: {
    shell: "シェルコマンド",
    ingest: "ツールがコンテキストに読み込んだ内容",
    emit: "ツールが書き出した内容",
    twoway: "双方向のツール通信",
    output: "モデル自身の出力",
    preamble: "システムプロンプトとツールスキーマ",
    harness: "ハーネスとリマインダー",
    media: "画像と添付ファイル",
    typed: "自分で打った分",
  },
  a: (p) => {
    const mine = p.masked
      ? `私は ${p.name} で、請求額の ${p.amt}。`
      : `私は ${p.scope}で ${p.name}、${p.outOf}。`
    return {
      lines: [
        "Claude Code の請求で、いちばん高いツールは？",
        p.second ? `${mine} 2位は ${p.second} で ${p.secondAmt}。` : mine,
      ],
      cta: "自分のを見る",
    }
  },
  b: (p) => ({
    lines: [
      `${p.name} が Claude Code でいくらかかるか当ててみて。`,
      (p.masked ? `私は請求額の ${p.amt}。` : `私は ${p.scope}で ${p.amt}。`) +
        p.rest.map((n) => `${n.name} は ${n.amt}。`).join(""),
      "コマンドの出力はコンテキストに残り、以降のターンごとに再課金される。",
    ],
    cta: "あなたのは",
  }),
  c: (p) => ({
    lines: [
      "あなたの AI エージェント、実際いくらかかってる？",
      `私は ${p.scope}・${p.requests} リクエスト` +
        (p.total ? `で ${p.total}` : "") +
        "。" +
        (p.typedShare ? ` 自分で打ったのは ${p.typedShare}。` : ""),
    ],
    cta: "内訳を見る",
  }),
  d: (p) => ({
    lines: [
      "さて — Claude Code の請求でいちばん大きい項目は？",
      `打った文字じゃない。それは ${p.outOf}。`,
      "残りは、見えないコンテキストの家賃。",
    ],
    cta: "自分のを見る",
  }),
  e: (p) => ({
    lines: [
      "Claude Code で高いのは、モデルが書いた分と読み直した分、どっち？",
      p.gen
        ? `私の場合、書くのに ${p.gen}、以降のターンで同じ文章を読み直すのに ${p.carry}。${p.times}。`
        : `私の場合、自分の文章を読み直すコストは書くコストの ${p.times}。`,
    ],
    cta: "確かめる",
  }),
  f: (p) => ({
    lines: [
      p.total
        ? `${p.scope}で ${p.total} の Claude Code 請求を項目別に。`
        : `${p.scope}分の Claude Code 請求を項目別に。`,
      `最大の項目：${p.said}、全体の ${p.share}。`,
      "払っているのはモデルが書いた分ではなく、コンテキストの家賃。",
    ],
    cta: "あなたのを見せて",
  }),

  g: (p) => [
    {
      lines: [
        p.total ? `${p.total} — Claude Code、${p.scope}。` : `Claude Code、${p.scope}。`,
        `${p.requests} リクエスト${p.each ? `、1回 ${p.each}` : ""}。最大の項目：${p.said}、${p.share}。`,
      ],
      cta: "あなたのは",
    },
    {
      lines: [
        `${p.scope}、${p.requests} リクエスト。${p.total ? `計 ${p.total}。` : ""}`,
        `うち ${p.share} が${p.said}。`,
      ],
      cta: "内訳を見る",
    },
    {
      lines: [
        `Claude Code${p.total ? ` ${p.total}` : ""}、${p.scope}。`,
        `コツの話はなし。請求書だけ：${p.said}、全体の ${p.share}。`,
      ],
      cta: "自分のを出す",
    },
  ],

  h: (p) => [
    {
      lines: [
        `私の Claude Code は1日 ${p.perDay}。`,
        `${p.days}日で ${p.requests} リクエスト${p.perRequest ? `、1回 ${p.perRequest}` : ""}。答えを買っているつもりで、コンテキストを借りていた。`,
      ],
      cta: "自分のを試算",
    },
    {
      lines: [
        p.perRequest
          ? `Claude Code で Enter を押すたびに ${p.perRequest}。`
          : `Claude Code は1日 ${p.perDay} の習慣。`,
        `${p.days}日で ${p.requests} リクエスト、1日 ${p.perDay}。しかも大半は答えじゃない。`,
      ],
      cta: "自分のを見る",
    },
  ],

  i: (p) => [
    {
      lines: [
        `Claude Code でいちばん安いのは自分で打つこと。まわりのコンテキストはその ${p.times}。`,
        `${p.scope}、${p.requests} リクエスト。`,
      ],
      cta: "確かめる",
    },
    {
      lines: [
        `自分で打った1ドルにつき、まわりのコンテキストに ${p.times} かかっている。`,
        "払っているのはプロンプト代じゃない。それが引きずり込む全部の家賃。",
      ],
      cta: "計算してみて",
    },
  ],

  j: (p) => [
    {
      lines: [
        p.masked
          ? `請求額の ${p.amt} は、一度も読まなかった思考。`
          : `一度も読まなかった思考に ${p.amt} 払っていた。`,
        `推論も他の出力と同じに課金される${p.share ? `。私は ${p.scope}で ${p.share}` : `。${p.scope}分`}。`,
      ],
      cta: "確かめる",
    },
    {
      lines: [
        "モデルは答える前に考える。その考えるぶんも買っている。",
        `私は ${p.scope}で ${p.amt}。答えではなく、その手前の熟考。`,
      ],
      cta: "自分のを見る",
    },
  ],

  k: (p) => [
    {
      lines: [
        "Claude Code のリクエストは、1文字打つ前から値段がついている。",
        `システムプロンプトとツールスキーマを ${p.requests} 回送り直して ${p.amt}。1トークンも見ていない。`,
      ],
      cta: "自分のを試算",
    },
    {
      lines: [
        `請求のうち ${p.amt} は、何か言う前に使われていた。`,
        `システムプロンプトとツールスキーマが、${p.requests} 回すべてに毎回積まれる。`,
      ],
      cta: "自分のを探す",
    },
  ],

  l: (p) => [
    {
      lines: [
        p.masked
          ? `請求額の ${p.amt} は、モデルが自分の思考を読み直した分。`
          : `モデルに自分の思考を読み直させるのに ${p.amt} 払っていた、と今日知った。`,
      ],
      cta: "次はあなた",
    },
    {
      lines: [
        `${p.scope}の Claude Code のうち ${p.amt} は、モデルが自分で書いたものを読み返す分だった。`,
        "誰も請求書は出さない。ログには出ている。",
      ],
      cta: "自分のを見る",
    },
  ],

  m: () => [
    {
      lines: [
        "Claude Code の請求でいちばん高い項目は、モデルの答えじゃない。",
        "自分が打った分でもない。同じ文章が、以降のターンごとに読み直されている分。",
      ],
      cta: "自分のを見る",
    },
    {
      lines: ["Claude Code の請求を項目別にしたら、最大の項目は一度も見ていないものだった。"],
      cta: "自分のを見る",
    },
    {
      lines: [
        "みんなプロンプトの磨き方を話している。",
        "請求はプロンプトにない。プロンプトがコンテキストに引き込むもの側にあって、毎ターン課金され直す。",
      ],
      cta: "自分のを見る",
    },
  ],

  n: (p) => [
    {
      lines: [
        `${p.scope}の Claude Code、項目別。`,
        p.rows
          .slice(0, 3)
          .map((r) => `${r.name} — ${r.amt}`)
          .join("\n"),
      ],
      cta: "自分のも出す",
    },
    {
      lines: [
        "私の Claude Code 請求、大きい順に：",
        p.rows
          .slice(0, 3)
          .map((r) => `${r.amt} — ${r.name}`)
          .join("\n"),
        `以上、${p.scope}分。`,
      ],
      cta: "あなたのは",
    },
  ],

  o: (p) => [
    {
      lines: [
        "Claude Code の請求で大きいのは、モデルが書いた分と、ツールが読み込んだ分のどっち？",
        p.wroteMore
          ? `後者だと思っていた。前者だった、${p.hi} 対 ${p.lo}。`
          : `前者だと思っていた。後者だった、${p.hi} 対 ${p.lo}。`,
      ],
      cta: "決着をつける",
    },
    {
      lines: [
        p.wroteMore
          ? `私の請求では、モデルが書いた分（${p.hi}）がツールの読み込み（${p.lo}）を上回った。`
          : `私の請求では、ツールの読み込み（${p.hi}）がモデルの書いた分（${p.lo}）を上回った。`,
        "片方は頼んだもの。もう片方は勝手に来たもの。",
      ],
      cta: "比べてみて",
    },
  ],

  p: (p) => [
    {
      lines: [
        `私の Claude Code 請求でいちばん高いプログラムは ${p.name}。`,
        "モデルじゃない。そのプログラム。",
      ],
      cta: "自分のを探す",
    },
    {
      lines: [
        `${p.name} に Claude Code で ${p.amt} かかっていた。`,
        "考えも答えもしない。コンテキストに物を置くだけで、以降のターンごとに課金され直す。",
      ],
      cta: "自分のを見る",
    },
  ],

  q: (p) => [
    {
      lines: [
        "Claude Code でいちばん安上がりな最適化は、プロンプトの改善じゃない。",
        `巨大なツール出力をそもそも入れないこと。以降のターンごとに払い直すので。${p.name} だけで ${p.amt}${p.masked ? "" : `（${p.scope}）`}。`,
      ],
      cta: "自分のを確認",
    },
    {
      lines: [
        p.masked
          ? `${p.name} は請求額の ${p.amt} だった。`
          : `${p.scope}で ${p.name} に ${p.amt}。`,
        "呼んだ回数のせいじゃない。返ってきた中身がコンテキストに残り、毎ターン課金され直したせい。",
      ],
      cta: "自分のを確認",
    },
  ],

  r: () => [
    {
      lines: [
        "私の Claude Code 請求で最大の項目、当ててみて。1回だけ。",
        "モデルがコードを書いた分じゃない。",
      ],
      cta: "そのあと自分のを見て",
    },
    {
      lines: [
        "Claude Code で実際に何にお金を払っているか、たぶん言えない。",
        "答えじゃない。答えを受け取る間ずっとコンテキストに居座っているもの。",
      ],
      cta: "違うと証明して",
    },
    {
      lines: ["あなたの Claude Code 請求の最大項目を返信で。まず私から：打ったものではなかった。"],
      cta: "自分のを出す",
    },
  ],
}

const ES: PostCopy = {
  scopeDays: (n) => `${n} día${n === 1 ? "" : "s"}`,
  scopeSessions: (n, f) => `${f} ${n === 1 ? "sesión" : "sesiones"}`,
  outOf: (amt, total) => `${amt} de ${total}`,
  outOfMasked: (share) => `${share} de la factura`,
  said: {
    shell: "los comandos de shell",
    ingest: "lo que las herramientas leyeron al contexto",
    emit: "lo que las herramientas escribieron de vuelta",
    twoway: "el tráfico de herramientas en ambos sentidos",
    output: "la salida del propio modelo",
    preamble: "el prompt de sistema y los esquemas de herramientas",
    harness: "el andamiaje y los recordatorios del harness",
    media: "las imágenes y los adjuntos",
    typed: "la parte que escribí yo",
  },
  a: (p) => {
    const mine = p.masked
      ? `La mía es ${p.name}, con ${p.amt} de la factura.`
      : `La mía es ${p.name}, con ${p.outOf} en ${p.scope}.`
    return {
      lines: [
        "¿Cuál es la herramienta más cara de tu factura de Claude Code?",
        p.second ? `${mine} La segunda fue ${p.second}, con ${p.secondAmt}.` : mine,
      ],
      cta: "Mira la tuya",
    }
  },
  b: (p) => ({
    lines: [
      `Adivina cuánto te cuesta ${p.name} en Claude Code.`,
      (p.masked ? `A mí me costó ${p.amt} de mi factura. ` : `A mí, ${p.amt} en ${p.scope}. `) +
        p.rest.map((n) => `${n.name} costó ${n.amt}.`).join(" "),
      "La salida de cada comando se queda en tu contexto y se recobra en cada turno posterior.",
    ],
    cta: "La tuya",
  }),
  c: (p) => ({
    lines: [
      "¿Cuánto te cuesta de verdad tu agente de IA?",
      `El mío: ${p.total ? `${p.total} en ` : ""}${p.scope} y ${p.requests} peticiones.` +
        (p.typedShare ? ` Yo escribí el ${p.typedShare}.` : ""),
    ],
    cta: "Desglosa la tuya",
  }),
  d: (p) => ({
    lines: [
      "Rápido: ¿cuál es la línea más grande de tu factura de Claude Code?",
      `No es lo que escribes. Eso fue ${p.outOf}.`,
      "El resto es alquiler por un contexto que nunca ves.",
    ],
    cta: "Mira la tuya",
  }),
  e: (p) => ({
    lines: [
      "¿Qué cuesta más en Claude Code: lo que el modelo escribe o lo que relee?",
      p.gen
        ? `En mi caso: ${p.gen} escribirla. ${p.carry} releer la misma prosa en turnos posteriores. ${p.times}.`
        : `En mi caso, releer su propia prosa costó ${p.times} lo que costó escribirla.`,
    ],
    cta: "Compruébalo",
  }),
  f: (p) => ({
    lines: [
      p.total
        ? `${p.total} de Claude Code en ${p.scope}, desglosado.`
        : `${p.scope} de mi factura de Claude Code, desglosada.`,
      `La línea mayor: ${p.said}, el ${p.share}.`,
      "No pagas por lo que el modelo escribe: pagas alquiler por tu contexto.",
    ],
    cta: "Enséñame la tuya",
  }),

  g: (p) => [
    {
      lines: [
        p.total ? `${p.total} — Claude Code, ${p.scope}.` : `Claude Code, ${p.scope}.`,
        `${p.requests} peticiones${p.each ? `, ${p.each} cada una` : ""}. La línea mayor: ${p.said}, el ${p.share}.`,
      ],
      cta: "La tuya",
    },
    {
      lines: [
        `${p.scope}. ${p.requests} peticiones.${p.total ? ` ${p.total}.` : ""}`,
        `El ${p.share} se fue en ${p.said}.`,
      ],
      cta: "Desglosa la tuya",
    },
    {
      lines: [
        `Claude Code${p.total ? `, ${p.total}` : ""}, ${p.scope}.`,
        `Sin consejos ni hilo. Solo la factura: ${p.said}, el ${p.share}.`,
      ],
      cta: "Saca la tuya",
    },
  ],

  h: (p) => [
    {
      lines: [
        `Mi vicio de Claude Code sale a ${p.perDay} al día.`,
        `${p.days} días, ${p.requests} peticiones${p.perRequest ? `, ${p.perRequest} cada una` : ""}. Creía que compraba respuestas. Alquilaba contexto.`,
      ],
      cta: "Calcula la tuya",
    },
    {
      lines: [
        p.perRequest
          ? `Cada vez que pulso enter en Claude Code me cuesta ${p.perRequest}.`
          : `Claude Code es un vicio de ${p.perDay} al día.`,
        `${p.requests} peticiones en ${p.days} días, ${p.perDay} al día — y casi nada de eso es la respuesta.`,
      ],
      cta: "Mira la tuya",
    },
  ],

  i: (p) => [
    {
      lines: [
        `Escribir es lo más barato que hago en Claude Code. El contexto que lo rodea cuesta ${p.times} más.`,
        `${p.scope}, ${p.requests} peticiones.`,
      ],
      cta: "Compruébalo",
    },
    {
      lines: [
        `Por cada dólar de lo que escribí yo, el contexto alrededor costó ${p.times} eso.`,
        "No pagas por tu prompt. Pagas alquiler por todo lo que arrastra detrás.",
      ],
      cta: "Haz las cuentas",
    },
  ],

  j: (p) => [
    {
      lines: [
        p.masked
          ? `El ${p.amt} de mi factura de Claude Code fue razonamiento que nunca leí.`
          : `Pagué ${p.amt} por un razonamiento que no leí nunca.`,
        `Razonar se factura como cualquier otra salida${p.share ? `, y lo mío fue el ${p.share} de ${p.scope}` : `, eso en ${p.scope}`}.`,
      ],
      cta: "Compruébalo",
    },
    {
      lines: [
        "El modelo piensa antes de responder, y ese pensar también lo compras tú.",
        `Lo mío fueron ${p.amt} en ${p.scope}. No la respuesta: la deliberación de delante.`,
      ],
      cta: "Mira la tuya",
    },
  ],

  k: (p) => [
    {
      lines: [
        "Cada petición de Claude Code tiene precio antes de que escribas una letra.",
        `Prompt de sistema y esquemas de herramientas, reenviados ${p.requests} veces: ${p.amt}. No vi ni un token.`,
      ],
      cta: "Calcula la tuya",
    },
    {
      lines: [
        `${p.amt} de mi factura de Claude Code se gastó antes de que yo dijera nada.`,
        `Es el prompt de sistema y los esquemas, enviados otra vez en cada una de las ${p.requests} peticiones.`,
      ],
      cta: "Busca la tuya",
    },
  ],

  l: (p) => [
    {
      lines: [
        p.masked
          ? `El ${p.amt} de mi factura de Claude Code fue el modelo releyendo sus propios pensamientos.`
          : `Hoy descubrí que pagué ${p.amt} para que un modelo releyera sus propios pensamientos.`,
      ],
      cta: "Te toca",
    },
    {
      lines: [
        `${p.amt} de ${p.scope} de Claude Code se fueron en releer lo que el propio modelo ya había escrito.`,
        "Nadie te manda una factura por eso. La transcripción sí.",
      ],
      cta: "Mira la tuya",
    },
  ],

  m: () => [
    {
      lines: [
        "La línea más cara de mi factura de Claude Code no son las respuestas del modelo.",
        "Tampoco es lo que escribí. Es el mismo texto, releído en cada turno posterior.",
      ],
      cta: "Mira la tuya",
    },
    {
      lines: [
        "Desglosé mi factura de Claude Code y la línea mayor era algo que no miré ni una vez.",
      ],
      cta: "Mira la tuya",
    },
    {
      lines: [
        "Todo el mundo puliendo sus prompts.",
        "La factura no está en el prompt. Está en todo lo que el prompt arrastra al contexto, cobrado otra vez en cada turno.",
      ],
      cta: "Mira la tuya",
    },
  ],

  n: (p) => [
    {
      lines: [
        `${p.scope} de Claude Code, desglosados.`,
        p.rows.map((r) => `${r.name} — ${r.amt}`).join("\n"),
      ],
      cta: "Desglosa la tuya",
    },
    {
      lines: [
        "Mi factura de Claude Code, de mayor a menor:",
        p.rows.map((r) => `${r.amt} — ${r.name}`).join("\n"),
        `Eso en ${p.scope}.`,
      ],
      cta: "La tuya",
    },
  ],

  o: (p) => [
    {
      lines: [
        "¿Qué pesa más en tu factura de Claude Code: todo lo que escribió el modelo o todo lo que leyeron tus herramientas?",
        p.wroteMore
          ? `Habría dicho lo segundo. Fue lo primero, ${p.hi} contra ${p.lo}.`
          : `Habría dicho lo primero. Fue lo segundo, ${p.hi} contra ${p.lo}.`,
      ],
      cta: "Resuelve la tuya",
    },
    {
      lines: [
        p.wroteMore
          ? `En mi factura, lo que escribió el modelo (${p.hi}) ganó a lo que leyeron mis herramientas (${p.lo}).`
          : `En mi factura, lo que leyeron mis herramientas (${p.hi}) ganó a lo que escribió el modelo (${p.lo}).`,
        "Una de las dos cosas la pedí yo. La otra apareció sola.",
      ],
      cta: "Compara la tuya",
    },
  ],

  p: (p) => [
    {
      lines: [
        `El programa más caro de mi factura de Claude Code es ${p.name}.`,
        "No el modelo. El programa.",
      ],
      cta: "Busca el tuyo",
    },
    {
      lines: [
        `${p.name} me costó ${p.amt} en Claude Code.`,
        "Ni piensa ni responde. Solo deja cosas en el contexto que se recobran en cada turno posterior.",
      ],
      cta: "Mira el tuyo",
    },
  ],

  q: (p) => [
    {
      lines: [
        "La optimización más barata en Claude Code no es un prompt mejor.",
        `Es no meter una salida enorme en el contexto — la pagas otra vez en cada turno. Solo ${p.name}: ${p.amt}${p.masked ? "" : ` en ${p.scope}`}.`,
      ],
      cta: "Mira la tuya",
    },
    {
      lines: [
        p.masked
          ? `${p.name} fue el ${p.amt} de mi factura de Claude Code.`
          : `${p.name} me costó ${p.amt} en ${p.scope} de Claude Code.`,
        "No por llamarlo mucho. Porque lo que devolvía se quedaba en el contexto y se recobraba en cada turno.",
      ],
      cta: "Mira la tuya",
    },
  ],

  r: () => [
    {
      lines: [
        "Adivina la línea mayor de mi factura de Claude Code. Un intento.",
        "No es el modelo escribiendo código.",
      ],
      cta: "Y luego mira la tuya",
    },
    {
      lines: [
        "A que no sabes por qué estás pagando de verdad en Claude Code.",
        "No son las respuestas. Es lo que está en el contexto mientras las recibes.",
      ],
      cta: "Demuéstrame que me equivoco",
    },
    {
      lines: [
        "Responde con la línea mayor de tu factura de Claude Code. Empiezo yo: no era nada que escribiera.",
      ],
      cta: "Saca la tuya",
    },
  ],
}

const FR: PostCopy = {
  scopeDays: (n) => `${n} jour${n === 1 ? "" : "s"}`,
  scopeSessions: (n, f) => `${f} session${n === 1 ? "" : "s"}`,
  outOf: (amt, total) => `${amt} sur ${total}`,
  outOfMasked: (share) => `${share} de la facture`,
  said: {
    shell: "les commandes shell",
    ingest: "ce que les outils ont lu dans le contexte",
    emit: "ce que les outils ont réécrit",
    twoway: "le trafic des outils, dans les deux sens",
    output: "la sortie du modèle lui-même",
    preamble: "le prompt système et les schémas d'outils",
    harness: "l'échafaudage et les rappels du harness",
    media: "les images et les pièces jointes",
    typed: "la part que j'ai tapée",
  },
  a: (p) => {
    const mine = p.masked
      ? `Le mien, c'est ${p.name}, à ${p.amt} de la facture.`
      : `Le mien, c'est ${p.name}, à ${p.outOf} sur ${p.scope}.`
    return {
      lines: [
        "Quel est l'outil le plus cher de votre facture Claude Code ?",
        p.second ? `${mine} Deuxième : ${p.second}, à ${p.secondAmt}.` : mine,
      ],
      cta: "Voyez la vôtre",
    }
  },
  b: (p) => ({
    lines: [
      `Devinez ce que ${p.name} vous coûte dans Claude Code.`,
      (p.masked ? `Chez moi, ${p.amt} de ma facture. ` : `Chez moi, ${p.amt} sur ${p.scope}. `) +
        p.rest.map((n) => `${n.name} : ${n.amt}.`).join(" "),
      "La sortie de chaque commande reste dans votre contexte et vous est refacturée à chaque tour suivant.",
    ],
    cta: "La vôtre",
  }),
  c: (p) => ({
    lines: [
      "Combien vous coûte vraiment votre agent IA ?",
      `Le mien : ${p.total ? `${p.total} sur ` : ""}${p.scope} et ${p.requests} requêtes.` +
        (p.typedShare ? ` J'ai tapé ${p.typedShare} du total.` : ""),
    ],
    cta: "Détaillez la vôtre",
  }),
  d: (p) => ({
    lines: [
      "Vite : quelle est la plus grosse ligne de votre facture Claude Code ?",
      `Ce n'est pas ce que vous tapez. Cela n'a fait que ${p.outOf}.`,
      "Le reste, c'est le loyer d'un contexte que vous ne voyez jamais.",
    ],
    cta: "Voyez la vôtre",
  }),
  e: (p) => ({
    lines: [
      "Qu'est-ce qui coûte le plus dans Claude Code : ce que le modèle écrit, ou ce qu'il relit ?",
      p.gen
        ? `Chez moi : ${p.gen} pour l'écrire. ${p.carry} pour relire la même prose aux tours suivants. ${p.times}.`
        : `Chez moi, relire sa propre prose a coûté ${p.times} ce que l'écrire a coûté.`,
    ],
    cta: "Montrez la vôtre",
  }),
  f: (p) => ({
    lines: [
      p.total
        ? `${p.total} de Claude Code sur ${p.scope}, détaillé.`
        : `${p.scope} de ma facture Claude Code, détaillée.`,
      `Plus grosse ligne : ${p.said}, ${p.share} du total.`,
      "Vous ne payez pas ce que le modèle écrit — vous payez le loyer de votre contexte.",
    ],
    cta: "Montrez la vôtre",
  }),

  g: (p) => [
    {
      lines: [
        p.total ? `${p.total} — Claude Code, ${p.scope}.` : `Claude Code, ${p.scope}.`,
        `${p.requests} requêtes${p.each ? `, ${p.each} chacune` : ""}. Plus grosse ligne : ${p.said}, ${p.share}.`,
      ],
      cta: "La vôtre",
    },
    {
      lines: [
        `${p.scope}. ${p.requests} requêtes.${p.total ? ` ${p.total}.` : ""}`,
        `${p.share} sont partis dans ${p.said}.`,
      ],
      cta: "Détaillez la vôtre",
    },
    {
      lines: [
        `Claude Code${p.total ? `, ${p.total}` : ""}, ${p.scope}.`,
        `Ni conseils ni thread. La facture : ${p.said}, ${p.share} du total.`,
      ],
      cta: "Sortez la vôtre",
    },
  ],

  h: (p) => [
    {
      lines: [
        `Mon Claude Code me coûte ${p.perDay} par jour.`,
        `${p.days} jours, ${p.requests} requêtes${p.perRequest ? `, ${p.perRequest} la requête` : ""}. Je croyais acheter des réponses. Je louais du contexte.`,
      ],
      cta: "Chiffrez la vôtre",
    },
    {
      lines: [
        p.perRequest
          ? `Chaque fois que j'appuie sur entrée dans Claude Code, ${p.perRequest}.`
          : `Claude Code, c'est ${p.perDay} par jour.`,
        `${p.requests} requêtes sur ${p.days} jours, ${p.perDay} par jour — et l'essentiel n'est pas la réponse.`,
      ],
      cta: "Voyez la vôtre",
    },
  ],

  i: (p) => [
    {
      lines: [
        `Taper est ce que je fais de moins cher dans Claude Code. Le contexte autour coûte ${p.times} plus.`,
        `${p.scope}, ${p.requests} requêtes.`,
      ],
      cta: "Vérifiez la vôtre",
    },
    {
      lines: [
        `Pour chaque dollar de ce que j'ai tapé, le contexte autour a coûté ${p.times} ça.`,
        "Vous ne payez pas votre prompt. Vous payez le loyer de tout ce qu'il traîne derrière lui.",
      ],
      cta: "Faites le calcul",
    },
  ],

  j: (p) => [
    {
      lines: [
        p.masked
          ? `${p.amt} de ma facture Claude Code, c'était du raisonnement que je n'ai jamais lu.`
          : `J'ai payé ${p.amt} pour un raisonnement que je n'ai jamais lu.`,
        `Le raisonnement se facture comme le reste${p.share ? `, et le mien faisait ${p.share} sur ${p.scope}` : `, cela sur ${p.scope}`}.`,
      ],
      cta: "Vérifiez la vôtre",
    },
    {
      lines: [
        "Le modèle réfléchit avant de répondre, et cette réflexion, vous l'achetez aussi.",
        `Chez moi : ${p.amt} sur ${p.scope}. Pas la réponse — la délibération devant.`,
      ],
      cta: "Voyez la vôtre",
    },
  ],

  k: (p) => [
    {
      lines: [
        "Une requête Claude Code a un prix avant que vous tapiez un caractère.",
        `Prompt système et schémas d'outils, renvoyés ${p.requests} fois : ${p.amt}. Je n'en ai pas vu un token.`,
      ],
      cta: "Chiffrez la vôtre",
    },
    {
      lines: [
        `${p.amt} de ma facture Claude Code ont été dépensés avant que je dise quoi que ce soit.`,
        `C'est le prompt système et les schémas, réexpédiés à chacune des ${p.requests} requêtes.`,
      ],
      cta: "Trouvez la vôtre",
    },
  ],

  l: (p) => [
    {
      lines: [
        p.masked
          ? `${p.amt} de ma facture Claude Code, c'était le modèle relisant ses propres pensées.`
          : `J'ai appris aujourd'hui que j'avais payé ${p.amt} pour qu'un modèle relise ses propres pensées.`,
      ],
      cta: "À vous",
    },
    {
      lines: [
        `${p.amt} sur ${p.scope} de Claude Code sont passés à relire ce que le modèle avait déjà écrit.`,
        "Personne ne vous facture ça. La transcription, si.",
      ],
      cta: "Voyez la vôtre",
    },
  ],

  m: () => [
    {
      lines: [
        "La ligne la plus chère de ma facture Claude Code, ce ne sont pas les réponses du modèle.",
        "Ni ce que j'ai tapé. C'est le même texte, relu à chaque tour suivant.",
      ],
      cta: "Voyez la vôtre",
    },
    {
      lines: [
        "J'ai détaillé ma facture Claude Code : la plus grosse ligne était une chose que je n'ai jamais regardée.",
      ],
      cta: "Voyez la vôtre",
    },
    {
      lines: [
        "Tout le monde peaufine ses prompts.",
        "La facture n'est pas dans le prompt. Elle est dans tout ce qu'il traîne dans le contexte, refacturé à chaque tour.",
      ],
      cta: "Voyez la vôtre",
    },
  ],

  n: (p) => [
    {
      lines: [
        `${p.scope} de Claude Code, détaillés.`,
        p.rows.map((r) => `${r.name} — ${r.amt}`).join("\n"),
      ],
      cta: "Détaillez la vôtre",
    },
    {
      lines: [
        "Ma facture Claude Code, de la plus grosse ligne à la plus petite :",
        p.rows.map((r) => `${r.amt} — ${r.name}`).join("\n"),
        `Le tout sur ${p.scope}.`,
      ],
      cta: "La vôtre",
    },
  ],

  o: (p) => [
    {
      lines: [
        "Qu'est-ce qui pèse le plus sur votre facture Claude Code : tout ce que le modèle a écrit, ou tout ce que vos outils ont lu ?",
        p.wroteMore
          ? `J'aurais dit le second. C'était le premier, ${p.hi} contre ${p.lo}.`
          : `J'aurais dit le premier. C'était le second, ${p.hi} contre ${p.lo}.`,
      ],
      cta: "Tranchez la vôtre",
    },
    {
      lines: [
        p.wroteMore
          ? `Sur ma facture, ce que le modèle a écrit (${p.hi}) l'emporte sur ce que mes outils ont lu (${p.lo}).`
          : `Sur ma facture, ce que mes outils ont lu (${p.hi}) l'emporte sur ce que le modèle a écrit (${p.lo}).`,
        "L'un, je l'ai demandé. L'autre est arrivé tout seul.",
      ],
      cta: "Comparez la vôtre",
    },
  ],

  p: (p) => [
    {
      lines: [
        `Le programme le plus cher de ma facture Claude Code, c'est ${p.name}.`,
        "Pas le modèle. Le programme.",
      ],
      cta: "Trouvez le vôtre",
    },
    {
      lines: [
        `${p.name} m'a coûté ${p.amt} dans Claude Code.`,
        "Il ne pense pas, il ne répond pas. Il pose des choses dans le contexte, refacturées à chaque tour suivant.",
      ],
      cta: "Voyez le vôtre",
    },
  ],

  q: (p) => [
    {
      lines: [
        "L'optimisation la moins chère dans Claude Code, ce n'est pas un meilleur prompt.",
        `C'est de ne pas laisser entrer une sortie énorme dans le contexte — vous la repayez à chaque tour. ${p.name} seul : ${p.amt}${p.masked ? "" : ` sur ${p.scope}`}.`,
      ],
      cta: "Voyez la vôtre",
    },
    {
      lines: [
        p.masked
          ? `${p.name} pesait ${p.amt} de ma facture Claude Code.`
          : `${p.name} m'a coûté ${p.amt} sur ${p.scope} de Claude Code.`,
        "Pas parce que je l'appelle souvent. Parce que ce qu'il renvoie reste dans le contexte et se refacture à chaque tour.",
      ],
      cta: "Voyez la vôtre",
    },
  ],

  r: () => [
    {
      lines: [
        "Devinez la plus grosse ligne de ma facture Claude Code. Un seul essai.",
        "Ce n'est pas le modèle qui écrit du code.",
      ],
      cta: "Puis allez voir la vôtre",
    },
    {
      lines: [
        "Vous ne sauriez pas dire ce que vous payez vraiment dans Claude Code.",
        "Pas les réponses. Ce qui occupe le contexte pendant que vous les recevez.",
      ],
      cta: "Prouvez-moi le contraire",
    },
    {
      lines: [
        "Répondez avec la plus grosse ligne de votre facture Claude Code. Je commence : ce n'était rien de ce que j'ai tapé.",
      ],
      cta: "Sortez la vôtre",
    },
  ],
}

const DE: PostCopy = {
  scopeDays: (n) => `${n} Tag${n === 1 ? "" : "e"}`,
  scopeSessions: (n, f) => `${f} Sitzung${n === 1 ? "" : "en"}`,
  outOf: (amt, total) => `${amt} von ${total}`,
  outOfMasked: (share) => `${share} der Rechnung`,
  said: {
    shell: "Shell-Befehle",
    ingest: "was Tools in den Kontext gelesen haben",
    emit: "was Tools hinausgeschrieben haben",
    twoway: "Tool-Verkehr in beide Richtungen",
    output: "die Ausgabe des Modells selbst",
    preamble: "der System-Prompt und die Tool-Schemas",
    harness: "Harness-Gerüst und Reminder",
    media: "Bilder und Anhänge",
    typed: "der Teil, den ich getippt habe",
  },
  a: (p) => {
    const mine = p.masked
      ? `Meins ist ${p.name}, mit ${p.amt} der Rechnung.`
      : `Meins ist ${p.name}, mit ${p.outOf} über ${p.scope}.`
    return {
      lines: [
        "Was ist das teuerste Tool auf deiner Claude-Code-Rechnung?",
        p.second ? `${mine} Zweiter war ${p.second}, mit ${p.secondAmt}.` : mine,
      ],
      cta: "Sieh dir deine an",
    }
  },
  b: (p) => ({
    lines: [
      `Rate, was dich ${p.name} in Claude Code kostet.`,
      (p.masked ? `Bei mir ${p.amt} meiner Rechnung. ` : `Bei mir ${p.amt} über ${p.scope}. `) +
        p.rest.map((n) => `${n.name} waren ${n.amt}.`).join(" "),
      "Die Ausgabe jedes Befehls bleibt in deinem Kontext und wird in jeder weiteren Runde neu berechnet.",
    ],
    cta: "Deine",
  }),
  c: (p) => ({
    lines: [
      "Was kostet dich dein KI-Agent wirklich?",
      `Meiner: ${p.total ? `${p.total} über ` : ""}${p.scope} und ${p.requests} Anfragen.` +
        (p.typedShare ? ` Getippt habe ich ${p.typedShare} davon.` : ""),
    ],
    cta: "Schlüssle deine auf",
  }),
  d: (p) => ({
    lines: [
      "Schnell — was ist der größte Posten auf deiner Claude-Code-Rechnung?",
      `Nicht das, was du tippst. Das waren ${p.outOf}.`,
      "Der Rest ist Miete für Kontext, den du nie siehst.",
    ],
    cta: "Sieh dir deine an",
  }),
  e: (p) => ({
    lines: [
      "Was kostet in Claude Code mehr: was das Modell schreibt, oder was es wieder liest?",
      p.gen
        ? `Bei mir: ${p.gen} zum Schreiben. ${p.carry}, um dieselbe Prosa in späteren Runden wieder zu lesen. ${p.times}.`
        : `Bei mir hat das Wiederlesen der eigenen Prosa das ${p.times} des Schreibens gekostet.`,
    ],
    cta: "Prüf deine",
  }),
  f: (p) => ({
    lines: [
      p.total
        ? `${p.total} Claude Code über ${p.scope}, aufgeschlüsselt.`
        : `${p.scope} meiner Claude-Code-Rechnung, aufgeschlüsselt.`,
      `Größter Posten: ${p.said}, ${p.share} davon.`,
      "Du zahlst nicht für das, was das Modell schreibt — du zahlst Miete für deinen Kontext.",
    ],
    cta: "Zeig mir deine",
  }),

  g: (p) => [
    {
      lines: [
        p.total ? `${p.total} — Claude Code, ${p.scope}.` : `Claude Code, ${p.scope}.`,
        `${p.requests} Anfragen${p.each ? `, ${p.each} pro Stück` : ""}. Größter Posten: ${p.said}, ${p.share}.`,
      ],
      cta: "Deine",
    },
    {
      lines: [
        `${p.scope}. ${p.requests} Anfragen.${p.total ? ` ${p.total}.` : ""}`,
        `${p.share} davon gingen an ${p.said}.`,
      ],
      cta: "Schlüssle deine auf",
    },
    {
      lines: [
        `Claude Code${p.total ? `, ${p.total}` : ""}, ${p.scope}.`,
        `Keine Tipps, kein Thread. Nur die Rechnung: ${p.said}, ${p.share} davon.`,
      ],
      cta: "Hol deine",
    },
  ],

  h: (p) => [
    {
      lines: [
        `Mein Claude Code kostet ${p.perDay} am Tag.`,
        `${p.days} Tage, ${p.requests} Anfragen${p.perRequest ? `, ${p.perRequest} pro Anfrage` : ""}. Ich dachte, ich kaufe Antworten. Ich habe Kontext gemietet.`,
      ],
      cta: "Rechne deine aus",
    },
    {
      lines: [
        p.perRequest
          ? `Jedes Enter in Claude Code kostet mich ${p.perRequest}.`
          : `Claude Code ist eine ${p.perDay}-am-Tag-Gewohnheit.`,
        `${p.requests} Anfragen in ${p.days} Tagen, ${p.perDay} am Tag — und das meiste davon ist nicht die Antwort.`,
      ],
      cta: "Sieh dir deine an",
    },
  ],

  i: (p) => [
    {
      lines: [
        `Tippen ist das Billigste, was ich in Claude Code tue. Der Kontext drumherum kostet das ${p.times}.`,
        `${p.scope}, ${p.requests} Anfragen.`,
      ],
      cta: "Prüf deine",
    },
    {
      lines: [
        `Für jeden Dollar dessen, was ich selbst getippt habe, kostete der Kontext drumherum das ${p.times}.`,
        "Du zahlst nicht für deinen Prompt. Du zahlst Miete für alles, was er hinter sich herzieht.",
      ],
      cta: "Rechne nach",
    },
  ],

  j: (p) => [
    {
      lines: [
        p.masked
          ? `${p.amt} meiner Claude-Code-Rechnung waren Denken, das ich nie gelesen habe.`
          : `Ich habe ${p.amt} für Denken bezahlt, das ich nie gelesen habe.`,
        `Reasoning wird abgerechnet wie jede andere Ausgabe${p.share ? `, meins waren ${p.share} über ${p.scope}` : `, das über ${p.scope}`}.`,
      ],
      cta: "Prüf deine",
    },
    {
      lines: [
        "Das Modell denkt, bevor es antwortet, und das Denken kaufst du mit.",
        `Bei mir ${p.amt} über ${p.scope}. Nicht die Antwort — das Abwägen davor.`,
      ],
      cta: "Sieh dir deine an",
    },
  ],

  k: (p) => [
    {
      lines: [
        "Jede Claude-Code-Anfrage hat einen Preis, bevor du ein Zeichen tippst.",
        `System-Prompt und Tool-Schemas, ${p.requests} Mal neu geschickt: ${p.amt}. Ich habe keinen Token davon gesehen.`,
      ],
      cta: "Rechne deine aus",
    },
    {
      lines: [
        `${p.amt} meiner Claude-Code-Rechnung waren ausgegeben, bevor ich etwas gesagt habe.`,
        `Das sind System-Prompt und Tool-Schemas, bei jeder einzelnen der ${p.requests} Anfragen wieder mitgeschickt.`,
      ],
      cta: "Finde deine",
    },
  ],

  l: (p) => [
    {
      lines: [
        p.masked
          ? `${p.amt} meiner Claude-Code-Rechnung waren das Modell, das seine eigenen Gedanken nachliest.`
          : `Heute gelernt: Ich habe ${p.amt} dafür bezahlt, dass ein Modell seine eigenen Gedanken nachliest.`,
      ],
      cta: "Du bist dran",
    },
    {
      lines: [
        `${p.amt} von ${p.scope} Claude Code gingen dafür drauf, dass das Modell nachliest, was es selbst geschrieben hat.`,
        "Dafür schickt dir niemand eine Rechnung. Das Transkript schon.",
      ],
      cta: "Sieh dir deine an",
    },
  ],

  m: () => [
    {
      lines: [
        "Der teuerste Posten auf meiner Claude-Code-Rechnung sind nicht die Antworten des Modells.",
        "Und auch nicht das, was ich getippt habe. Es ist derselbe Text, in jeder Runde danach neu gelesen.",
      ],
      cta: "Sieh dir deine an",
    },
    {
      lines: [
        "Ich habe meine Claude-Code-Rechnung aufgeschlüsselt, und der größte Posten war etwas, das ich nie angesehen habe.",
      ],
      cta: "Sieh dir deine an",
    },
    {
      lines: [
        "Alle feilen an ihren Prompts.",
        "Die Rechnung steckt nicht im Prompt. Sie steckt in allem, was er in den Kontext zieht — in jeder Runde neu berechnet.",
      ],
      cta: "Sieh dir deine an",
    },
  ],

  n: (p) => [
    {
      lines: [
        `${p.scope} Claude Code, aufgeschlüsselt.`,
        p.rows.map((r) => `${r.name} — ${r.amt}`).join("\n"),
      ],
      cta: "Schlüssle deine auf",
    },
    {
      lines: [
        "Meine Claude-Code-Rechnung, größter Posten zuerst:",
        p.rows.map((r) => `${r.amt} — ${r.name}`).join("\n"),
        `Das über ${p.scope}.`,
      ],
      cta: "Deine",
    },
  ],

  o: (p) => [
    {
      lines: [
        "Was ist auf deiner Claude-Code-Rechnung größer: alles, was das Modell geschrieben hat, oder alles, was deine Tools eingelesen haben?",
        p.wroteMore
          ? `Ich hätte das Zweite gesagt. Es war das Erste, ${p.hi} zu ${p.lo}.`
          : `Ich hätte das Erste gesagt. Es war das Zweite, ${p.hi} zu ${p.lo}.`,
      ],
      cta: "Kläre deine",
    },
    {
      lines: [
        p.wroteMore
          ? `Auf meiner Rechnung schlägt das, was das Modell schrieb (${p.hi}), das, was meine Tools einlasen (${p.lo}).`
          : `Auf meiner Rechnung schlägt das, was meine Tools einlasen (${p.hi}), das, was das Modell schrieb (${p.lo}).`,
        "Das eine habe ich bestellt. Das andere kam von allein.",
      ],
      cta: "Vergleich deine",
    },
  ],

  p: (p) => [
    {
      lines: [
        `Das teuerste Programm auf meiner Claude-Code-Rechnung ist ${p.name}.`,
        "Nicht das Modell. Das Programm.",
      ],
      cta: "Finde deins",
    },
    {
      lines: [
        `${p.name} hat mich ${p.amt} Claude Code gekostet.`,
        "Es denkt nicht und antwortet nicht. Es legt nur Dinge in den Kontext, die in jeder Runde danach neu berechnet werden.",
      ],
      cta: "Sieh dir deins an",
    },
  ],

  q: (p) => [
    {
      lines: [
        "Die billigste Optimierung in Claude Code ist kein besserer Prompt.",
        `Es ist, eine riesige Tool-Ausgabe gar nicht erst in den Kontext zu lassen — du zahlst sie in jeder Runde erneut. Allein ${p.name}: ${p.amt}${p.masked ? "" : ` über ${p.scope}`}.`,
      ],
      cta: "Prüf deine",
    },
    {
      lines: [
        p.masked
          ? `${p.name} waren ${p.amt} meiner Claude-Code-Rechnung.`
          : `${p.name} hat mich ${p.amt} über ${p.scope} gekostet.`,
        "Nicht weil ich es oft aufrufe. Weil das Zurückgegebene im Kontext blieb und in jeder Runde neu berechnet wurde.",
      ],
      cta: "Prüf deine",
    },
  ],

  r: () => [
    {
      lines: [
        "Rate den größten Posten auf meiner Claude-Code-Rechnung. Ein Versuch.",
        "Es ist nicht das Modell, das Code schreibt.",
      ],
      cta: "Und dann sieh dir deine an",
    },
    {
      lines: [
        "Du kannst wahrscheinlich nicht sagen, wofür du in Claude Code wirklich zahlst.",
        "Nicht für die Antworten. Für das, was im Kontext sitzt, während du sie bekommst.",
      ],
      cta: "Beweis mir das Gegenteil",
    },
    {
      lines: [
        "Antworte mit dem größten Posten deiner Claude-Code-Rechnung. Ich fange an: nichts davon habe ich getippt.",
      ],
      cta: "Hol dir deine",
    },
  ],
}

const POST: Record<Lang, PostCopy> = { en: EN, zh: ZH, ja: JA, es: ES, fr: FR, de: DE }

export function postCopy(l: Lang): PostCopy {
  return POST[l]
}
