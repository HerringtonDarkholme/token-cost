/* The instrument's controls. Every one of them is a real button with `aria-pressed`, so
   the current lens is announced rather than only coloured. */

import { useId } from "react"
import type { TtlAssumption } from "./engine.ts"
import { Seg, type SegOption } from "./Seg.tsx"
import { CopyChartButton, ShareButton } from "./Share.tsx"
import { setState, useViewState, type ThemeChoice } from "./store.ts"
import { Tip } from "./Tip.tsx"

/** The sun, a display, the moon. Three glyphs where three words -- LIGHT SYSTEM DARK -- were
 *  the widest thing in the toolbar, for the control a reader touches once a session and
 *  recognises by shape. Stroked in `currentColor`, so the pressed one inverts with the pill
 *  rather than needing a second colour, and the word survives as the accessible name and as
 *  the hint. */
function Sun(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13" />
    </svg>
  )
}

/** Whatever the machine is set to. A display rather than the half-filled disc some apps use:
 *  the disc reads as a third brightness, and this is not one -- it is the setting living
 *  somewhere else. */
function Display(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.4" y="2.6" width="13.2" height="9" />
      <path d="M5.6 14.2h4.8" />
    </svg>
  )
}

function Moon(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13.4 10.1A5.9 5.9 0 0 1 5.9 2.6a5.8 5.8 0 1 0 7.5 7.5Z" />
    </svg>
  )
}

const THEMES: ReadonlyArray<SegOption<ThemeChoice>> = [
  { value: "light", label: "Light theme", icon: <Sun />, tip: "Light, whatever the system says" },
  {
    value: "system",
    label: "System theme",
    icon: <Display />,
    tip: "Follow the system’s light or dark setting",
  },
  { value: "dark", label: "Dark theme", icon: <Moon />, tip: "Dark, whatever the system says" },
]

/* A cache write costs 2× input on a 1h TTL and 1.25× on 5m, so a bill read under the wrong
   assumption is wrong by that much on every write the transcript left unlabelled. That is
   what the switch is for, and what the hints say -- the abbreviation on its own says none of
   it. */
const TTL_HINT =
  "Cache-write TTL. A write bills at 2× input on a 1h TTL and 1.25× on 5m; where the transcript recorded which applied, that is used verbatim, so this reprices only the rest."

const TTLS: ReadonlyArray<SegOption<TtlAssumption>> = [
  { value: "1h", label: "1h", tip: "Assume 1h: unrecorded cache writes at 2× input" },
  { value: "5m", label: "5m", tip: "Assume 5m: unrecorded cache writes at 1.25× input" },
]

/* The switches hand these down rather than closing over a fresh arrow each render. Nothing
   here needs a component's scope -- a pick is a write to the store, which is a module away --
   so they are written once, and the two theme switches are the same function. */
const pickTtl = (ttl: TtlAssumption): void => setState({ ttl })
const pickTheme = (theme: ThemeChoice): void => setState({ theme })

/** The eye every brokerage app puts over its balance. Stroked in `currentColor` so it
 *  inverts with the button rather than needing a second colour for the pressed state. */
function Eye({ off }: { off: boolean }): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M1 8S3.6 3.5 8 3.5 15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z" />
      <circle cx="8" cy="8" r="2.1" />
      {off && <path d="M2.4 13.6 13.6 2.4" />}
    </svg>
  )
}

/** Cover the dollars. One button rather than a `$`/`%` pair, because this is not a choice
 *  between two units -- it is one thing being covered up, and the reader wants the state at
 *  a glance while sharing a screen. Pressed is the covered state: the mask is the departure
 *  from the default, so it is the one that earns the filled treatment.
 *
 *  The accessible name stays put while `aria-pressed` carries the state, which is the toggle
 *  contract -- a label that flipped to "Show" would leave a screen reader hearing
 *  "Show, pressed" and no way to tell what that means. The hint is where the flip belongs:
 *  it is a description rather than a name, so it can say what pressing does next, and
 *  `aria-describedby` means it is read out as well as drawn. */
function MaskToggle({ on }: { on: boolean }): React.JSX.Element {
  const tip = useId()
  return (
    <>
      <button
        type="button"
        className="eyebtn t-tt-trigger"
        aria-pressed={on}
        aria-label="Hide dollar amounts"
        aria-describedby={tip}
        onClick={() => setState({ pctOnly: !on })}
      >
        <span className="eyeamt">$</span>
        <Eye off={on} />
      </button>
      <Tip id={tip}>
        {on
          ? "Show the dollars again"
          : "Cover every dollar figure, leaving shares of the bill — for sharing a screen"}
      </Tip>
    </>
  )
}

/** A page with a plus, for the one control here that throws something away. A picture rather
 *  than the words "New file" partly because it is the same size as its neighbours that way,
 *  and partly because the words were the widest thing in the bar for a button pressed once. */
function Fresh(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="3.2" y="1.8" width="9.6" height="12.4" rx="1" />
      <path d="M8 5.7v4.9M5.55 8.15h4.9" />
    </svg>
  )
}

/** Back to the empty card. The one control with a consequence, so the hint carries it: the
 *  numbers live in this page and nowhere else, and there is no undo -- the transcripts have to
 *  be picked again. The name stays "New analysis", which is what the button is for; what
 *  pressing it costs is a description, and `aria-describedby` means it is read out as well as
 *  drawn. No confirm step on top of that, because re-picking is two clicks. */
function ResetButton({ onReset }: { onReset: () => void }): React.JSX.Element {
  const tip = useId()
  return (
    <span className="seg t-tt-host">
      <button
        type="button"
        className="freshbtn t-tt-trigger"
        aria-label="New analysis"
        aria-describedby={tip}
        onClick={onReset}
      >
        <Fresh />
      </button>
      <Tip id={tip}>
        Discard this report and pick different transcripts. Nothing was uploaded, so these numbers
        only exist in this page — they are gone once you do.
      </Tip>
    </span>
  )
}

/** The controls, and the order is the point.
 *
 *  The theme switch is last in the row and the row is packed to the right, so it sits in the
 *  same place whether the page is holding a report or waiting for one: everything else grows
 *  leftward into the tick and leaves it where it was. The controls that only mean something
 *  once there is a bill are absent until there is one -- a disabled control on first load
 *  advertises something that cannot be done -- and they arrive on a stagger that runs outward
 *  from that anchor. They leave together and faster, because a dismissal does not need
 *  choreography.
 *
 *  Within that, the boxed controls are contiguous and the two bare-text ones lead. Reset began
 *  life at the head of the row, which put a box to the left of "Copy chart" and "Share to X" and
 *  left the pair marooned between frames, reading as a row that had failed to line up. Order is
 *  what fixes that, not sizes: text, text, then every box in one run ending on the anchor.
 *
 *  Nothing here reads the analysis: every one of these is a lens on the view state, which
 *  exists before the data does. That is what lets one toolbar serve both faces of the card
 *  instead of a stripped-down copy for the empty one.
 *
 *  The two things worth taking out of the page are the picture and the post. A link is not
 *  one of them: the hash carries the view -- lens, drill, chart -- and none of the data,
 *  which lives only in the reader's own browser, so a shared link opens on an empty card
 *  for whoever receives it. */
export function Toolbar({
  report,
  leaving,
  onReset,
}: {
  /** Whether there is a bill to act on. */
  report: boolean
  /** The report is on its way out: play the exits, and stay mounted until it is gone. */
  leaving: boolean
  onReset: () => void
}): React.JSX.Element {
  const state = useViewState()

  return (
    <div className="toolbar" data-leaving={leaving ? "1" : undefined}>
      <span className="tick" />
      {report ? (
        <>
          <span className="t-grow" data-i="4">
            <CopyChartButton />
          </span>
          <span className="t-grow" data-i="3">
            <ShareButton />
          </span>
          <span className="t-grow" data-i="2">
            <ResetButton onReset={onReset} />
          </span>
          <span className="t-grow" data-i="1">
            <span className="seg t-tt-host">
              <MaskToggle on={state.pctOnly} />
            </span>
          </span>
          <span className="t-grow" data-i="0">
            <Seg label="TTL" hint={TTL_HINT} options={TTLS} value={state.ttl} onPick={pickTtl} />
          </span>
        </>
      ) : null}
      <Seg options={THEMES} value={state.theme} onPick={pickTheme} />
    </div>
  )
}
