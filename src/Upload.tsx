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
   looking for it.

   Once a folder *has* been chosen, nothing here asks about it twice. The pick is the answer, and
   the browser has already made the reader confirm it once in its own dialog; a page that comes
   back with "are these really your transcripts?" is asking a question it can answer itself. It
   can, because every file arrives with the path it sat at inside the chosen folder -- see
   `originOf` -- so when a pick turns out to be empty or unbilled, what is said back names the
   folder that was picked and whether it was the transcript store at all.

   And the moment it has been chosen, the route into the hidden folder is answered rather than
   left standing: the keystrokes are help for a dialog that is no longer open, and the thing the
   reader now wants to see is what came back out. So the two share one box -- the note leaves and
   the transcripts arrive in the same place, the box growing into the taller job as they cross.

   The list says out loud that work is happening, because the parse behind it is seconds of
   synchronous main thread and a page that goes still reads as a page that has died. It says it
   by writing the names out, one character at a time, one row overlapping the last -- the machine
   reading the folder out to you rather than a bar or a spinner drawn beside a list that is
   already complete. What does the typing is a cover the colour of the panel sliding off the name
   in as many steps as it has characters, which is a `transform` and therefore composited: it
   keeps running while the parse holds the thread, where anything paint-driven would freeze on
   the frame the parse started. The cover's leading edge is the caret, and it clips itself on the
   last step -- see `.filecover`. */

import { useId, useRef, useState, type ReactNode } from "react"
import {
  billedSoFar,
  closeWalk,
  openWalk,
  report,
  walkOne,
  type Analysis,
  type Scanned,
} from "./engine.ts"
import { TextSwap } from "./Motion.tsx"
import { Tip } from "./Tip.tsx"

type Os = "mac" | "win" | "linux"

/* The three platforms, each a mark and a word. Same recipe as every other glyph on the page: one
   16-unit box, stroked in `currentColor` at one weight, no fills -- a solid silhouette could not
   follow the chip's ink the way these do, and at this size a filled penguin is a pear.
   These were a row of three once, as the whole face of a segmented control, which is what made
   them a problem: three logos where two are always wrong, carrying the entire job of saying which
   platform you were on at 14px. One mark, beside the word that already says it, is a different
   job -- the word carries the meaning and the mark is what the eye finds first. */
function AppleMark(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M10.55 8.35c0-1.35.95-2 1-2.05-.55-.8-1.4-.9-1.7-.9-.75-.05-1.45.4-1.85.4-.4 0-.98-.4-1.6-.4-.85 0-1.6.5-2.05 1.25-.85 1.5-.2 3.7.6 4.9.4.6.9 1.25 1.55 1.25.6-.03.85-.4 1.6-.4.75 0 .95.4 1.6.4.65-.02 1.1-.6 1.5-1.2.35-.5.5-1 .5-1.05-.05 0-1.15-.45-1.15-1.8Z" />
      <path d="M9.35 4.15c.35-.4.55-.95.5-1.5-.5.02-1.1.32-1.45.72-.32.37-.6.95-.52 1.5.55.05 1.12-.28 1.47-.72Z" />
    </svg>
  )
}

function WindowsMark(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2.1" y="2.1" width="5.1" height="5.1" />
      <rect x="8.8" y="2.1" width="5.1" height="5.1" />
      <rect x="2.1" y="8.8" width="5.1" height="5.1" />
      <rect x="8.8" y="8.8" width="5.1" height="5.1" />
    </svg>
  )
}

/** A penguin, which is the one of the three that has to be *drawn* rather than traced: body,
 *  eyes, beak, feet, and nothing else, because every further line closes up at this size. An
 *  earlier one read as a vase -- the body has to widen to the floor and the feet have to break
 *  the outline, or the silhouette is a pear with two dots in it. */
function TuxMark(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5c1.45 0 2.35 1.15 2.35 2.6 0 .45-.06.85-.06 1.15 0 .45.62.85 1.15 1.7.62.95 1.05 2.2 1.15 3.2.1 1-.35 1.75-1.1 2.2-.85.5-2.05.75-3.49.75s-2.64-.25-3.49-.75c-.75-.45-1.2-1.2-1.1-2.2.1-1 .53-2.25 1.15-3.2.53-.85 1.15-1.25 1.15-1.7 0-.3-.06-.7-.06-1.15C5.65 2.65 6.55 1.5 8 1.5Z" />
      <path d="M7.15 4.3h.01M8.85 4.3h.01" />
      <path d="m7.4 5.35.6.65.6-.65" />
      <path d="M6.2 13.1c-.55.75-1.5 1.15-2.35 1M9.8 13.1c.55.75 1.5 1.15 2.35 1" />
    </svg>
  )
}

const PLATFORMS: ReadonlyArray<{ value: Os; label: string; mark: React.JSX.Element }> = [
  { value: "mac", label: "macOS", mark: <AppleMark /> },
  { value: "win", label: "Windows", mark: <WindowsMark /> },
  { value: "linux", label: "Linux", mark: <TuxMark /> },
]

/** A folder, on the button that opens a folder picker. Decoration in the strict sense -- the
 *  words beside it already say what it does -- but it is what a reader's eye lands on before the
 *  words resolve, and this is the one control on the page that has to be pressed. Same recipe as
 *  every other mark here: one 16-unit box, stroked in `currentColor`, so it takes the button's
 *  paper against its ink and follows it into the accent on hover.
 *
 *  `aria-hidden`, because the button's own text is its name: a second reading of "folder" between
 *  the two words would be noise. */
function FolderMark(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M1.9 12.7V3.5h4.2l1.5 1.9h6.5v7.3a.6.6 0 0 1-.6.6H2.5a.6.6 0 0 1-.6-.6Z" />
      <path d="M1.9 7.3h12.2" />
    </svg>
  )
}

/** The one platform, and the way to the next. Not a segmented control: two of the three options
 *  are wrong for any given reader, and a row that shows all three spends the space on the two
 *  that do not apply. The guess is right nearly always, so the odd reader it fails is served by
 *  a click rather than by a permanent row -- press it and it walks to the next platform. */
function OsSwitch({ os, onPick }: { os: Os; onPick: (v: Os) => void }): React.JSX.Element {
  const tip = useId()
  const at = PLATFORMS.findIndex((p) => p.value === os)
  const next = PLATFORMS[(at + 1) % PLATFORMS.length]
  /* `t-tt-host` carries the hint's placement, and where it lands is a question of room -- see
     `.howto .t-tt`. Beside the chip where there is width for it, under the block where there is
     not, and never over the instruction the chip chooses. */
  return (
    <span className="t-tt-host">
      <button
        type="button"
        className="osbtn t-tt-trigger"
        aria-describedby={tip}
        onClick={() => onPick(next.value)}
      >
        {/* Mark and word swap together, as one face: the platform is one fact, and a logo that
            changed a beat before its name would read as two controls arguing. */}
        <span className="osname">
          <TextSwap token={os}>
            <span className="osface">
              {PLATFORMS[at].mark}
              {PLATFORMS[at].label}
            </span>
          </TextSwap>
        </span>
        {/* The mark that is about the control rather than about any platform: a chevron is what
            says "there are others behind this". Same glyph recipe, at the size a caret wants. */}
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

/** A file, and where it sat inside the folder that was chosen. A `File` on its own cannot say:
 *  the picker's files carry `webkitRelativePath` and a dropped entry's `File` carries nothing at
 *  all, so the path travels beside the file rather than being read back off it later. */
interface Picked {
  file: File
  /** Relative to the chosen folder, that folder's own name first. */
  path: string
}

/** Claude Code names a project's folder after the directory it ran in, separators and all
 *  flattened to dashes: `-Users-me-code-thing` on a mac or a Linux box, `C--Users-me-code-thing`
 *  on Windows. It is the one name on the way down that could not be anything else, which is what
 *  makes it worth matching -- `projects` on its own is a folder half the machines in the world
 *  have in their home directory. */
const PROJECT_DIR = /^-|^[A-Za-z]--/

/** Where a pick came from, as far as its paths can say. */
export interface Origin {
  /** The chosen folder's own name, or `null` for loose files and for several folders at once. */
  root: string | null
  /** Whether it is `~/.claude/projects`, or one project's folder out of it. */
  claude: boolean
}

/** Judge the pick from the paths alone, so the page never has to ask the reader where they just
 *  were. Two shapes count: a `.claude/projects` anywhere on the way down, or a directory named
 *  the way Claude Code names a project's -- which is what is left when the reader picks one
 *  project rather than the whole store, and the folder above it is no longer in the path.
 *
 *  The file's own name is not asked, only the directories above it: a transcript is a session id
 *  and has no business matching anything. */
export function originOf(paths: readonly string[]): Origin {
  const roots = new Set(paths.map((p) => (p.includes("/") ? p.slice(0, p.indexOf("/")) : "")))
  const claude = paths.some((p) => {
    const segs = p.split("/").slice(0, -1)
    return segs.some(
      (s, i) => (s === ".claude" && segs[i + 1] === "projects") || PROJECT_DIR.test(s),
    )
  })
  return { root: roots.size === 1 && !roots.has("") ? [...roots][0] : null, claude }
}

/** Walk a folder handed over by `showDirectoryPicker`. Depth-first, the whole tree, because a
 *  transcript sits two levels down from the store: `projects/<project>/<session>.jsonl`.
 *
 *  `getFile()` is asked for every leaf rather than only the `.jsonl` ones, and that is not
 *  waste: it hands back a lazy handle, not the bytes, and it is what lets the count of *what
 *  was in the folder* survive down to the message that has to say the folder held no
 *  transcripts. Reading happens later, and only for the files that got through the filter. */
async function walkDir(dir: FileSystemDirectoryHandle, at: string, out: Picked[]): Promise<void> {
  for await (const kid of dir.values()) {
    const path = `${at}/${kid.name}`
    if (kid.kind === "directory") await walkDir(kid, path, out)
    else out.push({ file: await kid.getFile(), path })
  }
}

/** The folder picker that does not say "upload".
 *
 *  A `<input webkitdirectory>` pick ends in a browser confirmation — "Upload 1,234 files to this
 *  site?" — which is a fair warning about what a file input normally means and a false statement
 *  about this page: there is no server here, nothing is sent, and the reader has just answered
 *  that exact question in the dialog behind it. `showDirectoryPicker` asks for the one thing that
 *  is actually happening, which is permission to *read* the folder.
 *
 *  It is not everywhere, though, and the fallback is not an edge case: Firefox and Safari have
 *  none of this, and the API is refused outright on `file://` — which is how the saved
 *  single-file page is meant to be opened. So the input stays, and this is the better road when
 *  there is one. `null` means the reader closed the dialog: nothing to say about that.
 *
 *  `id` is what makes the second visit open where the first one ended, which matters more here
 *  than it looks -- the folder this asks for is hidden, so arriving at it is the expensive part. */
async function pickFolder(): Promise<Picked[] | null> {
  const dir = await showDirectoryPicker({ id: "claude-projects", mode: "read" })
  const out: Picked[] = []
  await walkDir(dir, dir.name, out)
  return out
}

/** Walk a dropped folder. `webkitGetAsEntry` is non-standard and the DOM types declare it
 *  as always present, but it is the entry point that makes dropping a *directory* work at
 *  all, so it stays feature-detected rather than assumed. */
function walkEntry(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  return new Promise((res) => {
    if (entry.isFile) {
      ;(entry as FileSystemFileEntry).file(
        (f) => {
          /* The entry's path rather than the file's: a `File` handed over by the drop API has an
             empty `webkitRelativePath`, and `fullPath` is rooted at the folder that was dropped. */
          out.push({ file: f, path: entry.fullPath.replace(/^\//, "") || f.name })
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

/** How many rows the panel shows at once. It is a number here rather than a length in the
 *  stylesheet because the roll below has to count in rows -- how far to travel, and how many
 *  jumps to get there -- and CSS cannot do arithmetic on the step count. So the markup owns it
 *  and hands it over as `--file-rows`, which is what the panel is then sized by: see `.swap`. */
const SHOWN = 7

/** A custom property, on its way to the stylesheet. React types `style` as the properties it
 *  knows the names of, so a variable has to be cast in -- once, here, rather than at each site. */
function vars(v: Record<string, string | number>): React.CSSProperties {
  return v as React.CSSProperties
}

/** How long a name takes to write, in milliseconds, when the folder is being read faster or
 *  slower than a person can follow. The floor keeps the caret from being a flicker; the ceiling
 *  keeps a slow disk from spelling one name out for a second and a half. Between them the pace is
 *  the machine's own, which is the point of driving this off the work instead of a schedule. */
const MIN_WRITE = 55
const MAX_WRITE = 260

/** And how long the column may take to travel a row. It follows the line that pushed it, so that
 *  the scroll keeps the writing's pace -- but a slow line must not leave the panel sliding after
 *  the next name has started. */
const MAX_SLIDE = 150

/** How many names the read puts up. A share of the folder rather than a count: a name goes up
 *  every `total / NAMES` files, so the stream starts with the first file, ends with the last,
 *  and lasts exactly as long as the reading does -- whether that is a tenth of a second or a
 *  minute. Nothing is truncated, because nothing was promising to list them all. */
const NAMES = 24

/** How often the count is allowed to repaint. Sixty is four or five times a second, which reads
 *  as continuous, and it is the yield as much as the paint: the walk hands the frame back here,
 *  and this is the only reason the page can move while it works. */
const PAINT = 60

/** And how often the figure in the header is allowed to change, which is a slower beat than the
 *  panel's on purpose. The digits do not jump to a new number, they roll to it over a few
 *  hundred milliseconds -- so a fresh number every 60ms lands on a roll that is still going,
 *  restarts it, and the figure spends the whole read blurred without ever arriving anywhere.
 *  At 160 each value gets most of its roll before the next one, which reads as counting rather
 *  than as thrashing. The panel keeps its own faster beat: names and counts are text, and text
 *  is not mid-animation when it is replaced. */
const TALLY = 160

/** One line of the panel: a name, and how long it should take to write itself. */
interface Line {
  key: string
  name: string
  ms: number
}

/** How far the read has got, as the panel shows it. */
interface Run {
  /** The pick this belongs to, so a second folder starts a fresh column. */
  id: number
  done: number
  total: number
  /** The names put up so far, oldest first. */
  lines: Line[]
}

/** The transcripts, written out as they are read.
 *
 *  Nothing here is on a schedule. A line goes up when a file has actually been read, and it is
 *  written in the time that file took -- so the panel runs at the speed of the disk and the parse,
 *  and it is still going when they are. One line at a time and one caret, because two names being
 *  written at once is two machines reading one folder.
 *
 *  The panel follows the writing rather than holding still while it runs off the bottom: the
 *  column is translated up a row per line and transitions between the two, which is a composited
 *  transform for the same reason the typing is one. The cursor on the line under the last name is
 *  what says the machine has not stopped -- a prompt, which is what this whole panel is. */
function Reading({ run }: { run: Run }): React.JSX.Element {
  /* The prompt is a row like any other, so it counts: what the panel shows is the tail of the
     column with the cursor on the bottom line. */
  const roll = Math.max(0, run.lines.length + 1 - SHOWN)
  const width = String(run.total).length
  return (
    <>
      {/* The verb stands where "The folder is hidden" stood, in the same mono caps on the same
          line, and there is only one of it now: reading and pricing are one walk, so a label
          that changed halfway would be describing two things that are not two. The count beside
          it is not announced: it changes hundreds of times, and a live region that says every
          one of them is a live region nobody can use. */}
      <div className="foundhead">
        <span className="foundlbl">Reading</span>
        {/* Padded rather than left to grow, so a count on its way to three digits does not shunt
            the line about underneath itself. `white-space: pre` is what keeps the padding. */}
        <span className="foundnum">
          {`${String(run.done).padStart(width, " ")} / ${run.total}`}
        </span>
      </div>
      {/* Keyed on the pick, so a second folder starts a fresh column rather than sliding the last
          one's names out of the way. */}
      <div className="foundbox">
        <div className="filelist">
          <div
            className="fileroll"
            key={run.id}
            style={{
              transform: `translateY(calc(var(--file-row) * -${roll}))`,
              /* The column travels in the time the line that pushed it took to arrive, so the
                 scroll and the writing keep the same pace whatever that pace turns out to be. */
              transitionDuration: `${Math.min(run.lines.at(-1)?.ms ?? MIN_WRITE, MAX_SLIDE)}ms`,
            }}
          >
            {run.lines.map((line) => (
              <div key={line.key} className="fileline">
                <span className="filedot" />
                <span className="filenm">
                  {line.name}
                  <span
                    className="filecover"
                    style={{
                      animationDuration: `${line.ms}ms`,
                      /* Characters rather than `length`: a name is text, and text is not code
                         units. One step per character is what makes this typing. */
                      animationTimingFunction: `steps(${[...line.name].length})`,
                    }}
                  />
                </span>
              </div>
            ))}
            <div className="fileline">
              <span className="filewait" />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export function Intake({
  onData,
  onTally,
}: {
  onData: (data: Analysis) => void
  /** The bill so far, handed up on the beat the panel repaints, for the figure in the header
   *  to count towards. It starts moving on the first file and stops on the last, because the
   *  total is the one number the walk never had to wait for a constant to know. */
  onTally: (usd: number) => void
}): React.JSX.Element {
  const [err, setErr] = useState<ReactNode>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [os, setOs] = useState<Os>(guessOs)
  const dirPicker = useRef<HTMLInputElement>(null)
  const picks = useRef(0)

  /** Stop, with something to say. The list goes back down and the way into the folder comes back
   *  up with it: every one of these ends with the reader picking again, and what a reader who has
   *  to pick again needs is the route, not the names of the files that were wrong.
   *
   *  The list is not thrown away, only hidden -- it is mid-flight when this is called, and a face
   *  emptied on the frame it starts leaving has nothing left to animate. */
  const stop = (node: ReactNode): void => {
    setBusy(false)
    setErr(node)
  }

  /** Pressing the button. The good road first, the input behind it -- and the fall back happens
   *  on the failure rather than on a guess about which browser this is, because the thing that
   *  decides it is not the browser at all: the same Chrome that has the picker refuses it on a
   *  `file://` page. */
  async function choose(): Promise<void> {
    if (typeof showDirectoryPicker === "function") {
      try {
        const picked = await pickFolder()
        if (picked) await handle(picked)
        return
      } catch (e) {
        /* Closing the dialog is not a failure and gets no message -- the same silence a
           cancelled file input leaves. `AbortError` is also what a folder the browser judges
           too sensitive comes back as, and it says so itself before it gets here. */
        if ((e as DOMException).name === "AbortError") return
      }
    }
    dirPicker.current?.click()
  }

  async function handle(picked: Picked[]): Promise<void> {
    const files = picked.filter((p) => p.file.name.endsWith(".jsonl"))
    /* Judged before anything is read, and kept for whatever has to be said afterwards: the two
       ways this can come to nothing are both questions about the folder, and the folder is
       standing right here. */
    const where = originOf(picked.map((p) => p.path))
    if (!files.length) {
      stop(
        !picked.length ? (
          "No files selected."
        ) : where.root ? (
          <>
            <b>{where.root}</b> holds no <code>.jsonl</code> transcripts. Claude Code writes one per
            session, under <code>~/.claude/projects</code>.
          </>
        ) : (
          <>
            None of those {picked.length} file(s) are <code>.jsonl</code> transcripts.
          </>
        ),
      )
      return
    }

    /* The pick answers the note, so the note goes: what stands in its place is the folder being
       read, a name at a time. */
    setErr(null)
    const id = ++picks.current
    /* Empty, and up before a byte has been read: the panel is the answer to the pick, and the
       first file is not always quick. A prompt blinking over nothing read yet is the truth. */
    setRun({ id, done: 0, total: files.length, lines: [] })
    /* Back to zero with the panel, not with the first priced file: a second pick has to start
       its count where the first one started, or the figure would appear to carry over. */
    onTally(0)
    setBusy(true)

    /* The walk is driven from here rather than handed the corpus, which is the whole shape of
       this: `walkOne` takes one file at a time, so the page holds one transcript instead of the
       whole folder, and gets the frame back between them. That is what makes the panel able to
       say something true -- the count is files actually finished, and a name goes up because a
       file was actually read.

       One walk, not two. The engine used to calibrate on a first pass and price on a second,
       which meant every transcript was read off the disk and parsed twice while the figure in
       the header had nothing to show for the first half of it. The bill needs no calibration --
       see `billedSoFar` -- so it is exact from the first file, and what the second pass was for
       is now a beat at the end that walks nothing. */
    const lines: Line[] = []
    const every = Math.max(1, Math.ceil(files.length / NAMES))
    let wrote = performance.now()
    let painted = 0
    let counted = 0

    /** One file done. Puts a name up when this is one of the files whose turn it is, repaints if
     *  it has been long enough, and hands the frame back when it does. */
    const step = async (i: number, total: number, name: string, tally: number): Promise<void> => {
      const now = performance.now()
      const last = i + 1 >= total
      if (i % every === 0 || last) {
        lines.push({
          key: `f${i}`,
          name,
          /* Written in the time it took to get here, so the caret runs at the speed of the work.
             Clamped at both ends: a folder on a fast disk would be a flicker, a slow one would
             spell one name out for a second and a half. */
          ms: Math.min(Math.max(now - wrote, MIN_WRITE), MAX_WRITE),
        })
        wrote = now
      }
      if (now - painted < PAINT && !last) return
      painted = now
      setRun({ id, done: i + 1, total, lines: [...lines] })
      /* And the figure on its own, slower beat -- see `TALLY`. It rides the panel's repaints
         rather than opening a gap of its own, so the header changes on a frame the page was
         already giving up. The last file reports whatever it has whether or not the beat is
         due: the number the roll finishes on is the number the bill opens with. */
      if (now - counted >= TALLY || last) {
        counted = now
        onTally(tally)
      }
      // The yield. Everything the panel does, it does in the gaps this leaves.
      await new Promise((r) => setTimeout(r, 0))
    }

    /* oxlint-disable no-await-in-loop -- awaiting each file in turn is the point of the loop
       rather than an oversight in it. `Promise.all` over the reads is what this replaced: it
       resolves with every transcript in the folder held at once, which for a real store is a few
       hundred megabytes of string and twice that in memory, and it hands the page a single
       uninterruptible block of work at the end. One at a time costs wall-clock and buys back the
       memory and the frame. A block rather than a line comment, since which line the `await`
       lands on is the formatter's to decide. */
    const w = openWalk()
    try {
      for (const [i, p] of files.entries()) {
        walkOne(w, { name: p.file.name, text: await p.file.text() })
        await step(i, files.length, p.file.name, billedSoFar(w))
      }
    } catch (e) {
      stop(`Could not read the files: ${(e as Error).message}`)
      return
    }

    let data: Analysis, scanned: Scanned
    try {
      /* The one place the whole corpus is spoken for at once, and it walks no transcripts:
         the densities are fitted, the dispatchers are judged, and everything the read held
         back is scored against them. */
      const closed = closeWalk(w)
      scanned = closed.scanned
      data = report(scanned, closed.alloc)
    } catch (e) {
      stop(`Analysis failed: ${(e as Error).message}`)
      console.error(e)
      return
    }
    if (!data.requests) {
      /* Two different failures wearing the same face. Transcripts that are genuinely Claude
         Code's and simply have nothing billed in them are a fact about the sessions; files that
         came from somewhere else entirely are a wrong turn, and the folder's own name is the
         quickest way to show which one happened. */
      stop(
        where.claude ? (
          <>
            Read {scanned.filesUsed} transcript{scanned.filesUsed > 1 ? "s" : ""} from{" "}
            {where.root ? <b>{where.root}</b> : "that folder"}, and none of them holds a priced API
            request — nothing here has been billed.
          </>
        ) : (
          <>
            Those {scanned.filesUsed} <code>.jsonl</code> file{scanned.filesUsed > 1 ? "s" : ""}{" "}
            hold no priced API request.{" "}
            {where.root ? (
              <>
                <b>{where.root}</b> is not
              </>
            ) : (
              "They did not come from"
            )}{" "}
            <code>~/.claude/projects</code>, which is where Claude Code keeps its transcripts.
          </>
        ),
      )
      return
    }
    /* oxlint-enable no-await-in-loop */
    /* Handed over only once the walk is done and scored, so the card's turn plays against a free main
       thread rather than against the tail of the work. */
    onData(data)
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setOver(false)
    const items = e.dataTransfer?.items
    if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
      const out: Picked[] = []
      const entries = [...items]
        .map((i) => i.webkitGetAsEntry())
        .filter((x): x is FileSystemEntry => !!x)
      await Promise.all(entries.map((entry) => walkEntry(entry, out)))
      await handle(out)
    } else {
      // Loose files, and no folder above them to name: the path is the file.
      await handle([...(e.dataTransfer?.files ?? [])].map((f) => ({ file: f, path: f.name })))
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
      {/* Two bands: the invitation on the line the report's picture takes, the privacy note on the
          rule that closes the card.

          There were three. The lede stood on the strip's line at the top, which mirrored the
          report's own three bands and read, on the empty face, as an orphan: a centred sentence
          under a left-aligned title, then a hundred pixels of nothing before the thing it was
          introducing. It belongs to the ask, so it now stands with it. */}
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
        {/* What pressing the button gets you, in one line, and it took five tries to get down to
            one. It was the method first -- per-request billing, re-billed context, the definition
            of carry cost -- which is the right paragraph in the wrong place: it argued for numbers
            to a reader who had not seen any. Then it was a promise and a row of three things you
            get, one of which ("by project, by session") the engine does not do: nothing here
            groups by project, and sessions are counted rather than broken out. Then it opened
            "Drop the folder in and", which is what the heading directly above it now says. Then it
            spent its first three words on grammar -- "The bill comes back…" -- before saying
            anything at all.
            What is left is a verb, the thing, and the three sizes the report actually resolves to.
            One line that fits on one line: a subtitle that wraps is a paragraph. */}
        <p className="lede">Chart your bill: every tool, every subcommand, every dollar.</p>
        <div className="picks">
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              void choose()
            }}
          >
            <FolderMark />
            Choose folder
          </button>
        </div>
        {/* And the way in, in the card rather than under it. This used to stand in the help below
            the fold, which assumed the reader would go looking: `.claude` is a dotfile, so the
            picker they are about to open hides the folder this page just asked for, and a reader
            who cannot get there never sees a report at all. It is one line because only one
            platform's line applies -- theirs is picked for them, and the switch is for when the
            guess is wrong. */}
        {/* One box, two faces, and only ever one of them on show. The pair is stacked in a single
            grid cell rather than swapped in and out of the flow: they have to cross -- one leaving
            upward as the other arrives from below -- and two things that take turns in the flow
            cannot cross, they shove. What does move is the box's height, which grows into the
            taller job as they pass. See `.swap`. */}
        <div
          className="swap"
          data-face={busy ? "files" : "how"}
          /* How tall the panel is, in rows, handed to the stylesheet as the number the markup
             already had to count in. See `SHOWN`. */
          style={vars({ "--file-rows": SHOWN })}
        >
          <div className="howto" data-on={busy ? "0" : "1"}>
            {/* Two rows, rather than one row of label, sentence and switch run together: the switch
                decides *which* instruction is drawn, so it belongs above the line it governs, not
                inline with it where it reads as the end of the sentence.

                No box around it any more. Sunk panel, hairline, rule between the rows -- three
                pieces of chrome for two lines of help, sitting inside a card that is itself a
                frame, which made the way in look like a second thing to decide about rather than
                the answer to the heading above it. What separates it now is the space around it.

                No path in the label: it is set in mono caps, which would print a dotfile's name
                as `.CLAUDE`, and the path is already the loudest thing in the heading above. Why
                the folder is hidden is in the help below the card; what a reader stuck at a
                dialog needs is the keystrokes. */}
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
          {/* The other face. Mounted from the first pick onward rather than only while the work
              runs, because a face that is unmounted the moment it stops being current has nothing
              left on screen to play its exit -- `data-on` is what shows it, `data-busy` what makes
              it look busy. */}
          {run ? (
            <div className="found" data-on={busy ? "1" : "0"} data-busy={busy ? "1" : "0"}>
              <Reading run={run} />
            </div>
          ) : null}
        </div>
        {/* Errors only, now that the progress is narrated by the list's own head -- which is why
            this line is set in the accent throughout rather than colouring itself in when
            something goes wrong. It keeps its ground either way: an empty line here is what stops
            the group jumping when a pick comes back with something to say. */}
        <div className="status">{err}</div>
      </div>
      <input
        ref={dirPicker}
        type="file"
        multiple
        webkitdirectory=""
        directory=""
        className="hidden"
        onChange={(e) => {
          /* `webkitRelativePath` is what a folder pick adds over a file pick, and it is the whole
             reason the page can tell `projects` from `Downloads` without asking. */
          void handle(
            [...(e.target.files ?? [])].map((f) => ({
              file: f,
              path: f.webkitRelativePath || f.name,
            })),
          )
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
