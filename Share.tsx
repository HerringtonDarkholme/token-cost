/* Share the chart on X.

   The composer at x.com/intent/post takes text and nothing else -- there is no parameter
   that attaches an image, and nothing in the page can reach into the composer to add one.
   So the button does the half it can do properly: it renders the card to a PNG, puts that
   PNG where the reader can attach it in one keystroke, and opens the composer with the
   caption already written. Clipboard first, because pasting into the composer is a single
   ⌘V; a download when the clipboard is refused, which is the normal case on `file://`.

   The button says which of the two happened. Anything that silently copies and then tells
   the reader "shared" has lied about the one step they still have to take. */

import { useEffect, useRef, useState } from "react";
import { useReport } from "./context.ts";
import { postText } from "./model.ts";
import { download, snapshot } from "./snapshot.ts";

const FILENAME = "where-the-money-went.png";

type Outcome = "busy" | "copied" | "saved" | "failed";

const LABEL: Record<Outcome, string> = {
  busy: "Rendering the chart…",
  copied: "Image copied — paste it into the post",
  saved: "Image saved — attach it to the post",
  failed: "Could not render the image",
};

/** Like the toolbar's flash, but carrying which of the outcomes to announce, and held long
 *  enough to be read as an instruction rather than a receipt. The timer is cancelled on
 *  unmount because loading a new file unmounts the report mid-flight. */
function useOutcome(ms = 6000): [Outcome | null, (o: Outcome | null) => void] {
  const [at, setAt] = useState<Outcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [at, (o: Outcome | null) => {
    setAt(o);
    if (timer.current) clearTimeout(timer.current);
    // "busy" is not a result and must not time out; it ends when the work does.
    if (o && o !== "busy") timer.current = setTimeout(() => setAt(null), ms);
  }];
}

/** The X mark, stroked in `currentColor` so it inverts with the button like the eye does. */
function XMark(): React.JSX.Element {
  return (
    <svg className="xicon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254
               2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" />
    </svg>
  );
}

export function ShareButton(): React.JSX.Element {
  const { d, state } = useReport();
  const [at, setAt] = useOutcome();

  const share = async (): Promise<void> => {
    const card = document.querySelector<HTMLElement>(".card");
    if (!card) { setAt("failed"); return; }
    setAt("busy");

    const url = "https://x.com/intent/post?text=" + encodeURIComponent(postText(d, state.pctOnly));
    /* Started before the clipboard call and handed over unresolved: Safari only accepts a
       write it can tie to the click, so the ClipboardItem has to be constructed with the
       promise rather than with an image awaited first. */
    const png = snapshot(card);

    let done: Outcome;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      done = "copied";
    } catch {
      /* No clipboard, no permission, or no ClipboardItem at all. The render itself may also
         have failed, in which case awaiting it here rethrows into the outer catch. */
      try {
        download(await png, FILENAME);
        done = "saved";
      } catch { setAt("failed"); return; }
    }
    setAt(done);

    /* Opened last so a blocked popup cannot cost the reader the image. The activation from
       the click survives the render in every browser that allows popups at all; if it does
       not, the caption is a click away in the composer anyway. */
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <button type="button" className="linkish" data-on={at && at !== "busy" ? 1 : 0}
      disabled={at === "busy"} onClick={() => { void share(); }}>
      <XMark />
      {at ? LABEL[at] : "Share chart on X"}
    </button>
  );
}
