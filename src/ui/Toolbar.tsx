/* The instrument's controls. */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { LANGS, useT, type Dict } from "./copy.tsx"
import type { TtlAssumption } from "../core/engine.ts"
import type { Lang } from "../core/i18n.ts"
import { transition } from "./Motion.tsx"
import { Cycle, type SegOption } from "./Seg.tsx"
import { CopyChartButton, ShareButton } from "./Share.tsx"
import { setState, useViewState, type ThemeChoice } from "./store.ts"
import { Tip } from "./Tip.tsx"

/** The sun, a display, the moon. */
function Sun(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.05 3.05l1.13 1.13M11.82 11.82l1.13 1.13M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13" />
    </svg>
  )
}

/** Whatever the machine is set to. */
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
   them changes when the language does and a constant cannot. */
const themes = (t: Dict): ReadonlyArray<SegOption<ThemeChoice> & { tip: string }> => [
  { value: "light", label: t.theme.light, icon: <Sun />, tip: t.theme.cycle(t.theme.system) },
  { value: "system", label: t.theme.system, icon: <Display />, tip: t.theme.cycle(t.theme.dark) },
  { value: "dark", label: t.theme.dark, icon: <Moon />, tip: t.theme.cycle(t.theme.light) },
]

/* A cache write costs 2× input on a 1h TTL and 1.25× on 5m, so a bill read under the wrong
   assumption is wrong by that much on every write the transcript left unlabelled. */
const ttls = (t: Dict): ReadonlyArray<SegOption<TtlAssumption> & { tip: string }> => [
  { value: "1h", label: "1h", tip: t.ttl.tip1h },
  { value: "5m", label: "5m", tip: t.ttl.tip5m },
]

/* The switches hand these down rather than closing over a fresh arrow each render. */
const pickTtl = (ttl: TtlAssumption): void => setState({ ttl })
const pickTheme = (theme: ThemeChoice): void => setState({ theme })

/** A globe, for the one control whose options are words in scripts the rest of the toolbar does
 *  not draw. */
function Globe(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.4" />
      <path d="M1.6 8h12.8M8 1.6c1.7 1.8 2.6 4 2.6 6.4S9.7 12.6 8 14.4C6.3 12.6 5.4 10.4 5.4 8s.9-4.6 2.6-6.4Z" />
    </svg>
  )
}

/** The language, as a select rather than as the segmented control every other lens here uses,
 *  and not as the cycle its neighbours use either. */
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

/** The eye every brokerage app puts over its balance. */
function Eye({ off }: { off: boolean }): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M1 8S3.6 3.5 8 3.5 15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z" />
      <circle cx="8" cy="8" r="2.1" />
      {off && <path d="M2.4 13.6 13.6 2.4" />}
    </svg>
  )
}

/** Cover the dollars. */
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
        onClick={() => transition(() => setState({ pctOnly: !on }), { "data-mask": "" })}
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

/** A page with a plus, for the one control here that throws something away. */
function Fresh(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="3.2" y="1.8" width="9.6" height="12.4" rx="1" />
      <path d="M8 5.7v4.9M5.55 8.15h4.9" />
    </svg>
  )
}

/** Back to the empty card. */
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

/** Three rules, on the one button the bar folds into. */
function BurgerMark(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2 4.4h12M2 8h12M2 11.6h12" />
    </svg>
  )
}

function CloseMark(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

/** One control in the panel, with the word for what it does beside it. Above the breakpoint both
 *  the wrapper and the word go away -- `display: contents` -- so there is one set of these. */
function Tool({ label, children }: { label?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="tool">
      {label ? <span className="toollbl">{label}</span> : null}
      {children}
    </div>
  )
}

/** The controls, and the order is the point. */
export function Toolbar({
  report,
  ttl,
  leaving,
  onReset,
}: {
  /** Whether there is a bill to act on. */
  report: boolean
  /** Whether the TTL assumption is load-bearing -- that is, whether the transcripts left any
   *  cache write unlabelled for it to reprice. */
  ttl: boolean
  /** The report is on its way out: play the exits, and stay mounted until it is gone. */
  leaving: boolean
  onReset: () => void
}): React.JSX.Element {
  const state = useViewState()
  const t = useT()
  const [open, setOpen] = useState(false)
  const burger = useRef<HTMLButtonElement>(null)
  const panel = useId()

  /* Focus goes back to the button that opened it, so closing does not drop the reader at the top
     of the document. */
  const close = useCallback(() => {
    setOpen(false)
    burger.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close()
    }
    /* A window that grows past the breakpoint takes the panel with it: above that width these
       controls are a row in the bar again and there is nothing left for "open" to mean. */
    const wide = matchMedia("(min-width: 821px)")
    const onWide = (): void => {
      if (wide.matches) setOpen(false)
    }
    const held = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", onKey)
    wide.addEventListener("change", onWide)
    return () => {
      document.body.style.overflow = held
      document.removeEventListener("keydown", onKey)
      wide.removeEventListener("change", onWide)
    }
  }, [open, close])

  /* The one control here that replaces the page under the panel, so it is the one that has to
     take the panel down with it. */
  const reset = useCallback(() => {
    setOpen(false)
    onReset()
  }, [onReset])

  /* Where the stagger starts counting. */
  const first = ttl ? 4 : 3

  return (
    <div className="toolbar" data-leaving={leaving ? "1" : undefined} data-open={open ? "1" : "0"}>
      <span className="tick" />
      {/* Out in the bar rather than down in the panel: covering the dollars is what you reach for
          with someone already looking at the screen, and a menu is two taps too many for that. */}
      {report ? (
        <span className="maskslot t-grow" data-i={first - 3}>
          <span className="seg t-tt-host">
            <MaskToggle on={state.pctOnly} />
          </span>
        </span>
      ) : null}
      {/* Below the breakpoint the whole bar is behind this; above it, this is not drawn. */}
      <button
        type="button"
        ref={burger}
        className="burger"
        aria-label={t.menu.name}
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((v) => !v)}
      >
        <BurgerMark />
      </button>
      <div className="tools" id={panel} data-open={open ? "1" : "0"}>
        {/* Panel furniture, and nothing above the breakpoint: there is no panel there to title
            or to close. */}
        <div className="toolhead">
          <span className="toolttl">{t.menu.name}</span>
          <button type="button" className="toolx" aria-label={t.menu.close} onClick={close}>
            <CloseMark />
          </button>
        </div>
        {report ? (
          <>
            <Tool>
              <span className="t-grow" data-i={first}>
                <CopyChartButton />
              </span>
            </Tool>
            <Tool>
              <span className="t-grow" data-i={first - 1}>
                <ShareButton />
              </span>
            </Tool>
            <Tool label={t.reset.name}>
              <span className="t-grow" data-i={first - 2}>
                <ResetButton onReset={reset} />
              </span>
            </Tool>
            {ttl ? (
              <Tool label={t.ttl.name}>
                <span className="t-grow" data-i="0">
                  <Cycle name={t.ttl.name} options={ttls(t)} value={state.ttl} onPick={pickTtl} />
                </span>
              </Tool>
            ) : null}
          </>
        ) : null}
        {/* Inside the anchor rather than beside it: language and theme exist before there is a bill
            and outlive any one of them, so everything else grows leftward past them. */}
        <Tool label={t.language}>
          <LangPicker />
        </Tool>
        <Tool label={t.theme.name}>
          <Cycle options={themes(t)} value={state.theme} onPick={pickTheme} />
        </Tool>
      </div>
      {/* Only ever drawn below the breakpoint, and only then when the panel is up. */}
      <button
        type="button"
        className="scrim"
        tabIndex={-1}
        aria-hidden="true"
        data-open={open ? "1" : "0"}
        onClick={close}
      />
    </div>
  )
}
