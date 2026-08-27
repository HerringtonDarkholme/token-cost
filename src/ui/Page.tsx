/* The page, which is one card that changes what it holds. */

import { Fragment, useEffect, useRef } from "react"
import type { Analysis } from "../core/engine.ts"
import { ReportContext, useReportCtx } from "./context.ts"
import { useT, type Dict, type Word } from "./copy.tsx"
import { money } from "../core/model.ts"
import {
  applyUrl,
  hashFor,
  hoverClear,
  pathFor,
  readPath,
  useViewState,
  type ViewState,
} from "./store.ts"
import { loadFace, prefetchFace, useFaces } from "./faces.ts"
import { Figure, Reveal, TextSwap, useCountingUp } from "./Motion.tsx"
import { Toolbar } from "./Toolbar.tsx"

/** Which way the page is moving. */
export type Dir = "fwd" | "back"

/** The address kept level with what the page shows: the path is a place and earns an entry,
 *  while the hash settings rewrite the entry they are held on, so Back is not a walk through
 *  every chart the reader tried. */
function useUrlSync(
  state: ViewState,
  data: Analysis | null,
  report: boolean,
  leaving: boolean,
): void {
  const where = pathFor(report, state.path)
  const url = where + location.search + hashFor(state)
  const prev = useRef(where)

  useEffect(() => {
    /* A face held mounted for its exit is showing a view the address has already left. */
    if (leaving) return
    const moved = prev.current !== where
    prev.current = where
    try {
      /* Nothing to write when the browser is already there, which is how a Back arrives: pushing
         here would bury the entry the reader just came out of. */
      if (location.pathname + location.search + location.hash === url) return
      if (moved) history.pushState(null, "", url)
      else history.replaceState(null, "", url)
    } catch {
      /* file:// can refuse */
    }
  }, [url, where, leaving])

  /* An address typed by hand, which `popstate` does not cover. A turn in flight is the App's to
     finish -- applying the new view under a departing face would reshape it as it leaves. */
  useEffect(() => {
    const onHash = (): void => {
      if (readPath(location.pathname).report === report) applyUrl(data)
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [report, data])
}

/** Where the footer points. The addresses are the only strings on the page that are not the
 *  dictionary's to translate. */
const LINKS: ReadonlyArray<{ href: string; label: (t: Dict) => string; code?: true }> = [
  { href: "https://github.com/HerringtonDarkholme/token-cost", label: (t) => t.colophon.source },
  /* A name rather than a label, and one that is lowercase wherever it is written. */
  { href: "https://ast-grep.github.io/", label: () => "ast-grep", code: true },
  { href: "https://leanpub.com/ast-grep", label: (t) => t.colophon.book },
]

/** `noreferrer` for what the page promises: the address carries the view in its hash. */
function Out({
  href,
  code,
  children,
}: {
  href: string
  code?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <a href={href} target="_blank" rel="noreferrer" data-code={code ? 1 : undefined}>
      {children}
    </a>
  )
}

/** Who made it. Outside both faces, because it belongs to the page rather than to the card. */
function Colophon(): React.JSX.Element {
  const t = useT()
  return (
    <footer className="colophon">
      {/* The signature is the link: a handle one line down would say it again unread. */}
      <span>{t.colophon.madeBy(<Out href="https://x.com/hd_nvim">HerringtonDarkholme</Out>)}</span>
      <nav>
        {LINKS.map((l) => (
          <Out key={l.href} href={l.href} code={l.code}>
            {l.label(t)}
          </Out>
        ))}
      </nav>
    </footer>
  )
}

/** One face of the heading, set word by word so the words can be told apart. */
function Heading({ words, gap }: { words: Word[]; gap: string }): React.JSX.Element {
  return (
    <>
      {words.map((word, i) => (
        <Fragment key={word.w}>
          {i && !word.tight ? gap : null}
          {word.em ? (
            <em data-w={word.w}>{word.text}</em>
          ) : (
            <span data-w={word.w}>{word.text}</span>
          )}
        </Fragment>
      ))}
    </>
  )
}

export function Page({
  data,
  leaving,
  dir,
  sample,
  importing,
  onData,
  onReset,
  onExited,
}: {
  /** The analysis the card is showing, or `null` for the empty face. */
  data: Analysis | null
  /** The face on show is on its way out: it is held mounted, playing its exit. */
  leaving: boolean
  dir: Dir
  /** The bill came from the example rather than from a folder, which the eyebrow has to say. */
  sample: boolean
  /** A report the CLI handed over is still decoding, the one state that wants neither face. */
  importing: boolean
  onData: (data: Analysis, sample: boolean) => void
  onReset: () => void
  /** The departing face has finished leaving. Only on the path with no view transition to wait
   *  for -- see `turnTo`. */
  onExited?: () => void
}): React.JSX.Element {
  const state = useViewState()
  const t = useT()
  const ctx = useReportCtx(data, state)
  const faces = useFaces()

  /** Which face this visit needs, capitalised because JSX reads a lowercase tag as HTML. */
  const wants = ctx ? "report" : importing ? null : "intake"
  const R = ctx ? faces.report : null
  const I = wants === "intake" ? faces.intake : null

  /* One string, so the two faces cannot disagree about which is on show. `loading` is a bill on
     the way with no face yet to draw it: the card keeps its frame and stops offering itself as a
     dropzone. */
  const face = R ? "report" : ctx || importing ? "loading" : "empty"
  useUrlSync(state, data, !!ctx, leaving)

  /* The face on show, then the other once the browser goes quiet: a turn is one click away. */
  useEffect(() => {
    /* Neither face while a handed-over report decodes -- but that decode can come back empty. */
    if (!wants) {
      prefetchFace("intake")
      return
    }
    void loadFace(wants)
    prefetchFace(wants === "report" ? "intake" : "report")
  }, [wants])

  /* The TTL is named only where one was assumed, or a bill with no cache writes to guess at
     would quote a rate it never used. */
  const assumed = !!data && data.ttlTokens.unknown > 0
  const billed = ctx ? t.card.billed(assumed ? state.ttl : null, state.pctOnly) : t.card.nothingYet
  /* What the empty card's figure counts through: the walk writes its running total into this box
     as it reads. */
  const sofar = useRef(0)
  const counted = useCountingUp(sofar, !ctx)

  /* The figure twice: a number for the rolling digits, and text for the one state that is not
     one. */
  const total = ctx ? (state.pctOnly ? null : ctx.d.total) : counted
  const figureText = money(ctx ? ctx.d.total : counted)
  const totalText = ctx && state.pctOnly ? "****" : figureText

  return (
    <ReportContext.Provider value={ctx}>
      {/* The one place a highlight is dropped, reading the pointer against the marks every view
          leaves. See `hoverClear`. */}
      <div className="shell" data-dir={dir} {...hoverClear}>
        {/* The TTL lens is offered only where the transcripts left it something to do: with no
            unrecorded write tokens, the two lenses are the same number. */}
        <Toolbar
          report={!!ctx}
          ttl={!!data && data.ttlTokens.unknown > 0}
          leaving={leaving}
          onReset={onReset}
        />
        {/* The frame, and the only element on the page never replaced. `data-chart` gives the
            empty card the shape the report will have; `data-face` makes its border a dashed
            invitation. */}
        <section className="card t-resize" data-chart={state.chart} data-face={face}>
          <span className="br br1" />
          <span className="br br2" />
          <span className="br br3" />
          <span className="br br4" />
          <header className="chead">
            <div>
              {/* The words are identical on both faces; what the report adds is the scope, on
                  the end. The whole line is dropped on a narrow window -- see `.chead`. */}
              <div className="eyebrow">
                {t.card.eyebrow}
                <TextSwap token={face}>
                  {R && ctx
                    ? (sample ? " · " + t.card.example : "") + " · " + R.scope(t, ctx.d)
                    : ""}
                </TextSwap>
              </div>
              {/* One sentence in two tenses, set word by word so the words can be told apart:
                  the shared ones travel to where the shorter sentence puts them, the rest leave
                  and arrive. Which slots a language shares is the dictionary's to say. */}
              <h1>
                <TextSwap token={face}>
                  <Heading words={ctx ? t.card.answer : t.card.ask} gap={t.card.gap} />
                </TextSwap>
              </h1>
            </div>
            <div className="cfig">
              {/* What qualifies the figure, gathered so a narrow window can stand both beside
                  it. `display: contents` above that width leaves the caption where the header's
                  grid puts it. */}
              <div className="qual">
                {sample ? <span className="etag">{t.card.example}</span> : null}
                {/* Not swapped, unlike the two lines beside it: the figure already re-enters
                    character by character, and two animations saying the same thing is one too
                    many. */}
                <div className="billed">{billed}</div>
              </div>
              {/* A dash holds the figure's place, so the bill arrives in the slot that was
                  waiting for it rather than pushing the header around. */}
              <div
                className="total"
                style={{ "--fig": figureText.length } as React.CSSProperties}
                data-hidden={state.pctOnly && ctx ? 1 : 0}
                data-empty={ctx ? 0 : 1}
              >
                <Figure
                  value={total}
                  text={totalText}
                  className={state.pctOnly && ctx ? "mask" : undefined}
                />
              </div>
            </div>
          </header>
          {/* Keyed on the face, so the arriving one has a closed state to travel from, and
              `closed` held from outside so the departing one has somewhere to go. */}
          {/* The card's panel is the one that reports the exit: the pair close on the same
              tokens, so a second report would say the same thing a frame later. */}
          <Reveal key={face} className="cardslot" closed={leaving} onClosed={onExited}>
            {R ? <R.Body /> : I ? <I.Body onData={onData} sofar={sofar} /> : null}
          </Reveal>
        </section>
        {/* What stands under the card: the breakdown and the footnotes, or the help for finding
            the transcripts. */}
        <Reveal key={face} className="below" closed={leaving}>
          {R ? <R.Below /> : I ? <I.Below /> : null}
        </Reveal>
        <Colophon />
      </div>
    </ReportContext.Provider>
  )
}
