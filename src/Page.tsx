/* The page, which is one card that changes what it holds.

   There used to be two screens here: an upload screen, and a report that replaced it. They
   were the same page with one thing missing -- the same shell, the same toolbar, the same
   bordered box, the same eyebrow, and a heading that only changed tense -- so what arrives
   when a file is dropped is not a second screen. It is this card, with the numbers in it.

   That is why the frame is rendered here and only its contents are swapped: a CSS transition
   needs the *same element* on both sides of a change, so the moment the drop target and the
   report are two different nodes, the card's size and border stop tweening and the whole thing
   degrades to a crossfade between two boxes. Everything persistent lives in this component --
   shell, toolbar, card, brackets, header -- and the two faces are children of it.

   The provider is mounted whether or not there is an analysis, for the same reason: a
   conditional provider is a different tree, and a different tree remounts the card. `null` is
   what it carries in between. */

import { useEffect } from "react"
import type { Analysis } from "./engine.ts"
import { ReportContext, useReportCtx } from "./context.ts"
import { money } from "./model.ts"
import { hashFor, hoverClear, readHash, setState, useViewState, type ViewState } from "./store.ts"
import { Figure, Reveal, TextSwap } from "./Motion.tsx"
import { Toolbar } from "./Toolbar.tsx"
import { Breakdown, CardBody, Footnotes, scopeOf } from "./Report.tsx"
import { Intake, Where } from "./Upload.tsx"

/** Which way the page is moving. The panels travel with it: a view arrives from the direction
 *  it comes from and leaves toward where it is going, so going back is not going forward
 *  played in reverse. See `--panel-exit-y`. */
export type Dir = "fwd" | "back"

/** The hash is the shareable view. Writing it is best-effort because `replaceState` can
 *  refuse on a `file://` page, which is how this is normally opened.
 *
 *  It belongs to the page rather than to the report -- the theme is in it, and the theme
 *  outlives any one file -- which is also what keeps a reset from having to clear the hash by
 *  hand: the state goes back to its defaults and this follows.
 *
 *  The effect keys on the hash *string*, not on the state object: most state changes do not
 *  reach the URL at all, and browsers rate-limit `replaceState` hard enough to start
 *  throwing if it is called on every one of them. */
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
  useUrlSync(state)
  const ctx = useReportCtx(data, state)

  /* One string, so the two faces cannot mount different panels by disagreeing about which
     one is on show. */
  const face = ctx ? "report" : "empty"

  const billed = ctx
    ? `Billed · ${state.pctOnly ? "amount hidden · " : ""}${state.ttl} cache TTL`
    : "Nothing dropped yet"
  /* The figure twice over: as a number for the rolling digits, and as text for the two states
     that are not one. Only one of them is ever rendered -- see `Figure`. */
  const total = ctx && !state.pctOnly ? ctx.d.total : null
  const totalText = ctx ? (state.pctOnly ? "****" : money(ctx.d.total)) : "—"

  return (
    <ReportContext.Provider value={ctx}>
      {/* The one place a highlight is dropped: every view marks the elements that stand
          for something, and this reads the pointer and the focus against those marks. See
          `hoverClear`. */}
      <div className="shell" data-dir={dir} {...hoverClear}>
        <Toolbar report={!!ctx} leaving={leaving} onReset={onReset} />
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
                Cost attribution · Claude Code
                <TextSwap token={face}>{ctx ? " · " + scopeOf(ctx.d) : ""}</TextSwap>
              </div>
              {/* One sentence in two tenses, set word by word so the words can be told apart.
                  "Where", "your" and "money" are the same three words on both faces, and the
                  question loses two the answer does not have -- so the shared three travel to
                  where the shorter sentence puts them while "did" and "go?" leave and "went"
                  arrives. `data-w` is what the stylesheet names them by; `money` keeps its
                  accent across the change, which is what makes it the one to follow. */}
              <h1>
                <TextSwap token={face}>
                  {ctx ? (
                    <>
                      <span data-w="where">Where</span> <span data-w="your">your</span>{" "}
                      <em data-w="money">money</em> <span data-w="went">went</span>
                    </>
                  ) : (
                    <>
                      <span data-w="where">Where</span> <span data-w="did">did</span>{" "}
                      <span data-w="your">your</span> <em data-w="money">money</em>{" "}
                      <span data-w="go">go?</span>
                    </>
                  )}
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
            {ctx ? <CardBody /> : <Intake onData={onData} />}
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
