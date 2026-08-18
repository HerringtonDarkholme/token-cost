/* The card's empty face: take files from a picker or a drop, read them in the page, hand them to
   the engine. */

import { useId, useRef, useState, type ReactNode } from "react"
import {
  billedSoFar,
  closeWalk,
  openWalk,
  report,
  skipFile,
  walkOne,
  type Analysis,
  type Scanned,
} from "./engine.ts"
import { useT, type Dict, type Os } from "./copy.tsx"
import { TextSwap } from "./Motion.tsx"
import { sampleFiles } from "./sample.ts"
import { Tip } from "./Tip.tsx"

/* The three platforms, each a mark and a word. */
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
 *  eyes, beak, feet, and nothing else, because every further line closes up at this size. */
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

/* The three names are not translated, because they are not words: macOS, Windows and Linux are
   what the platforms call themselves in every language the page speaks. */
const PLATFORMS: ReadonlyArray<{ value: Os; label: string; mark: React.JSX.Element }> = [
  { value: "mac", label: "macOS", mark: <AppleMark /> },
  { value: "win", label: "Windows", mark: <WindowsMark /> },
  { value: "linux", label: "Linux", mark: <TuxMark /> },
]

/** A folder, on the button that opens a folder picker. */
function FolderMark(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M1.9 12.7V3.5h4.2l1.5 1.9h6.5v7.3a.6.6 0 0 1-.6.6H2.5a.6.6 0 0 1-.6-.6Z" />
      <path d="M1.9 7.3h12.2" />
    </svg>
  )
}

/** Three columns of the mosaic, on the button that opens one nobody has to own a folder to see. */
function SampleMark(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.7" y="6.4" width="4" height="7.9" />
      <rect x="6.9" y="3.4" width="3" height="10.9" />
      <rect x="11.1" y="8.9" width="3.2" height="5.4" />
    </svg>
  )
}

/** The one platform, and the way to the next. */
function OsSwitch({ os, onPick }: { os: Os; onPick: (v: Os) => void }): React.JSX.Element {
  const tip = useId()
  const t = useT()
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
      <Tip id={tip}>{t.intake.osTip(PLATFORMS[at].label, next.label)}</Tip>
    </span>
  )
}

/** Which dialog the reader is about to meet. */
function guessOs(): Os {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent
  if (/Mac|iPhone|iPad/.test(ua)) return "mac"
  if (/Win/.test(ua)) return "win"
  return "linux"
}

/** A reader who is probably not at the machine they run Claude Code on. Touch as the *only*
 *  pointer is what says phone or tablet rather than a laptop with a touchscreen -- a guess about
 *  the device, which is all the page has: it cannot see whether a `~/.claude` is there. Taken
 *  once, because pointer hardware does not change under a reader the way an orientation does. */
const HANDHELD: boolean =
  typeof matchMedia === "function" &&
  matchMedia("(pointer: coarse)").matches &&
  !matchMedia("(any-hover: hover)").matches

/** A file, and where it sat inside the folder that was chosen. */
interface Picked {
  file: File
  /** Relative to the chosen folder, that folder's own name first. */
  path: string
  /** Kept for the retry below, and absent on the drop and the input, which hand over no handle. */
  handle?: FileSystemFileHandle
}

/** Claude Code names a project's folder after the directory it ran in, separators and all
 *  flattened to dashes: `-Users-me-code-thing` on a mac or a Linux box, `C--Users-me-code-thing`
 *  on Windows. */
const PROJECT_DIR = /^-|^[A-Za-z]--/

/** Where a pick came from, as far as its paths can say. */
export interface Origin {
  /** The chosen folder's own name, or `null` for loose files and for several folders at once. */
  root: string | null
  /** Whether it is `~/.claude/projects`, or one project's folder out of it. */
  claude: boolean
}

/** Judge the pick from the paths alone, so the page never has to ask the reader where they just
 *  were. */
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
 *  `getFile()` is asked for every leaf rather than only the `.jsonl` ones, and that is not
 *  waste: it hands back a lazy handle, not the bytes, and it is what lets the count of *what was
 *  in the folder* survive down to the message that has to say the folder held no transcripts. */
async function walkDir(dir: FileSystemDirectoryHandle, at: string, out: Picked[]): Promise<void> {
  for await (const kid of dir.values()) {
    const path = `${at}/${kid.name}`
    if (kid.kind === "directory") await walkDir(kid, path, out)
    else out.push({ file: await kid.getFile(), path, handle: kid })
  }
}

/** The folder picker that does not say "upload". */
async function pickFolder(): Promise<Picked[] | null> {
  const dir = await showDirectoryPicker({ id: "claude-projects", mode: "read" })
  const out: Picked[] = []
  await walkDir(dir, dir.name, out)
  return out
}

/** Walk a dropped folder. */
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

/** How many rows the panel shows at once. */
const SHOWN = 7

/** A custom property, on its way to the stylesheet. */
function vars(v: Record<string, string | number>): React.CSSProperties {
  return v as React.CSSProperties
}

/** How long a name takes to write, in milliseconds, when the folder is being read faster or
 *  slower than a person can follow. */
const MIN_WRITE = 55
const MAX_WRITE = 260

/** And how long the column may take to travel a row. */
const MAX_SLIDE = 150

/** How many names the read puts up. */
const NAMES = 24

/** How often the count is allowed to repaint. */
const PAINT = 60

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

/** The transcripts, written out as they are read. */
function Reading({ run, t }: { run: Run; t: Dict }): React.JSX.Element {
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
        <span className="foundlbl">{t.intake.reading}</span>
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
                         units. */
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

/** One transcript, however it is going to be produced: a file off the disk, or a line of the
 *  example built on demand. The walk below reads them strictly one at a time, so neither kind is
 *  ever held in full. */
export interface Source {
  name: string
  read: () => Promise<string>
}

/** A `File` is a snapshot, and Chrome rejects the read with `NotReadableError` if the transcript
 *  grew under it, so the retry takes a fresh one. */
export function readPicked(p: Picked): Promise<string> {
  return p.file.text().catch((e: unknown) => {
    if (!p.handle || (e as DOMException).name !== "NotReadableError") throw e
    return p.handle.getFile().then((f) => f.text())
  })
}

/** The corpus one transcript at a time, `null` for the ones that would not read: a store is a
 *  live directory, so stopping at the first bad file threw away everything already priced. */
export async function readEach(
  files: readonly Source[],
  onFile: (name: string, text: string | null, i: number) => Promise<void> | void,
): Promise<{ skipped: number; firstErr: Error | null }> {
  /* One read runs ahead of the walk, and only one: reading a transcript is the disk's work and
     walking it is this thread's, and done strictly in turn each waits out the other. The empty
     `catch` marks the read as handled so a failure mid-corpus is not also an unhandled
     rejection -- the `await` below still throws it. */
  const readAt = (i: number): Promise<string> | null => {
    if (i >= files.length) return null
    const p = files[i].read()
    p.catch(() => {})
    return p
  }
  let ahead = readAt(0)
  let skipped = 0
  let firstErr: Error | null = null
  /* oxlint-disable no-await-in-loop -- awaiting each file in turn is the point of the loop rather
     than an oversight in it. `Promise.all` over the reads holds the whole folder at once, which
     for a real store is a few hundred megabytes of string and twice that in memory. */
  for (const [i, p] of files.entries()) {
    let text: string | null = null
    try {
      text = await ahead!
    } catch (e) {
      skipped++
      firstErr ??= e as Error
    }
    ahead = readAt(i + 1)
    await onFile(p.name, text, i)
  }
  /* oxlint-enable no-await-in-loop */
  return { skipped, firstErr }
}

export function Intake({
  onData,
  sofar,
}: {
  onData: (data: Analysis, sample: boolean) => void
  /** Where to leave the bill as it stands, for the figure in the header to count towards. */
  sofar: React.RefObject<number>
}): React.JSX.Element {
  const [err, setErr] = useState<ReactNode>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [os, setOs] = useState<Os>(guessOs)
  const t = useT()
  const dirPicker = useRef<HTMLInputElement>(null)
  const picks = useRef(0)

  /** Stop, with something to say. */
  const stop = (node: ReactNode): void => {
    setBusy(false)
    setErr(node)
  }

  /** Pressing the button. */
  async function choose(): Promise<void> {
    if (typeof showDirectoryPicker === "function") {
      try {
        const picked = await pickFolder()
        if (picked) await handle(picked)
        return
      } catch (e) {
        /* Closing the dialog is not a failure and gets no message -- the same silence a
           cancelled file input leaves. */
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
        !picked.length
          ? t.intake.errNothing
          : where.root
            ? t.intake.errNoJsonl(<b>{where.root}</b>)
            : t.intake.errLoose(picked.length),
      )
      return
    }
    await walkFiles(
      files.map((p) => ({ name: p.file.name, read: () => readPicked(p) })),
      where,
      false,
    )
  }

  /** The example, walked down the same path a folder takes -- same reading column, same engine,
   *  same turn of the card -- because a demo that took a shortcut would be demonstrating the
   *  shortcut. */
  async function example(): Promise<void> {
    await walkFiles(
      sampleFiles().map((f) => ({ name: f.name, read: () => Promise.resolve(f.build()) })),
      { root: null, claude: true },
      true,
    )
  }

  async function walkFiles(files: Source[], where: Origin, sample: boolean): Promise<void> {
    /* The pick answers the note, so the note goes: what stands in its place is the folder being
       read, a name at a time. */
    setErr(null)
    const id = ++picks.current
    /* Empty, and up before a byte has been read: the panel is the answer to the pick, and the
       first file is not always quick. */
    setRun({ id, done: 0, total: files.length, lines: [] })
    /* Back to zero with the panel, not with the first priced file: a second pick has to start
       its count where the first one started, or the figure would appear to carry over. */
    sofar.current = 0
    setBusy(true)

    /* The walk is driven from here rather than handed the corpus, which is the whole shape of
       this: `walkOne` takes one file at a time, so the page holds one transcript instead of the
       whole folder, and gets the frame back between them. */
    const lines: Line[] = []
    const every = Math.max(1, Math.ceil(files.length / NAMES))
    let wrote = performance.now()
    let painted = 0

    /** One file done. */
    const step = async (i: number, total: number, name: string): Promise<void> => {
      const now = performance.now()
      const last = i + 1 >= total
      if (i % every === 0 || last) {
        lines.push({
          key: `f${i}`,
          name,
          /* Written in the time it took to get here, so the caret runs at the speed of the work. */
          ms: Math.min(Math.max(now - wrote, MIN_WRITE), MAX_WRITE),
        })
        wrote = now
      }
      if (now - painted < PAINT && !last) return
      painted = now
      setRun({ id, done: i + 1, total, lines: [...lines] })
      // The yield.
      await new Promise((r) => setTimeout(r, 0))
    }

    const w = openWalk()
    const { skipped, firstErr } = await readEach(files, (name, text, i) => {
      if (text !== null) {
        walkOne(w, { name, text })
        /* Left where the header can find it, on every file rather than on a beat: this is two
           adds and a multiply, and deciding how often it is worth looking at is the job of
           whoever is drawing it. */
        sofar.current = billedSoFar(w)
      } else skipFile(w)
      return step(i, files.length, name)
    })
    if (firstErr && skipped === files.length) {
      stop(t.intake.errRead(firstErr.message))
      return
    }

    let data: Analysis, scanned: Scanned
    try {
      /* The one place the whole corpus is spoken for at once, and it walks no transcripts: the
         densities are fitted, the dispatchers are judged, and everything the read held back is
         scored against them. */
      const closed = closeWalk(w)
      scanned = closed.scanned
      data = report(scanned, closed.alloc)
    } catch (e) {
      stop(t.intake.errAnalysis((e as Error).message))
      console.error(e)
      return
    }
    if (!data.requests) {
      /* Two different failures wearing the same face. */
      const root = where.root ? <b>{where.root}</b> : null
      stop(
        where.claude
          ? t.intake.errNoneBilled(scanned.filesUsed, root)
          : t.intake.errNotClaude(scanned.filesUsed, root),
      )
      return
    }
    /* Handed over only once the walk is done and scored, so the card's turn plays against a free
       main thread rather than against the tail of the work. */
    onData(data, sample)
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

  /* Which of the two carries the weight is the device's answer, so both are written once and the
     order and the emphasis are decided below. */
  const folderBtn = (
    <button
      key="folder"
      className={HANDHELD ? "btn" : "btn primary"}
      type="button"
      disabled={busy}
      onClick={() => {
        void choose()
      }}
    >
      <FolderMark />
      {t.intake.choose}
    </button>
  )
  const exampleBtn = (
    <button
      key="example"
      className={HANDHELD ? "btn primary" : "btn"}
      type="button"
      disabled={busy}
      onClick={() => {
        void example()
      }}
    >
      <SampleMark />
      {t.intake.example}
    </button>
  )

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
        {/* Where a folder is unlikely to be droppable, the heading names the page instead of asking
            for something the reader cannot hand over -- being sent to a desktop is only worth
            reading once you know what is waiting there, and that note is at the foot of the
            card. */}
        <h2>
          {HANDHELD ? t.intake.headingTouch : t.intake.heading(<code>~/.claude/projects</code>)}
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
        <p className="lede">{HANDHELD ? t.intake.ledeTouch : t.intake.lede}</p>
        {/* Two ways in rather than one. The folder is the real one and keeps the weight, but it
            is only open to a reader sitting at the machine Claude Code runs on -- on a phone
            there is no `~/.claude` to point at, and the page as it stood had nothing to show
            them at all. The example is the same report drawn from invented transcripts. */}
        <div className="picks">{HANDHELD ? [exampleBtn, folderBtn] : [folderBtn, exampleBtn]}</div>
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
             already had to count in. */
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
            {/* On a phone the same slot says where the reader's own transcripts are instead:
                keystrokes for a file dialog are no use until they are at the machine. */}
            <div className="howhead">
              <span className="howlbl">{HANDHELD ? t.intake.yours : t.intake.hidden}</span>
              {HANDHELD ? null : <OsSwitch os={os} onPick={setOs} />}
            </div>
            {/* Keyed on the platform, so switching plays the same swap the report's figures do
                rather than substituting the words underneath the reader. Inside the paragraph
                rather than around it: `TextSwap` is a span, and a span may not hold a `<p>`. */}
            <p>
              {HANDHELD ? t.intake.yoursBody : <TextSwap token={os}>{t.intake.how[os]}</TextSwap>}
            </p>
          </div>
          {/* The other face. Mounted from the first pick onward rather than only while the work
              runs, because a face that is unmounted the moment it stops being current has nothing
              left on screen to play its exit -- `data-on` is what shows it, `data-busy` what makes
              it look busy. */}
          {run ? (
            <div className="found" data-on={busy ? "1" : "0"} data-busy={busy ? "1" : "0"}>
              <Reading run={run} t={t} />
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
          /* `webkitRelativePath` is what a folder pick adds over a file pick, and it is the
             whole reason the page can tell `projects` from `Downloads` without asking. */
          void handle(
            [...(e.target.files ?? [])].map((f) => ({
              file: f,
              path: f.webkitRelativePath || f.name,
            })),
          )
        }}
      />
      <p className="privacy">{t.intake.privacy}</p>
    </div>
  )
}

/** The help that stands under the empty card, where the breakdown and the footnotes stand under
 *  a full one -- so it holds the same ground: two columns on the same rule, across the width of
 *  the shell. */
export function Where(): React.JSX.Element {
  const t = useT()
  return (
    <div className="where">
      <div>
        <p className="whead">
          <strong>{t.where.handingOver}</strong>
        </p>
        <p>{t.where.handingOverBody}</p>
        <p className="whead">
          <strong>{t.where.terminal}</strong>
        </p>
        <p>{t.where.terminalBody}</p>
      </div>
      <div>
        <p className="whead">
          <strong>{t.where.noUpload}</strong>
        </p>
        <p>{t.where.noUploadBody}</p>
        <p className="whead">
          <strong>{t.where.linkTitle}</strong>
        </p>
        <p>{t.where.linkBody}</p>
      </div>
    </div>
  )
}
