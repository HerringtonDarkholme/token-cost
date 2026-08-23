import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))

/** What each chunk is fetched *for*: the empty card owns the walk and the picker, the report owns
 *  the charts, and the share captions are six languages of prose nobody who does not click Share
 *  ever needs. A static import from anywhere else quietly moves one of these back into the entry,
 *  where every visit pays for it -- which looks like nothing until you read the chunk sizes. */
const OWNED: Record<string, string[]> = {
  FaceIntake: [
    "ui/Upload.tsx",
    "core/engine.ts",
    "core/sample.ts",
    "core/agents/index.ts",
    "core/agents/claude.ts",
    "core/agents/codex.ts",
    "core/agents/grok.ts",
  ],
  FaceReport: [
    "ui/Report.tsx",
    "ui/Sunburst.tsx",
    "ui/Mosaic.tsx",
    "ui/Ledger.tsx",
    "ui/Panels.tsx",
  ],
  "post-copy": ["core/post-copy.ts"],
}

/** Which source files went into a chunk, in the one spelling both bundlers agree on. */
function ids(c: { moduleIds?: string[]; modules?: Record<string, unknown> }): string[] {
  return (c.moduleIds ?? Object.keys(c.modules ?? {})).map((id) => id.replace(/\\/g, "/"))
}

/** The split, asserted rather than hoped for. */
function split(): Plugin {
  return {
    name: "chunks-are-split",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((c) => c.type === "chunk")
      const entry = chunks.find((c) => c.isEntry)
      if (!entry) throw new Error("build produced no entry chunk")

      for (const [lazy, owned] of Object.entries(OWNED)) {
        const chunk = chunks.find((c) => c.name === lazy)
        if (!chunk) throw new Error(`${lazy} is no longer a chunk of its own`)
        for (const file of owned) {
          const tail = `/src/${file}`
          if (ids(entry).some((id) => id.endsWith(tail)))
            throw new Error(
              `src/${file} is in the entry chunk rather than ${lazy} — something imports it ` +
                "statically, so every visit downloads it",
            )
          if (!ids(chunk).some((id) => id.endsWith(tail)))
            throw new Error(`src/${file} is no longer in ${lazy}`)
        }
      }
    },
  }
}

/* The deployed page, and the one build allowed to be more than one file: the card's two faces are
   fetched apart, so a report the CLI handed over never downloads the transcript walk and a reader
   who has yet to drop a folder never downloads the charts. `vite.standalone.config.ts` builds the
   double-clickable single file instead.
   `base` is root-absolute because `/report/shell-commands` is served the same document as `/`, and
   a relative asset URL would be looked for one folder down. */
export default defineConfig({
  root,
  base: "/",
  plugins: [react(), split()],
  build: { target: "es2022" },
  server: { host: "127.0.0.1", port: 8000 },
})
