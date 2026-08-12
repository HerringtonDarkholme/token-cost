/* The instrument's controls. Every one of them is a real button with `aria-pressed`, so
   the current lens is announced rather than only coloured. */

import { useEffect, useRef, useState } from "react";
import { useReport } from "./context.ts";
import { summaryText } from "./model.ts";
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
      <span className="seg">
        <Toggle on={!state.pctOnly} label="$" onClick={() => setState({ pctOnly: false })} />
        <Toggle on={state.pctOnly} label="%" onClick={() => setState({ pctOnly: true })} />
      </span>
      <span className="seg">
        <Toggle on={state.ttl === "1h"} label="1h TTL" onClick={() => setState({ ttl: "1h" })} />
        <Toggle on={state.ttl === "5m"} label="5m TTL" onClick={() => setState({ ttl: "5m" })} />
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
