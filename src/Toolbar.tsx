/* The instrument's controls. Every one of them is a real button that says its own state, so
   the current lens is announced rather than only coloured -- `aria-pressed` where there is a
   sibling to be pressed instead of, and the accessible name itself where there is not. See
   `Cycle`. */

import { useId } from "react"
import { LANGS, useT, type Dict } from "./copy.tsx"
import type { TtlAssumption } from "./engine.ts"
import type { Lang } from "./i18n.ts"
import { Cycle, type SegOption } from "./Seg.tsx"
import { CopyChartButton, ShareButton } from "./Share.tsx"
import { setState, useViewState, type ThemeChoice } from "./store.ts"
import { Tip } from "./Tip.tsx"

/** The sun, a display, the moon. Three glyphs where three words -- LIGHT SYSTEM DARK -- were
 *  the widest thing in the toolbar, for the control a reader touches once a session and
 *  recognises by shape. One of the three is on screen at a time now, which is the rest of that
 *  same argument: the reader is not choosing between them, they are saying where they already
 *  are. Stroked in `currentColor`, so it takes the bar's ink, and the word survives as the
 *  accessible name. */
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

/* The options are built per render rather than written once at module scope, because a word in
   them changes when the language does and a constant cannot. The glyphs do not change, so they
   are still the same three elements every time.

   Each hint names the *next* option rather than its own, because only one of these is ever on
   screen: by the time a hint can be read, its option is the one already showing, and the only
   thing left to say about it is where pressing goes. Which is also why the order is written
   here and nowhere else -- light, system, dark, and round -- since the hints spell it out. */
const themes = (t: Dict): ReadonlyArray<SegOption<ThemeChoice> & { tip: string }> => [
  { value: "light", label: t.theme.light, icon: <Sun />, tip: t.theme.cycle(t.theme.system) },
  { value: "system", label: t.theme.system, icon: <Display />, tip: t.theme.cycle(t.theme.dark) },
  { value: "dark", label: t.theme.dark, icon: <Moon />, tip: t.theme.cycle(t.theme.light) },
]

/* A cache write costs 2× input on a 1h TTL and 1.25× on 5m, so a bill read under the wrong
   assumption is wrong by that much on every write the transcript left unlabelled. That is
   what the switch is for, and what the hints say -- the abbreviation on its own says none of
   it. The abbreviations themselves are not translated: they are what the API calls them. */
const ttls = (t: Dict): ReadonlyArray<SegOption<TtlAssumption> & { tip: string }> => [
  { value: "1h", label: "1h", tip: t.ttl.tip1h },
  { value: "5m", label: "5m", tip: t.ttl.tip5m },
]

/* The switches hand these down rather than closing over a fresh arrow each render. Nothing
   here needs a component's scope -- a pick is a write to the store, which is a module away --
   so they are written once, and the two theme switches are the same function. */
const pickTtl = (ttl: TtlAssumption): void => setState({ ttl })
const pickTheme = (theme: ThemeChoice): void => setState({ theme })

/** A globe, for the one control whose options are words in scripts the rest of the toolbar
 *  does not draw. Same recipe as its neighbours: one 16-unit box, stroked in `currentColor`,
 *  so it takes the bar's ink without needing a colour of its own. */
function Globe(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.4" />
      <path d="M1.6 8h12.8M8 1.6c1.7 1.8 2.6 4 2.6 6.4S9.7 12.6 8 14.4C6.3 12.6 5.4 10.4 5.4 8s.9-4.6 2.6-6.4Z" />
    </svg>
  )
}

/** The language, as a select rather than as the segmented control every other lens here uses,
 *  and not as the cycle its neighbours use either. Six options is where a row of buttons stops
 *  working, and six is also where cycling stops working: a reader who wants German should not
 *  have to press through four other languages to reach it, and a control that walks somewhere
 *  new on every press is the one control here where a wrong press is expensive -- the way back
 *  is now labelled in a script you may not read.
 *
 *  A native `<select>` gets one thing neither of those does: the platform's own list, which
 *  already knows how to render 中文 beside Français and how to be operated by a keyboard, a
 *  screen reader and a thumb. The glyph beside it is what makes it findable without a word,
 *  since the word would be in the language you are trying to leave.
 *
 *  What the options say is a code where the script is Latin and the language's own name where
 *  it is not -- "EN", "中文". A picker naming each language in itself is right in principle,
 *  and in practice five of the six names were being set in a font this toolbar does not use,
 *  in a box sized for the longest of them, to tell a reader something they can already see
 *  from the page behind it. The two that stay written out are the two a code would fail:
 *  "ZH" and "JA" are how English refers to those languages, which makes them the one form no
 *  reader looking for them is scanning for. */
function LangPicker(): React.JSX.Element {
  const { lang } = useViewState()
  const t = useT()
  return (
    <span className="seg langseg">
      <Globe />
      <select
        className="langsel"
        aria-label={t.language}
        value={lang}
        onChange={(e) => setState({ lang: e.target.value as Lang })}
      >
        {LANGS.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    </span>
  )
}

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
  const t = useT()
  return (
    <>
      <button
        type="button"
        className="eyebtn t-tt-trigger"
        aria-pressed={on}
        aria-label={t.mask.name}
        aria-describedby={tip}
        onClick={() => setState({ pctOnly: !on })}
      >
        {/* Not translated, and not a word: the dollar sign is the thing being covered up,
            drawn beside the eye that covers it. */}
        <span className="eyeamt">$</span>
        <Eye off={on} />
      </button>
      <Tip id={tip}>{on ? t.mask.tipOn : t.mask.tipOff}</Tip>
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
  const t = useT()
  return (
    <span className="seg t-tt-host">
      <button
        type="button"
        className="freshbtn t-tt-trigger"
        aria-label={t.reset.name}
        aria-describedby={tip}
        onClick={onReset}
      >
        <Fresh />
      </button>
      <Tip id={tip}>{t.reset.tip}</Tip>
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
 *  Every one of these is a lens on the view state, which exists before the data does -- which
 *  is what lets one toolbar serve both faces of the card instead of a stripped-down copy for
 *  the empty one. The one thing it asks the analysis is whether a lens has anything to act on:
 *  see `ttl`.
 *
 *  The two things worth taking out of the page are the picture and the post. A link is not
 *  one of them: the hash carries the view -- lens, drill, chart -- and none of the data,
 *  which lives only in the reader's own browser, so a shared link opens on an empty card
 *  for whoever receives it. */
export function Toolbar({
  report,
  ttl,
  leaving,
  onReset,
}: {
  /** Whether there is a bill to act on. */
  report: boolean
  /** Whether the TTL assumption is load-bearing -- that is, whether the transcripts left any
   *  cache write unlabelled for it to reprice. Modern ones label every one, which makes the
   *  switch a control that visibly changes nothing: the reader presses it, watches the bill
   *  hold still, and learns to distrust the page rather than to trust the transcript. So it is
   *  absent unless there is something for it to move. What it would have said is said anyway,
   *  once, in the footnotes -- see `ttlShareCaveat`. */
  ttl: boolean
  /** The report is on its way out: play the exits, and stay mounted until it is gone. */
  leaving: boolean
  onReset: () => void
}): React.JSX.Element {
  const state = useViewState()
  const t = useT()

  /* Where the stagger starts counting. It runs *outward* from the anchor, so the beats belong
     to the positions rather than to the controls: the one nearest the anchor arrives first
     whether it is the TTL switch or the mask. Which means the numbers cannot be written in --
     with the switch away, a hand-numbered row would open on a beat where nothing arrives. */
  const first = ttl ? 4 : 3

  return (
    <div className="toolbar" data-leaving={leaving ? "1" : undefined}>
      <span className="tick" />
      {report ? (
        <>
          <span className="t-grow" data-i={first}>
            <CopyChartButton />
          </span>
          <span className="t-grow" data-i={first - 1}>
            <ShareButton />
          </span>
          <span className="t-grow" data-i={first - 2}>
            <ResetButton onReset={onReset} />
          </span>
          <span className="t-grow" data-i={first - 3}>
            <span className="seg t-tt-host">
              <MaskToggle on={state.pctOnly} />
            </span>
          </span>
          {ttl ? (
            <span className="t-grow" data-i="0">
              <Cycle name={t.ttl.name} options={ttls(t)} value={state.ttl} onPick={pickTtl} />
            </span>
          ) : null}
        </>
      ) : null}
      {/* Inside the anchor rather than beside it: language and theme are the two controls that
          exist before there is a bill and outlive any one of them, so they hold the same
          ground on both faces of the card and everything else grows leftward past them. */}
      <LangPicker />
      <Cycle options={themes(t)} value={state.theme} onPick={pickTheme} />
    </div>
  )
}
