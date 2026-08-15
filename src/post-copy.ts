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
}

const POST: Record<Lang, PostCopy> = { en: EN, zh: ZH, ja: JA, es: ES, fr: FR, de: DE }

export function postCopy(l: Lang): PostCopy {
  return POST[l]
}
