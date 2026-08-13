/* The card's empty face: take files from a picker or a drop, read them in the page, hand them
   to the engine. Nothing leaves the machine -- there is no fetch here and no server to send
   anything to.

   This is the inside of the same card the report ends up in, not a screen of its own, which is
   why there is no frame drawn here and no heading: the card supplies both, and the heading
   merely changes tense once the bill exists. What the zone owns is the drop target -- it fills
   the card's interior, so the frame the reader aims at is the frame that lights up. See
   `.card:has([data-over="1"])`.

   The copy about *where* the transcripts live is not decoration, and it is inside the card for
   the same reason the ask is a folder rather than files: `.claude` is a dotfile, so the picker
   this page is about to open hides the very folder it just asked for. A reader who cannot get
   there never sees a report at all, and help that stands below the fold assumes they will go
   looking for it. */

import { useId, useRef, useState, type ReactNode } from "react"
import { analyze, type Analysis, type RawFile } from "./engine.ts"
import { TextSwap } from "./Motion.tsx"
import { Tip } from "./Tip.tsx"

const MAX_LISTED = 60

type Os = "mac" | "win" | "linux"

/* The three platforms as their names, in the order the switch walks them. Drawn as logos once --
   an apple, four panes, a penguin -- which was a worse control on every count: three marks where
   two are always wrong, a penguin that is illegible at the size a control wants, and a row of
   borrowed trademarks in a page that otherwise draws its own glyphs. A word says which platform
   with no drawing at all. */
const PLATFORMS: ReadonlyArray<{ value: Os; label: string }> = [
  { value: "mac", label: "macOS" },
  { value: "win", label: "Windows" },
  { value: "linux", label: "Linux" },
]

/** The one platform, and the way to the next. Not a segmented control: two of the three options
 *  are wrong for any given reader, and a row that shows all three spends the space on the two
 *  that do not apply. The guess is right nearly always, so the odd reader it fails is served by
 *  a click rather than by a permanent row -- press it and it walks to the next platform. */
function OsSwitch({ os, onPick }: { os: Os; onPick: (v: Os) => void }): React.JSX.Element {
  const tip = useId()
  const at = PLATFORMS.findIndex((p) => p.value === os)
  const next = PLATFORMS[(at + 1) % PLATFORMS.length]
  return (
    <span className="t-tt-host">
      <button
        type="button"
        className="osbtn t-tt-trigger"
        aria-describedby={tip}
        onClick={() => onPick(next.value)}
      >
        <span className="osname">
          <TextSwap token={os}>{PLATFORMS[at].label}</TextSwap>
        </span>
        {/* The one mark left on this control, and it is about the control rather than about any
            platform: a chevron is what says "there are others behind this". Same glyph recipe as
            the toolbar's, at the size a caret wants. */}
        <svg className="glyph oscaret" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="m3.6 6.2 4.4 4.4 4.4-4.4" />
        </svg>
      </button>
      <Tip id={tip}>
        Not {PLATFORMS[at].label}? Press for the {next.label} route.
      </Tip>
    </span>
  )
}

/** Which dialog the reader is about to meet. A guess from the user agent rather than a question,
 *  because two of the three answers are wrong for any given reader and the switch is right there
 *  when the guess is. Linux is the fallback: its instruction is the GTK dialog's, which is also
 *  the least harmful thing to show someone whose browser reports something unrecognisable. */
function guessOs(): Os {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  if (/Mac|iPhone|iPad/.test(ua)) return "mac"
  if (/Win/.test(ua)) return "win"
  return "linux"
}

/** One line per platform, and it is the keystrokes rather than prose about them: this is read
 *  with a file dialog already open on top of it.
 *
 *  macOS gets both routes because they answer different questions. ⇧⌘. unhides every dotfile in
 *  the dialog, which is the one to reach for when you want to see where you are going; ⇧⌘G takes
 *  a typed path and skips the looking entirely. The other two have only the typed route -- their
 *  dialogs have a location box, so unhiding is not a separate trick. */
const HOW: Record<Os, ReactNode> = {
  mac: (
    <>
      In the dialog press <kbd>⇧</kbd>
      <kbd>⌘</kbd>
      <kbd>.</kbd> to reveal hidden folders. Or <kbd>⇧</kbd>
      <kbd>⌘</kbd>
      <kbd>G</kbd> and paste <code>~/.claude/projects</code>.
    </>
  ),
  win: (
    <>
      Type <code>%USERPROFILE%\.claude\projects</code> into the dialog’s <em>Folder</em> box, press{" "}
      <kbd>Enter</kbd>.
    </>
  ),
  linux: (
    <>
      In the dialog press <kbd>Ctrl</kbd>
      <kbd>L</kbd>, type <code>~/.claude/projects</code>, press <kbd>Enter</kbd>.
    </>
  ),
}

interface Status {
  node: ReactNode
  err: boolean
}

/** Walk a dropped folder. `webkitGetAsEntry` is non-standard and the DOM types declare it
 *  as always present, but it is the entry point that makes dropping a *directory* work at
 *  all, so it stays feature-detected rather than assumed. */
function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  return new Promise((res) => {
    if (entry.isFile) {
      ;(entry as FileSystemFileEntry).file(
        (f) => {
          out.push(f)
          res()
        },
        () => res(),
      )
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const more = (): void =>
        reader.readEntries(
          async (entries) => {
            if (!entries.length) return res()
            await Promise.all(entries.map((e) => walkEntry(e, out)))
            more()
          },
          () => res(),
        )
      more()
    } else res()
  })
}

export function Intake({ onData }: { onData: (data: Analysis) => void }): React.JSX.Element {
  const [status, setStatus] = useState<Status | null>(null)
  const [names, setNames] = useState<string[] | null>(null)
  const [over, setOver] = useState(false)
  const [os, setOs] = useState<Os>(guessOs)
  const dirPicker = useRef<HTMLInputElement>(null)

  const say = (node: ReactNode, err = false): void => setStatus({ node, err })

  async function handle(list: FileList | File[] | null): Promise<void> {
    const all = [...(list || [])]
    const files = all.filter((f) => f.name.endsWith(".jsonl"))
    if (!files.length) {
      say(
        all.length ? (
          <>
            None of those {all.length} file(s) are <code>.jsonl</code> transcripts.
          </>
        ) : (
          "No files selected."
        ),
        true,
      )
      return
    }

    say(
      <>
        Reading <b>{files.length}</b> file{files.length > 1 ? "s" : ""}…
      </>,
    )
    setNames(
      files
        .slice(0, MAX_LISTED)
        .map((f) => f.name)
        .concat(files.length > MAX_LISTED ? [`… +${files.length - MAX_LISTED} more`] : []),
    )

    let payload: RawFile[]
    try {
      payload = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })))
    } catch (e) {
      say(`Could not read the files: ${(e as Error).message}`, true)
      return
    }

    const bytes = payload.reduce((a, b) => a + b.text.length, 0)
    say(
      <>
        Analyzing <b>{(bytes / 1e6).toFixed(1)} MB</b>…
      </>,
    )
    /* Let that status actually paint before the parse takes the main thread: a multi-hundred
       megabyte corpus is seconds of synchronous work, and a page that goes silent first
       reads as hung. */
    await new Promise((r) => setTimeout(r, 16))

    let data: Analysis
    try {
      data = analyze(payload)
    } catch (e) {
      say(`Analysis failed: ${(e as Error).message}`, true)
      console.error(e)
      return
    }
    if (!data.requests) {
      say(
        <>
          Parsed {payload.length} file(s) but found no priced API requests — are these Claude Code
          transcripts from <code>~/.claude/projects/</code>?
        </>,
        true,
      )
      return
    }
    /* Handed over only once the parse is done, so the card's turn plays against a free main
       thread: an exit animation started before seconds of synchronous work freezes mid-slide. */
    onData(data)
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setOver(false)
    const items = e.dataTransfer?.items
    if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
      const out: File[] = []
      const entries = [...items]
        .map((i) => i.webkitGetAsEntry())
        .filter((x): x is FileSystemEntry => !!x)
      await Promise.all(entries.map((entry) => walkEntry(entry, out)))
      await handle(out)
    } else {
      await handle(e.dataTransfer?.files ?? null)
    }
  }

  return (
    <div
      className="dropzone"
      data-over={over ? "1" : "0"}
      onDragEnter={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        // Leaving for a child element is not leaving the drop zone.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        void onDrop(e)
      }}
    >
      {/* Three bands, standing where the report's three stand: the lede on the strip's line, the
          invitation on the picture's, the privacy note on the rule that closes the card.

          One line, and it took three tries to get there. It was the method first -- per-request
          billing, re-billed context, the definition of carry cost -- which is the right paragraph
          in the wrong place: it argued for numbers to a reader who had not seen any. Then it was a
          promise and a row of three things you get, one of which ("by project, by session") the
          engine does not do: nothing here groups by project, and sessions are counted rather than
          broken out. What survives is the offer and the claim the report can actually keep. */}
      <p className="lede">
        Drop the folder in and the bill comes back itemised — which tools, which subcommands, and
        what each one cost on every request it stayed in.
      </p>
      <div className="invite">
        {/* The ask is the folder, not the files. `.jsonl` is a detail of the format that a reader
            has no reason to know, and asking for files put them in a picker with a hidden dotfile
            to defeat and dozens of identically-named transcripts to multi-select; asking for the
            one folder is a single pick that catches everything under it. Loose files dragged in
            still work -- the filter above does not care how they arrived -- there is just no
            longer a button that recommends it. */}
        <h2>
          Drop your <code>~/.claude/projects</code> folder here
        </h2>
        <div className="picks">
          <button className="btn primary" type="button" onClick={() => dirPicker.current?.click()}>
            Choose folder
          </button>
        </div>
        {/* And the way in, in the card rather than under it. This used to stand in the help below
            the fold, which assumed the reader would go looking: `.claude` is a dotfile, so the
            picker they are about to open hides the folder this page just asked for, and a reader
            who cannot get there never sees a report at all. It is one line because only one
            platform's line applies -- theirs is picked for them, and the switch is for when the
            guess is wrong. */}
        <div className="howto">
          {/* Two rows, rather than one row of label, sentence and switch run together: the switch
              decides *which* instruction is drawn, so it belongs above the line it governs, not
              inline with it where it reads as the end of the sentence.

              No box around it any more. Sunk panel, hairline, rule between the rows -- three
              pieces of chrome for two lines of help, sitting inside a card that is itself a
              frame, which made the way in look like a second thing to decide about rather than
              the answer to the heading above it. What separates it now is the space around it.

              No path in the label: it is set in mono caps, which would print a dotfile's name as
              `.CLAUDE`, and the path is already the loudest thing in the heading above. Why the
              folder is hidden is in the help below the card; what a reader stuck at a dialog needs
              is the keystrokes. */}
          <div className="howhead">
            <span className="howlbl">The folder is hidden</span>
            <OsSwitch os={os} onPick={setOs} />
          </div>
          {/* Keyed on the platform, so switching plays the same swap the report's figures do
              rather than substituting the words underneath the reader. Inside the paragraph
              rather than around it: `TextSwap` is a span, and a span may not hold a `<p>`. */}
          <p>
            <TextSwap token={os}>{HOW[os]}</TextSwap>
          </p>
        </div>
        <div className="status" data-err={status?.err ? "1" : "0"}>
          {status?.node}
        </div>
        {names ? (
          <div className="filelist">
            {names.map((n) => (
              <div key={n}>{n}</div>
            ))}
          </div>
        ) : null}
      </div>
      <input
        ref={dirPicker}
        type="file"
        multiple
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => {
          void handle(e.target.files)
        }}
      />
      <p className="privacy">Parsed in this page · nothing is uploaded</p>
    </div>
  )
}

/** The help that stands under the empty card, where the breakdown and the footnotes stand under
 *  a full one -- so it holds the same ground: two columns on the same rule, across the width of
 *  the shell. It is the one block with no counterpart in the report, which is why it is here
 *  rather than something the report's own footnotes grow out of.
 *
 *  What it is *not* any more is the way in. The per-platform route to the hidden folder moved
 *  into the card, next to the button that opens the dialog it describes; what is left down here
 *  is what the folder holds, the terminal way round, and the answer to the question a page that
 *  asks for a whole folder of transcripts has to answer. */
export function Where(): React.JSX.Element {
  return (
    <div className="where">
      <div>
        <p className="whead">
          <strong>What you are handing over</strong>
        </p>
        <p>
          One <code>.jsonl</code> file per session, in one folder per project, under{" "}
          <code>~/.claude/projects/</code> — a dotfile, which is why every file picker hides it
          until you ask for it by name. Everything you pick is combined into a single report — the
          breakdown is by what spent the money, not by which folder it was spent in, so pick one
          project&apos;s folder if that is the bill you want.
        </p>
        <p className="whead">
          <strong>Prefer the terminal?</strong>
        </p>
        <p>
          Open the folder in your file manager, then drag it onto the card above:{" "}
          <code>open ~/.claude/projects</code>
        </p>
        <p>
          Largest projects first: <code>du -sh ~/.claude/projects/*/ | sort -rh | head</code>
        </p>
      </div>
      <div>
        <p className="whead">
          <strong>Nothing is uploaded</strong>
        </p>
        <p>
          The files are read and the bill worked out in this page: there is no server to send a
          transcript to, and the build fails if anything in here reaches the network. Save the page
          and it works the same from disk.
        </p>
        <p className="whead">
          <strong>A shared link carries the view, not the bill</strong>
        </p>
        <p>
          The address records which lens and which block you are looking at — never the numbers.
          Whoever opens it gets an empty card and drops their own transcripts in.
        </p>
      </div>
    </div>
  )
}
