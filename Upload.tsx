/* The upload screen: take files from a picker or a drop, read them in the page, hand them
   to the engine. Nothing leaves the machine -- there is no fetch here and no server to send
   anything to.

   The copy about *where* transcripts live is not decoration. `.claude` is a dotfile, so
   every file picker hides it by default, and a reader who cannot find their transcripts
   never sees the report at all. */

import { useRef, useState, type ReactNode } from "react";
import { analyze, type Analysis, type RawFile } from "./engine.ts";
import { useViewState } from "./store.ts";
import { ThemeBar } from "./Toolbar.tsx";

const MAX_LISTED = 60;

interface Status {
  node: ReactNode;
  err: boolean;
}

/** Walk a dropped folder. `webkitGetAsEntry` is non-standard and the DOM types declare it
 *  as always present, but it is the entry point that makes dropping a *directory* work at
 *  all, so it stays feature-detected rather than assumed. */
function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  return new Promise(res => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(f => { out.push(f); res(); }, () => res());
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const more = (): void => reader.readEntries(async entries => {
        if (!entries.length) return res();
        await Promise.all(entries.map(e => walkEntry(e, out)));
        more();
      }, () => res());
      more();
    } else res();
  });
}

export function Upload({ onData }: { onData: (data: Analysis) => void }): React.JSX.Element {
  const { theme } = useViewState();
  const [status, setStatus] = useState<Status | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [over, setOver] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const dirPicker = useRef<HTMLInputElement>(null);

  const say = (node: ReactNode, err = false): void => setStatus({ node, err });

  async function handle(list: FileList | File[] | null): Promise<void> {
    const all = [...(list || [])];
    const files = all.filter(f => f.name.endsWith(".jsonl"));
    if (!files.length) {
      say(all.length
        ? <>None of those {all.length} file(s) are <code>.jsonl</code> transcripts.</>
        : "No files selected.", true);
      return;
    }

    say(<>Reading <b>{files.length}</b> file{files.length > 1 ? "s" : ""}…</>);
    setNames(files.slice(0, MAX_LISTED).map(f => f.name)
      .concat(files.length > MAX_LISTED ? [`… +${files.length - MAX_LISTED} more`] : []));

    let payload: RawFile[];
    try {
      payload = await Promise.all(files.map(async f => ({ name: f.name, text: await f.text() })));
    } catch (e) {
      say(`Could not read the files: ${(e as Error).message}`, true);
      return;
    }

    const bytes = payload.reduce((a, b) => a + b.text.length, 0);
    say(<>Analyzing <b>{(bytes / 1e6).toFixed(1)} MB</b>…</>);
    /* Let that status actually paint before the parse takes the main thread: a multi-hundred
       megabyte corpus is seconds of synchronous work, and a page that goes silent first
       reads as hung. */
    await new Promise(r => setTimeout(r, 16));

    let data: Analysis;
    try {
      data = analyze(payload);
    } catch (e) {
      say(`Analysis failed: ${(e as Error).message}`, true);
      console.error(e);
      return;
    }
    if (!data.requests) {
      say(<>Parsed {payload.length} file(s) but found no priced API requests — are these
        Claude Code transcripts from <code>~/.claude/projects/</code>?</>, true);
      return;
    }
    onData(data);
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault();
    setOver(false);
    const items = e.dataTransfer?.items;
    if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
      const out: File[] = [];
      const entries = [...items].map(i => i.webkitGetAsEntry())
        .filter((x): x is FileSystemEntry => !!x);
      await Promise.all(entries.map(entry => walkEntry(entry, out)));
      await handle(out);
    } else {
      await handle(e.dataTransfer?.files ?? null);
    }
  }

  return (
    <div className="shell">
      <ThemeBar theme={theme} />
      <p className="eyebrow">Cost attribution · Claude Code</p>
      <h1 className="big-title">Where did your <em>Claude Code</em> money go?</h1>
      <p className="lede">Drop in your session transcripts to itemise every dollar down to the
        subcommand. Billing is per request and each request re-bills the whole context, so what
        you get back is <strong>carry cost</strong> — what each source cost across every request
        it survived in, not its face value.</p>

      <div className={over ? "drop over" : "drop"}
        onDragEnter={e => { e.preventDefault(); setOver(true); }}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={e => {
          // Leaving for a child element is not leaving the drop zone.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={e => { void onDrop(e); }}>
        <h2>Drop <code>.jsonl</code> transcripts here</h2>
        <p>Or pick a whole project folder. Multiple files are combined into one report.</p>
        <div className="picks">
          <button className="btn primary" type="button"
            onClick={() => filePicker.current?.click()}>Choose files</button>
          <button className="btn" type="button"
            onClick={() => dirPicker.current?.click()}>Choose folder</button>
        </div>
        <input ref={filePicker} type="file" multiple accept=".jsonl" className="hidden"
          onChange={e => { void handle(e.target.files); }} />
        <input ref={dirPicker} type="file" multiple webkitdirectory="" directory=""
          className="hidden" onChange={e => { void handle(e.target.files); }} />
        <p className="privacy">Parsed in this page · nothing is uploaded</p>
        <div className="status" data-err={status?.err ? "1" : "0"}>{status?.node}</div>
        {names ? (
          <div className="filelist">{names.map(n => <div key={n}>{n}</div>)}</div>
        ) : null}
      </div>

      <div className="where">
        <p className="whead"><strong>Where your transcripts live</strong></p>
        <p>One <code>.jsonl</code> file per session, in one folder per project, under
          <code>~/.claude/projects/</code>.</p>

        <p className="whead"><strong>Getting there — the folder is hidden</strong></p>
        <p><code>.claude</code> starts with a dot, so file pickers hide it by default. It is
          still reachable; you just have to ask for it by name.</p>
        <ul className="steps">
          <li><b>macOS</b> — click <em>Choose folder</em> above, then in the Finder dialog press{" "}
            <kbd>⇧</kbd><kbd>⌘</kbd><kbd>G</kbd>, paste <code>~/.claude/projects</code>, hit{" "}
            <kbd>return</kbd>, and pick a project folder.
            <span className="alt"><kbd>⇧</kbd><kbd>⌘</kbd><kbd>.</kbd> also toggles hidden files
              into view, in the dialog and in Finder.</span></li>
          <li><b>Windows</b> — type <code>%USERPROFILE%\.claude\projects</code> into the
            dialog&apos;s <em>File name</em> box and press <kbd>Enter</kbd>.</li>
          <li><b>Linux</b> — press <kbd>Ctrl</kbd><kbd>L</kbd> in the GTK dialog and type{" "}
            <code>~/.claude/projects</code>, or <kbd>Ctrl</kbd><kbd>H</kbd> to show hidden files.</li>
        </ul>
        <p>Prefer the terminal? Open the folder in your file manager, then drag a project onto
          the box above:</p>
        <p><code>open ~/.claude/projects</code> &nbsp;·&nbsp; largest projects first:{" "}
          <code>du -sh ~/.claude/projects/*/ | sort -rh | head</code></p>
      </div>
    </div>
  );
}
