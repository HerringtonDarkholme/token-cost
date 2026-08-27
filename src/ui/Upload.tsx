/* The card's empty face: files from a picker or a drop, read here, handed to the engine. */

import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  billedSoFar,
  closeWalk,
  endText,
  openFile,
  openWalk,
  pushText,
  report,
  skipFile,
  stepFile,
  type Analysis,
  type Scanned,
} from "../core/engine.ts"
import { AGENT_FOLDERS, SIDECAR_NAMES, type Folder } from "../core/agents/index.ts"
import { useT, type Dict, type Os } from "./copy.tsx"
import { TextSwap, useReduced, WordCycle, type Slot } from "./Motion.tsx"
import { sampleFiles } from "../core/sample.ts"
import { Tip } from "./Tip.tsx"

/** One agent's mark, in that agent's colour where it has one and at its own optical size. */
function Mark({ paths, scale }: { paths: readonly string[]; scale?: number }): React.JSX.Element {
  return (
    <svg
      className="mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={scale ? ({ "--mark-scale": scale } as React.CSSProperties) : undefined}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/* The folder each agent keeps, under the mark of whoever fills it, with that vendor's own word in
   that vendor's own colour. */
const ASKS: readonly Slot[] = AGENT_FOLDERS.map((f) => ({
  word: f.name,
  body: (
    <code data-brand={f.brand}>
      <Mark paths={f.mark} scale={f.markScale} />
      {f.head}
      <span className="brand">{f.brand}</span>
      {f.tail}
    </code>
  ),
}))

/* The folder as this reader would have to type it into a dialog, which is the one place the
   Windows spelling of a home directory is what they see. */
function typed(f: Folder, os: Os): string {
  const path = (f.head + f.brand + f.tail).replace(/\/$/, "")
  return os === "win" ? `%USERPROFILE%\\${path.slice(2).replaceAll("/", "\\")}` : path
}

/* Which folder the heading has up, read here rather than passed: `TextSwap` holds the sentence it
   was handed until its own token changes, so an element inside it never sees a new prop. */
const Face = createContext(0)

/* The same folder the heading is asking for, so the keystrokes and the ask never name two
   different agents. A reader who has asked for stillness gets no cycle to follow, so they get the
   list the heading gives them. */
function Ask({ os, still }: { os: Os; still: boolean }): React.JSX.Element {
  const t = useT()
  const at = useContext(Face)
  const said = (f: Folder): React.ReactNode => t.intake.pair(<code>{typed(f, os)}</code>, f.name)
  if (still) {
    return (
      <>
        {AGENT_FOLDERS.map((f, i) => (
          <Fragment key={f.name}>
            {i ? ", " : ""}
            {said(f)}
          </Fragment>
        ))}
      </>
    )
  }
  const f = AGENT_FOLDERS[at] ?? AGENT_FOLDERS[0]
  return <TextSwap token={f.name}>{said(f)}</TextSwap>
}

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

/** A penguin, drawn rather than traced: every further line closes up at this size. */
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

/* Not translated: macOS, Windows and Linux are what the platforms call themselves everywhere. */
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
  /* `t-tt-host` carries the hint's placement, which is a question of room -- see `.howto .t-tt`. */
  return (
    <span className="t-tt-host">
      <button
        type="button"
        className="osbtn t-tt-trigger"
        aria-describedby={tip}
        onClick={() => onPick(next.value)}
      >
        {/* Mark and word swap as one face: a logo changing a beat before its name reads as two
            controls. */}
        <span className="osname">
          <TextSwap token={os}>
            <span className="osface">
              {PLATFORMS[at].mark}
              {PLATFORMS[at].label}
            </span>
          </TextSwap>
        </span>
        {/* A chevron is what says "there are others behind this". */}
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

/** A reader probably not at the machine they run Claude Code on: touch as the *only* pointer
 *  says phone rather than a laptop with a touchscreen. */
const HANDHELD: boolean =
  typeof matchMedia === "function" &&
  matchMedia("(pointer: coarse)").matches &&
  !matchMedia("(any-hover: hover)").matches

/** A file, and where it sat inside the folder that was chosen. */
interface Picked {
  file: File
  /** Relative to the chosen folder, that folder's own name first. */
  path: string
  /** What the read takes its bytes from, and absent on the file input, which hands over none. */
  handle?: FileSystemFileHandle
}

/** Claude Code flattens a project's directory to dashes: `-Users-me-code-thing`, or
 *  `C--Users-me-code-thing` on Windows. */
const PROJECT_DIR = /^-|^[A-Za-z]--/

/** Codex keeps rolls in dated folders under `~/.codex/sessions`, so the folder above or the
 *  file's own name identifies the store. */
const CODEX_DIR = /^(sessions|archived_sessions)$/
const ROLLOUT = /^rollout-/

/** Which store a pick came out of. */
export type Store = "claude" | "codex" | "grok" | null

/** Where a pick came from, as far as its paths can say. */
export interface Origin {
  /** The chosen folder's own name, or `null` for loose files and for several folders at once. */
  root: string | null
  /** `~/.claude/projects` or one project's folder out of it, `~/.codex/sessions`,
   *  `~/.grok/sessions`, or none of those. */
  store: Store
}

/** Which folder of the ask this pick came out of, since the store its paths name is that folder's
 *  own word -- `null` for a pick that named none. */
export function folderAt(store: Store): number | null {
  const at = AGENT_FOLDERS.findIndex((f) => f.brand === store)
  return at < 0 ? null : at
}

/** Judge the pick from the paths alone, so the page never asks the reader where they just were. */
export function originOf(paths: readonly string[]): Origin {
  const roots = new Set(paths.map((p) => (p.includes("/") ? p.slice(0, p.indexOf("/")) : "")))
  const claude = paths.some((p) => {
    const segs = p.split("/").slice(0, -1)
    return segs.some(
      (s, i) => (s === ".claude" && segs[i + 1] === "projects") || PROJECT_DIR.test(s),
    )
  })
  const codex = paths.some((p) => {
    const segs = p.split("/")
    if (ROLLOUT.test(segs[segs.length - 1])) return true
    const dirs = segs.slice(0, -1)
    return dirs.some((s, i) => s === ".codex" && CODEX_DIR.test(dirs[i + 1] || ""))
  })
  const grok = paths.some((p) => {
    const segs = p.split("/")
    if (segs[segs.length - 1] === "updates.jsonl") return true
    const dirs = segs.slice(0, -1)
    return dirs.some((s, i) => s === ".grok" && dirs[i + 1] === "sessions")
  })
  /* A pick holding more than one store is named by the page's own: the message it feeds only has
     to name somewhere the reader has heard of. */
  const store: Store = claude ? "claude" : codex ? "codex" : grok ? "grok" : null
  return { root: roots.size === 1 && !roots.has("") ? [...roots][0] : null, store }
}

/** Walk a picked folder depth-first, because a transcript sits two levels down at
 *  `projects/<project>/<session>.jsonl`. Every leaf is asked for its handle, which is lazy, so
 *  what the folder held survives to the message that says it held no transcripts. */
async function walkDir(dir: FileSystemDirectoryHandle, at: string, out: Picked[]): Promise<void> {
  for await (const kid of dir.values()) {
    const path = `${at}/${kid.name}`
    if (kid.kind === "directory") await walkDir(kid, path, out)
    else out.push({ file: await kid.getFile(), path, handle: kid })
  }
}

/** A dropped item taken as a handle rather than an entry, so a transcript carries the handle its
 *  read needs. */
export async function pickHandle(h: FileSystemHandle, out: Picked[]): Promise<void> {
  /* `kind` tells the two apart at runtime; the cast tells the type system the same. */
  if (h.kind === "directory") await walkDir(h as FileSystemDirectoryHandle, h.name, out)
  else {
    const f = h as FileSystemFileHandle
    out.push({ file: await f.getFile(), path: f.name, handle: f })
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
          /* The entry's path rather than the file's: a dropped `File` has an empty
             `webkitRelativePath`. */
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

/** How long a name takes to write, in milliseconds, when the folder reads faster than a person
 *  can follow. */
const MIN_WRITE = 55
const MAX_WRITE = 260

/** And how long the column may take to travel a row. */
const MAX_SLIDE = 150

/** How many names the read puts up. */
const NAMES = 24

/** How often the count is allowed to repaint. */
const PAINT = 60

/** How long the walk waits for a frame before deciding none is coming. */
const UNDRAWN = 60

/** Hand the thread back until the next frame, which is what the walk is sharing it with:
 *  `scheduler.yield` starves the interval the header's figure is sampled on, and `setTimeout` is
 *  floored at 4ms once nested. Off screen no frame arrives, so the walk keeps the thread. */
function handBack(): Promise<void> {
  if (document.hidden || typeof requestAnimationFrame !== "function") return Promise.resolve()
  return new Promise<void>((r) => {
    /* oxlint-disable promise/no-multiple-resolved -- one resolver on two clocks is a race with a
       single winner, and the timer covers the frame a hidden tab will not deliver. */
    const settle = (): void => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      r()
    }
    const frame = requestAnimationFrame(settle)
    const timer = setTimeout(settle, UNDRAWN)
    /* oxlint-enable promise/no-multiple-resolved */
  })
}

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
  /* The prompt counts as a row: the panel shows the tail of the column, cursor on the bottom
     line. */
  const roll = Math.max(0, run.lines.length + 1 - SHOWN)
  const width = String(run.total).length
  return (
    <>
      {/* One verb, because reading and pricing are one walk. The count is not announced: it changes
          hundreds of times, and a live region that says every one is unusable. */}
      <div className="foundhead">
        <span className="foundlbl">{t.intake.reading}</span>
        {/* Padded rather than grown, so a third digit does not shunt the line beneath it;
            `white-space: pre` is what keeps the padding. */}
        <span className="foundnum">
          {`${String(run.done).padStart(width, " ")} / ${run.total}`}
        </span>
      </div>
      {/* Keyed on the pick, so a second folder starts a fresh column. */}
      <div className="foundbox">
        <div className="filelist">
          <div
            className="fileroll"
            key={run.id}
            style={{
              transform: `translateY(calc(var(--file-row) * -${roll}))`,
              /* The column travels in the time the line that pushed it took to arrive. */
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
                      /* Characters rather than `length`: text is not code units. */
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

/** One transcript, never as one string: a rollout can run past what a JS string holds, and
 *  Chrome answers `text()` on one of those with an empty string rather than an error. */
export interface Source {
  name: string
  /** Anything that changes when the file does; with the name, this tells one session's
   *  transcript from a longer copy of it. */
  size: number
  /** The bytes as text, a chunk at a time. */
  chunks: () => AsyncIterable<string>
}

/** The `File` beside a handle is a stale snapshot, and Chrome fails the read with
 *  `NotReadableError` if a live session appended -- so the bytes come from a fresh one. */
export function pickedFile(p: Picked): Promise<File> {
  return p.handle ? p.handle.getFile() : Promise.resolve(p.file)
}

/** One transcript as text, a chunk at a time. */
export async function* chunkPicked(p: Picked): AsyncGenerator<string> {
  const file = await pickedFile(p)
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader()
  /* oxlint-disable no-await-in-loop -- pulling the chunks in turn is the point of the loop. */
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
  /* oxlint-enable no-await-in-loop */
}

/** The corpus one transcript at a time: a store is a live directory, so one that will not read
 *  is counted rather than allowed to end the walk. */
export async function readEach(
  files: readonly Source[],
  onFile: (f: Source, i: number) => Promise<boolean>,
  /** Asked before each transcript: `false` leaves the rest unread, which is how a second pick
   *  supersedes the first. */
  alive: () => boolean = () => true,
): Promise<{ skipped: number; firstErr: Error | null }> {
  let skipped = 0
  let firstErr: Error | null = null
  /* oxlint-disable no-await-in-loop -- one transcript at a time is the point; `Promise.all` over a
     real store holds gigabytes. */
  for (const [i, f] of files.entries()) {
    if (!alive()) break
    let got = false
    try {
      got = await onFile(f, i)
    } catch (e) {
      firstErr ??= e as Error
    }
    if (!got) skipped++
  }
  /* oxlint-enable no-await-in-loop */
  return { skipped, firstErr }
}

/** Two sheets, the back one clipped: `fill: none` would show its lines through the front. */
function CopyMark(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="1.8" y="5.4" width="8.8" height="8.8" rx="1.3" />
      <path d="M5.4 5.4V3.1a1.3 1.3 0 0 1 1.3-1.3h6.2a1.3 1.3 0 0 1 1.3 1.3v6.2a1.3 1.3 0 0 1-1.3 1.3h-2.3" />
    </svg>
  )
}

/** What the button becomes for the two seconds after it is pressed. */
function TickMark(): React.JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="m2.9 8.3 3.4 3.4 6.8-7.4" />
    </svg>
  )
}

/** One place, because the button copies the string the paragraph prints. */
const CMD = "npx token-billing"

/** Copies the command, and says so for a moment. A browser with no clipboard gets nothing. */
function CopyCmd(): React.JSX.Element {
  const t = useT()
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <button
      type="button"
      className="copybtn"
      data-on={done ? 1 : 0}
      aria-label={done ? t.intake.cmdCopied : t.intake.copyCmd}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard?.writeText(CMD)
          } catch {
            /* No clipboard, or no permission: the command stays there to select by hand. */
            return
          }
          setDone(true)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setDone(false), 2000)
        })()
      }}
    >
      {/* A mark rather than a word: three of the languages spell "copied" long enough to move the
          command about. */}
      <TextSwap token={done ? "done" : "idle"}>{done ? <TickMark /> : <CopyMark />}</TextSwap>
    </button>
  )
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
  const [face, setFace] = useState(0)
  /* Which agent's folder is in hand: the ask stops cycling once there is an answer to it. */
  const [pinned, setPinned] = useState<number | null>(null)
  const still = useReduced()
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
        /* A closed dialog is not a failure, and gets the silence a cancelled file input gets. */
        if ((e as DOMException).name === "AbortError") return
      }
    }
    dirPicker.current?.click()
  }

  async function handle(picked: Picked[]): Promise<void> {
    const files = picked.filter(
      (p) => p.file.name.endsWith(".jsonl") && !SIDECAR_NAMES.has(p.file.name),
    )
    /* Judged before anything is read and kept for afterwards: both ways this comes to nothing are
       questions about the folder. */
    const where = originOf(picked.map((p) => p.path))
    /* Settled off the paths rather than off the read, so the heading names the folder whatever the
       walk goes on to make of it. */
    setPinned(folderAt(where.store))
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
      files.map((p) => ({
        name: p.file.name,
        size: p.file.size,
        chunks: () => chunkPicked(p),
      })),
      where,
      false,
    )
  }

  /** The example walked down the same path a folder takes, because a demo that took a shortcut
   *  would be demonstrating the shortcut. */
  async function example(): Promise<void> {
    /* Invented transcripts are nobody's folder, so the ask goes back to asking. */
    setPinned(null)
    await walkFiles(
      sampleFiles().map((f) => {
        /* Built at the read rather than at the pick, so the column has something to draw. */
        let text = ""
        const once = (): string => (text ||= f.build())
        return {
          name: f.name,
          get size(): number {
            return once().length
          },
          chunks: async function* (): AsyncGenerator<string> {
            yield once()
          },
        }
      }),
      { root: null, store: "claude" },
      true,
    )
  }

  async function walkFiles(files: Source[], where: Origin, sample: boolean): Promise<void> {
    /* The pick answers the note, so the note goes. */
    setErr(null)
    const id = ++picks.current
    /* Up before a byte is read: the panel is the answer to the pick. */
    setRun({ id, done: 0, total: files.length, lines: [] })
    /* Back to zero with the panel, or a second pick's figure would look like it carried over. */
    sofar.current = 0
    setBusy(true)

    /** Whether this pick is still the one the card waits on: a second can arrive mid-walk, and
     *  the first would otherwise finish over the top of it. */
    const alive = (): boolean => picks.current === id

    /* Driven from here rather than handed the corpus: one file and one slice at a time, so the page
       holds one transcript instead of the folder. */
    const lines: Line[] = []
    const every = Math.max(1, Math.ceil(files.length / NAMES))
    let wrote = performance.now()
    let painted = 0

    /** One file done. */
    const step = async (i: number, total: number, name: string): Promise<void> => {
      if (!alive()) return
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
    /* A transcript that will not read is counted inside, so the `catch` is the walk coming
       apart. */
    const read = await readEach(
      files,
      async (f, i) => {
        const fw = openFile(w, f.name, f.size)
        let got = false
        let broke: Error | null = null
        /* oxlint-disable no-await-in-loop -- the awaits are the point: the next chunk, and the
           frame the caret needs. */
        /** Walk what has arrived, giving the frame back when the walk has held it long enough.
         *  `false` once this pick has been superseded. */
        const drain = async (): Promise<boolean> => {
          const steps = stepFile(fw)
          for (;;) {
            const done = steps.next().done
            /* Left where the header can find it on every slice, so a rollout big enough to take
               several counts up through them instead of standing still. */
            sofar.current = billedSoFar(w)
            if (done) return true
            await handBack()
            if (!alive()) return false
          }
        }
        try {
          const it = f.chunks()[Symbol.asyncIterator]()
          /* One chunk in flight while the last is walked: reading is the disk's work, walking is
             this thread's. */
          let ahead = it.next()
          for (;;) {
            const next = await ahead
            if (next.done) break
            ahead = it.next()
            got = true
            pushText(fw, next.value)
            if (!(await drain())) return got
          }
        } catch (e) {
          /* A store is a live directory: a transcript that moved out from under the read leaves
             what it had already given. */
          broke = e as Error
        }
        endText(fw)
        if (!(await drain())) return got
        /* oxlint-enable no-await-in-loop */
        if (!got) {
          skipFile(w)
          if (broke) throw broke
        }
        await step(i, files.length, f.name)
        return got
      },
      alive,
    ).catch((e: unknown) => {
      if (alive()) stop(t.intake.errRead((e as Error).message))
      return null
    })
    if (!read || !alive()) return
    if (read.firstErr && read.skipped === files.length) {
      stop(t.intake.errRead(read.firstErr.message))
      return
    }

    let data: Analysis, scanned: Scanned
    try {
      /* The one place the whole corpus is spoken for at once, and it walks nothing: the
         densities are fitted, and everything the read held back is scored against them. */
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
        where.store
          ? t.intake.errNoneBilled(scanned.filesUsed, root)
          : t.intake.errNotStore(scanned.filesUsed, root),
      )
      return
    }
    /* Handed over once the walk is scored, so the card's turn plays against a free main thread. */
    onData(data, sample)
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setOver(false)
    /* Read off the event before the first `await`, since the item list only lives for the handler.
       Both APIs are asked because which one answers is the browser's business. */
    const items = [...(e.dataTransfer?.items ?? [])]
    const handles = items.map((i) =>
      typeof i.getAsFileSystemHandle === "function"
        ? i.getAsFileSystemHandle().catch(() => null)
        : null,
    )
    const entries = items.map((i) =>
      typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null,
    )
    const loose = [...(e.dataTransfer?.files ?? [])]
    const out: Picked[] = []
    const got = await Promise.all(handles)
    await Promise.all(
      got.map((h, i) => {
        if (h) return pickHandle(h, out)
        const entry = entries[i]
        return entry ? walkEntry(entry, out) : Promise.resolve()
      }),
    )
    // Loose files, and no folder above them to name: the path is the file.
    if (!out.length && loose.length) {
      await handle(loose.map((f) => ({ file: f, path: f.name })))
      return
    }
    await handle(out)
  }

  /* The ask, and what it becomes with a folder in hand. The ask is the folder, not the files: one
     pick catches everything under it, and `.jsonl` is a detail no reader needs -- loose files
     dragged in still work. Where a folder is unlikely to be droppable, the heading names the page
     instead of asking for something the reader cannot hand over. One folder at a time, taking
     turns, rather than a list that grows a comma per agent. */
  const asked = HANDHELD
    ? t.intake.headingTouch
    : t.intake.heading(<WordCycle slots={ASKS} onFace={setFace} pin={pinned} />)
  /* The folder the paths named, standing still: the cycle has nothing left to offer once the
     reader has answered it, and a pick whose paths named no agent has nothing to name. */
  const reading =
    pinned === null
      ? t.intake.headingBusyAny
      : t.intake.headingBusy(ASKS[pinned].body ?? ASKS[pinned].word)

  /* Both are written once; which of them carries the weight is decided below. */
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
      {/* Two bands: the invitation on the line the report's picture takes, the privacy note on
          the rule that closes the card. */}
      <div className="invite">
        {/* The two headings swap rather than replace: it is the same line, saying what it is
            doing now with what it was asking for. */}
        <h2>
          <TextSwap token={busy ? "reading" : "ask"}>{busy ? reading : asked}</TextSwap>
        </h2>
        {/* A verb, the thing, and the three sizes the report resolves to. One line that fits on
            one line: a subtitle that wraps is a paragraph. */}
        <p className="lede">{HANDHELD ? t.intake.ledeTouch : t.intake.lede}</p>
        {/* Two ways in: the folder is the real one, but a phone has no `~/.claude` to point at,
            so the example is the same report drawn from invented transcripts. */}
        <div className="picks">{HANDHELD ? [exampleBtn, folderBtn] : [folderBtn, exampleBtn]}</div>
        {/* The third way in, for a reader already at a prompt. Not on a handheld, which has no
            terminal. */}
        {HANDHELD ? null : (
          <div className="cmdrow">
            <span className="howlbl">{t.intake.orTerminal}</span>
            <code>{CMD}</code>
            <CopyCmd />
          </div>
        )}
        {/* The way in, in the card rather than in the help below it: `.claude` is a dotfile, so
            the picker hides the folder this page just asked for. */}
        {/* One box, two faces, stacked in one grid cell rather than swapped through the flow --
            they have to cross, and two things taking turns in the flow shove instead. See
            `.swap`. */}
        <div
          className="swap"
          data-face={busy ? "files" : "how"}
          /* How tall the panel is, in rows, handed to the stylesheet. */
          style={vars({ "--file-rows": SHOWN })}
        >
          <div className="howto" data-on={busy ? "0" : "1"}>
            {/* Two rows: the switch decides *which* instruction is drawn, so it stands above
                the line it governs rather than reading as the end of it. No path in the label
                -- it is set in mono caps, which would print a dotfile as `.CLAUDE`. */}
            {/* On a phone the same slot says where the reader's own transcripts are: keystrokes
                for a file dialog need the machine. */}
            <div className="howhead">
              <span className="howlbl">{HANDHELD ? t.intake.yours : t.intake.hidden}</span>
              {HANDHELD ? null : <OsSwitch os={os} onPick={setOs} />}
            </div>
            {/* Keyed on the platform, so switching plays the swap the report's figures do.
                Inside the paragraph rather than around it: `TextSwap` is a span, and a span may
                not hold a `<p>`. */}
            <p>
              {HANDHELD ? (
                t.intake.yoursBody
              ) : (
                <Face.Provider value={face}>
                  <TextSwap token={os}>{t.intake.how[os](<Ask os={os} still={still} />)}</TextSwap>
                </Face.Provider>
              )}
            </p>
          </div>
          {/* Mounted from the first pick onward: a face unmounted the moment it stops being
              current has nothing left on screen to play its exit. */}
          {run ? (
            <div className="found" data-on={busy ? "1" : "0"} data-busy={busy ? "1" : "0"}>
              <Reading run={run} t={t} />
            </div>
          ) : null}
        </div>
        {/* Errors only, now that the progress is narrated by the list's own head. It keeps its
            ground either way -- an empty line here is what stops the group jumping. */}
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
          /* `webkitRelativePath` is what a folder pick adds over a file pick, and how `projects`
             is told from `Downloads`. */
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

/** The help under the empty card, on the same rule the breakdown and the footnotes take under a
 *  full one. */
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
