/* The page, which is one card that changes what it holds. */

import { Fragment, useEffect, useRef } from "react"
import type { Analysis } from "./engine.ts"
import { ReportContext, useReportCtx } from "./context.ts"
import { useT, type Word } from "./copy.tsx"
import { money } from "./model.ts"
import { hashFor, hoverClear, readHash, setState, useViewState, type ViewState } from "./store.ts"
import { Figure, Reveal, TextSwap, useCountingUp } from "./Motion.tsx"
import { Toolbar } from "./Toolbar.tsx"
import { Breakdown, CardBody, Footnotes, scopeOf } from "./Report.tsx"
import { Intake, Where } from "./Upload.tsx"

/** Which way the page is moving. */
export type Dir = "fwd" | "back"

/** The hash is the shareable view. */
function useUrlSync(state: ViewState): void {
  const hash = hashFor(state)
  useEffect(() => {
    try {
      history.replaceState(null, "", hash || location.pathname + location.search)
    } catch {
      /* file:// can refuse */
    }
  }, [hash])

  useEffect(() => {
    const onHash = (): void => setState(readHash(location.hash))
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
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
  onData,
  onReset,
}: {
  /** The analysis the card is showing, or `null` for the empty face. */
  data: Analysis | null
  /** The face on show is on its way out: it is held mounted, playing its exit. */
  leaving: boolean
  dir: Dir
  onData: (data: Analysis) => void
  onReset: () => void
}): React.JSX.Element {
  const state = useViewState()
  const t = useT()
  useUrlSync(state)
  const ctx = useReportCtx(data, state)

  /* One string, so the two faces cannot mount different panels by disagreeing about which one is
     on show. */
  const face = ctx ? "report" : "empty"

  const billed = ctx ? t.card.billed(state.ttl, state.pctOnly) : t.card.nothingYet
  /* What the empty card's figure counts from, and what it counts through: the walk writes its
     running total into this box as it reads, so the slot holds $0.00 before a folder is picked
     and then climbs towards the bill from the first transcript to the last. */
  const sofar = useRef(0)
  const counted = useCountingUp(sofar, !ctx)

  /* The figure twice over: as a number for the rolling digits, and as text for the one state
     that is not one. */
  const total = ctx ? (state.pctOnly ? null : ctx.d.total) : counted
  const totalText = ctx ? (state.pctOnly ? "****" : money(ctx.d.total)) : money(counted)

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
              {/* The words are identical on both faces; what the report adds is the scope,
                  which arrives on the end rather than replacing the line. */}
              <div className="eyebrow">
                {t.card.eyebrow}
                <TextSwap token={face}>{ctx ? " · " + scopeOf(t, ctx.d) : ""}</TextSwap>
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
              {/* Not swapped, unlike the two lines beside it: this is the caption on a figure
                  that already re-enters character by character whenever it changes, and two
                  animations saying the same thing on adjacent lines is one too many. */}
              <div className="billed">{billed}</div>
              {/* The figure's place is held by a dash before there is a figure, so the bill
                  arrives in the slot that was waiting for it rather than pushing the header
                  around on its way in. */}
              <div
                className="total"
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
            {ctx ? <CardBody /> : <Intake onData={onData} sofar={sofar} />}
          </Reveal>
        </section>
        {/* What stands under the card: the breakdown and the footnotes, or the help for
            finding the transcripts in the first place. */}
        <Reveal key={face} className="below" closed={leaving}>
          {ctx ? (
            <>
              <Breakdown />
              <Footnotes />
            </>
          ) : (
            <Where />
          )}
        </Reveal>
      </div>
    </ReportContext.Provider>
  )
}
