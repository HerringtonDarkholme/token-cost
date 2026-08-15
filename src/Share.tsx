/* Two ways to take the chart out of the page: copy it, or post it.

   Both stand on the same act -- render the card to a PNG and put it where the reader can
   use it -- and they differ only in what happens after. "Copy chart" ends there, which is
   what a reader wants when the destination is a doc, a deck, a Slack thread, or an X post
   they would rather write themselves. "Share chart on X" goes on to open the composer with
   a caption already written -- one of several, drawn at random per share, so that a timeline
   seeing this page more than once is not reading the same sentence again.

   The composer at x.com/intent/post takes text and nothing else. There is no parameter that
   attaches an image and nothing in the page can reach into it to add one, which is exactly
   why the copy has to be a button in its own right rather than a step hidden inside the
   share: the image is on the clipboard either way, and the reader who never wanted the
   composer should not have to open one to get it.

   Clipboard first, because pasting is a single keystroke; a download when the clipboard is
   refused, which is the normal case on `file://`. The button says which of the two happened
   -- anything that silently copies and then reports "shared" has lied about the one step
   the reader still has to take. */

import { useEffect, useRef, useState } from "react"
import { useReport } from "./context.ts"
import { useT, type Dict } from "./copy.tsx"
import { postText } from "./model.ts"
import { TextSwap } from "./Motion.tsx"
import { download, snapshot } from "./snapshot.ts"

const FILENAME = "where-the-money-went.png"

/** Not a result, so it never times out: "busy" ends when the work does. */
type Outcome = "busy" | "copied" | "saved" | "failed"

/** Like the toolbar's flash, but carrying which outcome to announce, and held long enough
 *  to be read as an instruction rather than a receipt. The timer is cancelled on unmount
 *  because loading a new file unmounts the report mid-flight. */
function useOutcome(ms = 6000): [Outcome | null, (o: Outcome | null) => void] {
  const [at, setAt] = useState<Outcome | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return [
    at,
    (o: Outcome | null) => {
      setAt(o)
      if (timer.current) clearTimeout(timer.current)
      if (o && o !== "busy") timer.current = setTimeout(() => setAt(null), ms)
    },
  ]
}

/** The card as a PNG, on the clipboard or on disk, with `then` run only if it got there. */
function useChartPng(): [Outcome | null, (then?: () => void) => Promise<void>] {
  const [at, setAt] = useOutcome()

  const run = async (then?: () => void): Promise<void> => {
    const card = document.querySelector<HTMLElement>(".card")
    if (!card) {
      setAt("failed")
      return
    }
    setAt("busy")

    /* Started before the clipboard call and handed over unresolved: Safari only accepts a
       write it can tie to the click, so the ClipboardItem has to be constructed with the
       promise rather than with an image awaited first. */
    const png = snapshot(card)

    let done: Outcome
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
      done = "copied"
    } catch {
      /* No clipboard, no permission, or no ClipboardItem at all. The render itself may also
         have failed, in which case awaiting it here rethrows into the catch below. */
      try {
        download(await png, FILENAME)
        done = "saved"
      } catch {
        setAt("failed")
        return
      }
    }
    setAt(done)
    then?.()
  }

  return [at, run]
}

const copyWords = (t: Dict): Record<Outcome, string> => ({
  busy: t.share.copyBusy,
  copied: t.share.copyDone,
  saved: t.share.copySaved,
  failed: t.share.copyFailed,
})

const shareWords = (t: Dict): Record<Outcome, string> => ({
  busy: t.share.busy,
  copied: t.share.copied,
  saved: t.share.saved,
  failed: t.share.failed,
})

/** The X mark, filled with `currentColor` so it inverts with the button like the eye does.
 *  It stands in for the word at the end of the label rather than leading it as an icon --
 *  the sentence is "share to X", and X is a logo, not a letter. */
function XMark(): React.JSX.Element {
  return (
    <svg className="xicon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254
               2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z"
      />
    </svg>
  )
}

export function CopyChartButton(): React.JSX.Element {
  const [at, run] = useChartPng()
  const t = useT()
  const words = copyWords(t)
  return (
    <button
      type="button"
      className="linkish"
      data-on={at && at !== "busy" ? 1 : 0}
      disabled={at === "busy"}
      onClick={() => {
        void run()
      }}
    >
      <TextSwap token={at || "idle"}>{at ? words[at] : t.share.copy}</TextSwap>
    </button>
  )
}

export function ShareButton(): React.JSX.Element {
  const { d, state } = useReport()
  const [at, run] = useChartPng()
  const t = useT()
  const words = shareWords(t)

  const share = (): void => {
    /* Where the invitation points: this page, if it is somewhere a reader can be sent. A
       standalone file opened from disk has an address that means nothing to anyone else, so
       it gets no link rather than a dead one. */
    const home =
      location.protocol === "http:" || location.protocol === "https:"
        ? location.origin + location.pathname
        : null
    const url =
      "https://x.com/intent/post?text=" + encodeURIComponent(postText(d, state.pctOnly, home))
    /* Opened last, and only on success, so a blocked popup cannot cost the reader the image.
       The activation from the click survives the render in every browser that allows popups
       at all; if it does not, the caption is a click away in the composer anyway. */
    void run(() => {
      window.open(url, "_blank", "noopener,noreferrer")
    })
  }

  /* The mark carries no text of its own, so the accessible name has to say the word it
     stands for -- a button announced as "share to" is a button announced as nothing. */
  return (
    <button
      type="button"
      className="linkish"
      data-on={at && at !== "busy" ? 1 : 0}
      disabled={at === "busy"}
      onClick={share}
      aria-label={at ? words[at] : t.share.name}
    >
      <TextSwap token={at || "idle"}>
        {at ? (
          words[at]
        ) : (
          <>
            {t.share.to}
            <XMark />
          </>
        )}
      </TextSwap>
    </button>
  )
}
