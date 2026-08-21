/* The page, which is one card that changes what it holds. */

import { Fragment, useEffect, useRef } from "react"
import type { Analysis } from "./engine.ts"
import { ReportContext, useReportCtx } from "./context.ts"
import { useT, type Dict, type Word } from "./copy.tsx"
import { money } from "./model.ts"
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

/** The address, kept level with what the page is showing. The path is a place and earns an entry
 *  of its own -- opening the report, and drilling into a group -- while the settings in the hash
 *  rewrite the entry they are held on, so Back is not a walk through every chart the reader
 *  tried. */
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
    /* A face held mounted for its exit is showing a view the address has already left; writing
       from it would put the departing report back over the entry the reader just returned to. */
    if (leaving) return
    const moved = prev.current !== where
    prev.current = where
    try {
      /* Nothing to write when the browser is already there, which is how a Back or a Forward
         arrives: the address moved first and the page followed it. Pushing here would bury the
         entry the reader just came out of. */
      if (location.pathname + location.search + location.hash === url) return
      if (moved) history.pushState(null, "", url)
      else history.replaceState(null, "", url)
    } catch {
      /* file:// can refuse */
    }
  }, [url, where, leaving])

  /* An address typed or edited by hand, which `popstate` does not cover. A turn is in flight when
     the two disagree, and that is the App's to finish -- applying the new view under the face on
     its way out would reshape the picture as it leaves. */
  useEffect(() => {
    const onHash = (): void => {
      if (readPath(location.pathname).report === report) applyUrl(data)
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [report, data])
}

/** Where the footer points, in the order it reads them. The addresses are the only strings on the
 *  page that are not the dictionary's to translate. */
const LINKS: ReadonlyArray<{ href: string; label: (t: Dict) => string; code?: true }> = [
  { href: "https://github.com/HerringtonDarkholme/token-cost", label: (t) => t.colophon.source },
  /* A name rather than a label, and one that is lowercase wherever it is written. */
  { href: "https://ast-grep.github.io/", label: () => "ast-grep", code: true },
  { href: "https://leanpub.com/ast-grep", label: (t) => t.colophon.book },
]

/** `noreferrer` for what the page promises rather than out of habit: the address carries the view
 *  in its hash, and the referrer would hand that to the other end. */
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

/** Who made it. Outside both faces and outside the card, because it belongs to the page rather
 *  than to whatever the card is currently showing. */
function Colophon(): React.JSX.Element {
  const t = useT()
  return (
    <footer className="colophon">
      {/* The signature is the link: a name in a sentence says who, and one line down a handle
          would say it again in a shape nobody reads. */}
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
}: {
  /** The analysis the card is showing, or `null` for the empty face. */
  data: Analysis | null
  /** The face on show is on its way out: it is held mounted, playing its exit. */
  leaving: boolean
  dir: Dir
  /** The bill came from the example rather than from a folder, which the eyebrow has to say. */
  sample: boolean
  /** A report the CLI handed over is still decoding, which is the one state that wants neither
   *  face: the empty one would be an invitation the page is about to withdraw. */
  importing: boolean
  onData: (data: Analysis, sample: boolean) => void
  onReset: () => void
}): React.JSX.Element {
  const state = useViewState()
  const t = useT()
  const ctx = useReportCtx(data, state)
  const faces = useFaces()

  /** Which face this visit needs, or nothing at all while the CLI's report decodes -- and then
   *  whichever of the two is in hand, capitalised because JSX reads a lowercase tag as HTML. */
  const wants = ctx ? "report" : importing ? null : "intake"
  const R = ctx ? faces.report : null
  const I = wants === "intake" ? faces.intake : null

  /* One string, so the two faces cannot mount different panels by disagreeing about which one is
     on show. `loading` is a bill on the way with no face yet to draw it: the card keeps its frame
     and its heading, and stops offering itself as a dropzone it is about to stop being -- while an
     empty card still waiting on its own slot stays `empty`, since flipping the border to solid and
     back is worse than a slot that fills in. */
  const face = R ? "report" : ctx || importing ? "loading" : "empty"
  useUrlSync(state, data, !!ctx, leaving)

  /* The face on show, and then the other one once the browser goes quiet -- a turn is one click
     away in either direction, and it has to find the face it turns to already here. */
  useEffect(() => {
    /* Neither face is wanted while a handed-over report decodes -- but that decode can come back
       with nothing, and the empty card is what stands in for it. */
    if (!wants) {
      prefetchFace("intake")
      return
    }
    void loadFace(wants)
    prefetchFace(wants === "report" ? "intake" : "report")
  }, [wants])

  /* The TTL is named only where one was assumed. A bill with no cache writes to guess at -- an
     OpenAI one, where there is no TTL to choose -- would otherwise quote a rate it never used. */
  const assumed = !!data && data.ttlTokens.unknown > 0
  const billed = ctx ? t.card.billed(assumed ? state.ttl : null, state.pctOnly) : t.card.nothingYet
  /* What the empty card's figure counts from, and what it counts through: the walk writes its
     running total into this box as it reads, so the slot holds $0.00 before a folder is picked
     and then climbs towards the bill from the first transcript to the last. */
  const sofar = useRef(0)
  const counted = useCountingUp(sofar, !ctx)

  /* The figure twice over: as a number for the rolling digits, and as text for the one state
     that is not one. */
  const total = ctx ? (state.pctOnly ? null : ctx.d.total) : counted
  const figureText = money(ctx ? ctx.d.total : counted)
  const totalText = ctx && state.pctOnly ? "****" : figureText

  return (
    <ReportContext.Provider value={ctx}>
      {/* The one place a highlight is dropped: every view marks the elements that stand
          for something, and this reads the pointer and the focus against those marks. See
          `hoverClear`. */}
      <div className="shell" data-dir={dir} {...hoverClear}>
        {/* The TTL lens is offered only where the transcripts left it something to do: the
            walk counts the write tokens whose TTL went unrecorded, and where that is zero the
            two lenses are the same number and the switch is a control that does nothing. */}
        <Toolbar
          report={!!ctx}
          ttl={!!data && data.ttlTokens.unknown > 0}
          leaving={leaving}
          onReset={onReset}
        />
        {/* The frame, and the only element on the page that is never replaced. `data-chart`
            gives the empty card the shape the report will have, so a file drop changes what is
            inside the box without changing the box; `data-face` is what makes its border a
            dashed invitation until then. */}
        <section className="card t-resize" data-chart={state.chart} data-face={face}>
          <span className="br br1" />
          <span className="br br2" />
          <span className="br br3" />
          <span className="br br4" />
          <header className="chead">
            <div>
              {/* The words are identical on both faces; what the report adds is the scope, which
                  arrives on the end rather than replacing the line -- and the example says so
                  here rather than anywhere louder, since what makes it an example is whose
                  transcripts it read, which is exactly what this line is for. The whole line is
                  dropped on a narrow window: see `.chead` in the stylesheet. */}
              <div className="eyebrow">
                {t.card.eyebrow}
                <TextSwap token={face}>
                  {R && ctx
                    ? (sample ? " · " + t.card.example : "") + " · " + R.scope(t, ctx.d)
                    : ""}
                </TextSwap>
              </div>
              {/* One sentence in two tenses, set word by word so the words can be told apart.
                  In English "Where", "your" and "money" are the same three words on both faces,
                  and the question loses two the answer does not have -- so the shared three
                  travel to where the shorter sentence puts them while "did" and "go?" leave and
                  "went" arrives. `data-w` is what the stylesheet names them by; `money` keeps
                  its accent across the change, which is what makes it the one to follow.
                  Which slots a language shares is the dictionary's to say: `zh` shares two and
                  uses no "where" at all, `de` shares three. */}
              <h1>
                <TextSwap token={face}>
                  <Heading words={ctx ? t.card.answer : t.card.ask} gap={t.card.gap} />
                </TextSwap>
              </h1>
            </div>
            <div className="cfig">
              {/* What qualifies the figure, gathered so a narrow window can stand both beside it
                  in the corner the caption alone holds on a wide one. `display: contents` above
                  that width, so the caption stays exactly where the header's grid puts it; the
                  tag is drawn only where the eyebrow that otherwise carries it is not. The scope
                  counts are the one thing left out -- they take two lines to themselves at this
                  measure, and are readable off the report below. */}
              <div className="qual">
                {sample ? <span className="etag">{t.card.example}</span> : null}
                {/* Not swapped, unlike the two lines beside it: this is the caption on a figure
                    that already re-enters character by character whenever it changes, and two
                    animations saying the same thing on adjacent lines is one too many. */}
                <div className="billed">{billed}</div>
              </div>
              {/* The figure's place is held by a dash before there is a figure, so the bill
                  arrives in the slot that was waiting for it rather than pushing the header
                  around on its way in. */}
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
              `closed` held from outside for the length of the exit, so the departing one has
              somewhere to go. */}
          <Reveal key={face} className="cardslot" closed={leaving}>
            {R ? <R.Body /> : I ? <I.Body onData={onData} sofar={sofar} /> : null}
          </Reveal>
        </section>
        {/* What stands under the card: the breakdown and the footnotes, or the help for
            finding the transcripts in the first place. */}
        <Reveal key={face} className="below" closed={leaving}>
          {R ? <R.Below /> : I ? <I.Below /> : null}
        </Reveal>
        <Colophon />
      </div>
    </ReportContext.Provider>
  )
}
