/* The segmented control, wherever the page offers a small set of mutually exclusive lenses.

   Four of these existed as hand-written spans of buttons, each flipping its own background
   on `aria-pressed`. They are one component now because the pressed state is no longer a
   property of the button: it is a single pill that travels between them, and a travelling
   pill needs one owner that knows where the options are.

   The position is measured, not computed. The options are words -- "Light", "System",
   "Dark", "Sunburst" -- of different widths, so the pill's left edge and width come from the
   button that is actually pressed rather than from a fraction of the bar.

   `aria-pressed` rather than the `aria-selected` the transition's reference markup uses:
   these are buttons, not tabs, and `aria-selected` on a button that is not in a tablist is
   announced as nothing. The pill is decoration over the top of that, and says so. */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export function Seg<T extends string>({
  label,
  options,
  value,
  onPick,
  nosnap,
}: {
  /** Names what the options choose, said once instead of once per button. */
  label?: string;
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onPick: (v: T) => void;
  /** Keep this control out of the PNG, for the ones that sit inside the card. */
  nosnap?: boolean;
}): React.JSX.Element {
  const bar = useRef<HTMLSpanElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const settled = useRef(false);

  /** Write the pressed button's box onto the pill. `animate` false suspends the transition
   *  and forces a reflow, so first paint and resize snap into place instead of sliding in
   *  from `translateX(0)` at zero width. */
  const place = useCallback((animate: boolean): void => {
    const el = pill.current,
      host = bar.current;
    if (!el || !host) return;
    const on = host.querySelector<HTMLElement>('button[aria-pressed="true"]');
    if (!on) return;

    const prev = el.style.transition;
    if (!animate) el.style.transition = "none";
    el.style.transform = `translateX(${on.offsetLeft}px)`;
    el.style.width = `${on.offsetWidth}px`;
    if (!animate) {
      void el.offsetWidth;
      el.style.transition = prev;
    }
  }, []);

  /* Before paint, so the pill is already under the pressed option on the frame it appears,
     and every later change is a slide. */
  useLayoutEffect(() => {
    place(settled.current);
    settled.current = true;
  }, [place, value, options]);

  useEffect(() => {
    const onResize = (): void => place(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [place]);

  return (
    <span className="seg t-tabs" ref={bar} data-nosnap={nosnap ? "" : undefined}>
      {label ? <span className="seglbl">{label}</span> : null}
      <span className="t-tabs-pill" aria-hidden="true" ref={pill} />
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          className="t-tab"
          aria-pressed={v === value}
          onClick={() => onPick(v)}
        >
          {text}
        </button>
      ))}
    </span>
  );
}
