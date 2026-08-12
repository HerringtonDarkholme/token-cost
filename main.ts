/* Upload screen: take files from a picker or a drop, read them in the page, hand them to
   the engine. Nothing leaves the machine -- there is no fetch here and no server to send
   anything to.

   This lives in its own module rather than inline in index.html so that it is type-checked
   like the rest; an inline <script> never is. */

import { analyze, type RawFile } from "./engine.ts";
import { initReport } from "./views.ts";

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id} in the document`);
  return el;
};

const say = (html: string, err?: boolean): void => {
  const s = $("status");
  s.innerHTML = html;
  s.dataset.err = err ? "1" : "0";
};

async function handle(list: FileList | File[] | null): Promise<void> {
  const all = [...(list || [])], files = all.filter(f => f.name.endsWith(".jsonl"));
  if (!files.length) {
    say(all.length ? `None of those ${all.length} file(s) are <code>.jsonl</code> transcripts.`
                   : "No files selected.", true);
    return;
  }
  say(`Reading <b>${files.length}</b> file${files.length > 1 ? "s" : ""}…`);
  $("filelist").classList.remove("hidden");
  $("filelist").textContent = files.slice(0, 60).map(f => f.name).join("\n")
    + (files.length > 60 ? `\n… +${files.length - 60} more` : "");
  let payload: RawFile[];
  try { payload = await Promise.all(files.map(async f => ({ name: f.name, text: await f.text() }))); }
  catch (e) { say(`Could not read the files: ${(e as Error).message}`, true); return; }

  await run(payload);
}

async function run(payload: RawFile[], label?: string): Promise<void> {
  const bytes = payload.reduce((a, b) => a + b.text.length, 0);
  say(`Analyzing <b>${(bytes / 1e6).toFixed(1)} MB</b>${label ? ` from <b>${label}</b>` : ""}…`);
  await new Promise(r => setTimeout(r, 16));
  let data;
  try { data = analyze(payload); }
  catch (e) { say(`Analysis failed: ${(e as Error).message}`, true); console.error(e); return; }
  if (!data.requests) {
    say(`Parsed ${payload.length} file(s) but found no priced API requests — are these Claude
         Code transcripts from <code>~/.claude/projects/</code>?`, true);
    return;
  }
  $("uploadView").classList.add("hidden");
  $("reportView").classList.remove("hidden");
  initReport(data);
  window.scrollTo(0, 0);
}

const fileInput = $("fileInput") as HTMLInputElement;
const dirInput = $("dirInput") as HTMLInputElement;

$("pickFiles").addEventListener("click", () => fileInput.click());
$("pickDir").addEventListener("click", () => dirInput.click());
fileInput.addEventListener("change", e => handle((e.target as HTMLInputElement).files));
dirInput.addEventListener("change", e => handle((e.target as HTMLInputElement).files));
$("uploadView").addEventListener("click", e => {
  const t = e.target as Element | null;
  const b = t && t.closest ? (t.closest("[data-th]") as HTMLElement | null) : null;
  if (!b) return;
  const r = document.documentElement;
  if (b.dataset.th === "system") r.removeAttribute("data-theme");
  else if (b.dataset.th) r.setAttribute("data-theme", b.dataset.th);
  if (b.parentElement)
    [...b.parentElement.children].forEach(x => x.setAttribute("aria-pressed", String(x === b)));
});

const drop = $("drop");
(["dragenter", "dragover"] as const).forEach(ev => drop.addEventListener(ev, e => {
  e.preventDefault(); drop.classList.add("over");
}));
(["dragleave", "drop"] as const).forEach(ev => drop.addEventListener(ev, e => {
  if (ev === "dragleave" && drop.contains((e as DragEvent).relatedTarget as Node | null)) return;
  drop.classList.remove("over");
}));
drop.addEventListener("drop", async e => {
  e.preventDefault();
  const items = (e as DragEvent).dataTransfer?.items;
  // The DOM lib types webkitGetAsEntry as always present, but it is the non-standard
  // entry point that makes dropping a *folder* work, so it is still feature-detected.
  if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
    const out: File[] = [];
    const walk = (entry: FileSystemEntry): Promise<void> => new Promise(res => {
      if (entry.isFile) (entry as FileSystemFileEntry).file(f => { out.push(f); res(); });
      else if (entry.isDirectory) {
        const rd = (entry as FileSystemDirectoryEntry).createReader();
        const more = (): void => rd.readEntries(async ents => {
          if (!ents.length) return res();
          await Promise.all(ents.map(walk)); more();
        }, () => res());
        more();
      } else res();
    });
    await Promise.all([...items].map(i => i.webkitGetAsEntry())
      .filter((x): x is FileSystemEntry => !!x).map(walk));
    handle(out);
  } else handle((e as DragEvent).dataTransfer?.files ?? null);
});
