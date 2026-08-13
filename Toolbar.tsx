/* The instrument's controls. Every one of them is a real button with `aria-pressed`, so
   the current lens is announced rather than only coloured. */

import type { TtlAssumption } from "./engine.ts";
import { useReport } from "./context.ts";
import { Seg } from "./Seg.tsx";
import { CopyChartButton, ShareButton } from "./Share.tsx";
import { setState, type ThemeChoice } from "./store.ts";

const THEMES: ReadonlyArray<readonly [ThemeChoice, string]> = [
  ["light", "Light"],
  ["system", "System"],
  ["dark", "Dark"],
];

const TTLS: ReadonlyArray<readonly [TtlAssumption, string]> = [
  ["1h", "1h"],
  ["5m", "5m"],
];

/* The switches hand these down rather than closing over a fresh arrow each render. Nothing
   here needs a component's scope -- a pick is a write to the store, which is a module away --
   so they are written once, and the two theme switches are the same function. */
const pickTtl = (ttl: TtlAssumption): void => setState({ ttl });
const pickTheme = (theme: ThemeChoice): void => setState({ theme });

/** The eye every brokerage app puts over its balance. Stroked in `currentColor` so it
 *  inverts with the button rather than needing a second colour for the pressed state. */
function Eye({ off }: { off: boolean }): React.JSX.Element {
  return (
    <svg className="eyeicon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M1 8S3.6 3.5 8 3.5 15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z" />
      <circle cx="8" cy="8" r="2.1" />
      {off && <path d="M2.4 13.6 13.6 2.4" />}
    </svg>
  );
}

/** Cover the dollars. One button rather than a `$`/`%` pair, because this is not a choice
 *  between two units -- it is one thing being covered up, and the reader wants the state at
 *  a glance while sharing a screen. Pressed is the covered state: the mask is the departure
 *  from the default, so it is the one that earns the filled treatment.
 *
 *  The accessible name stays put while `aria-pressed` carries the state, which is the toggle
 *  contract -- a label that flipped to "Show" would leave a screen reader hearing
 *  "Show, pressed" and no way to tell what that means. */
function MaskToggle({ on }: { on: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      className="eyebtn"
      aria-pressed={on}
      aria-label="Hide dollar amounts"
      title={on ? "Show dollar amounts" : "Hide dollar amounts"}
      onClick={() => setState({ pctOnly: !on })}
    >
      <span className="eyeamt">$</span>
      <Eye off={on} />
    </button>
  );
}

/** The two things worth taking out of the page are the picture and the post. A link is not
 *  one of them: the hash carries the view -- lens, drill, chart -- and none of the data,
 *  which lives only in the reader's own browser, so a shared link opens on an upload screen
 *  for whoever receives it. */
export function Toolbar({ onReset }: { onReset: () => void }): React.JSX.Element {
  const { state } = useReport();

  return (
    <div className="toolbar">
      <span className="tick" />
      <CopyChartButton />
      <ShareButton />
      <span className="seg">
        <MaskToggle on={state.pctOnly} />
      </span>
      <Seg label="TTL" options={TTLS} value={state.ttl} onPick={pickTtl} />
      <Seg options={THEMES} value={state.theme} onPick={pickTheme} />
      <span className="seg">
        <button type="button" onClick={onReset}>
          New file
        </button>
      </span>
    </div>
  );
}

/** The upload screen carries the same theme control and nothing else, so it gets its own
 *  small toolbar rather than a stripped-down copy of the report's. */
export function ThemeBar({ theme }: { theme: ThemeChoice }): React.JSX.Element {
  return (
    <div className="toolbar">
      <span className="tick" />
      <Seg options={THEMES} value={theme} onPick={pickTheme} />
    </div>
  );
}
