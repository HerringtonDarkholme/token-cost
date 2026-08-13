/* The instrument's controls. Every one of them is a real button with `aria-pressed`, so
   the current lens is announced rather than only coloured. */

import { useEffect, useRef, useState } from "react";
import { useReport } from "./context.ts";
import { summaryText } from "./model.ts";
import { ShareButton } from "./Share.tsx";
import { setState, type ThemeChoice } from "./store.ts";

/** A momentary "done" state that reverts itself, with the timer cancelled on unmount --
 *  the report unmounts when the reader loads a new file, and a pending revert firing into
 *  a gone component is exactly the kind of thing that logs a warning in production. */
function useFlash(ms = 1800): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [on, () => {
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  }];
}

/** Best-effort: a `file://` page can have no clipboard permission at all, and the button
 *  still has to give feedback rather than throw into the console. */
function copy(text: string): void {
  try { void navigator.clipboard?.writeText(text).catch(() => {}); } catch { /* no clipboard */ }
}

function Toggle({ on, label, onClick }: {
  on: boolean; label: string; onClick: () => void;
}): React.JSX.Element {
  return <button type="button" aria-pressed={on} onClick={onClick}>{label}</button>;
}

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
    <button type="button" className="eyebtn" aria-pressed={on}
      aria-label="Hide dollar amounts" title={on ? "Show dollar amounts" : "Hide dollar amounts"}
      onClick={() => setState({ pctOnly: !on })}>
      <span className="eyeamt">$</span>
      <Eye off={on} />
    </button>
  );
}

export function Toolbar({ onReset }: { onReset: () => void }): React.JSX.Element {
  const { d, state, amt } = useReport();
  const [linked, flashLink] = useFlash();
  const [copied, flashCopy] = useFlash();

  const themes: Array<[ThemeChoice, string]> = [["light", "Light"], ["system", "System"], ["dark", "Dark"]];

  return (
    <div className="toolbar">
      <span className="tick" />
      <button type="button" className="linkish" data-on={linked ? 1 : 0}
        onClick={() => { copy(location.href); flashLink(); }}>
        {linked ? "Link copied" : "Copy link to this view"}
      </button>
      <button type="button" className="linkish" data-on={copied ? 1 : 0}
        onClick={() => { copy(summaryText(d, state.pctOnly, amt)); flashCopy(); }}>
        {copied ? "Summary copied" : "Copy summary"}
      </button>
      <ShareButton />
      <span className="seg">
        <MaskToggle on={state.pctOnly} />
      </span>
      <span className="seg">
        <span className="seglbl">TTL</span>
        <Toggle on={state.ttl === "1h"} label="1h" onClick={() => setState({ ttl: "1h" })} />
        <Toggle on={state.ttl === "5m"} label="5m" onClick={() => setState({ ttl: "5m" })} />
      </span>
      <span className="seg">
        {themes.map(([value, label]) => (
          <Toggle key={value} on={state.theme === value} label={label}
                  onClick={() => setState({ theme: value })} />
        ))}
      </span>
      <span className="seg">
        <button type="button" onClick={onReset}>New file</button>
      </span>
    </div>
  );
}

/** The upload screen carries the same theme control and nothing else, so it gets its own
 *  small toolbar rather than a stripped-down copy of the report's. */
export function ThemeBar({ theme }: { theme: ThemeChoice }): React.JSX.Element {
  const themes: Array<[ThemeChoice, string]> = [["light", "Light"], ["system", "System"], ["dark", "Dark"]];
  return (
    <div className="toolbar">
      <span className="tick" />
      <span className="seg">
        {themes.map(([value, label]) => (
          <Toggle key={value} on={theme === value} label={label}
                  onClick={() => setState({ theme: value })} />
        ))}
      </span>
    </div>
  );
}
