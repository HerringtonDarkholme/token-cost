import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { viteSingleFile } from "vite-plugin-singlefile"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import path from "node:path"

const root = fileURLToPath(new URL(".", import.meta.url))
const STANDALONE = "cost-report.html"
/* Its own directory, because `dist/` is the deployed page -- which is code-split and would be
   overwritten by a build that inlines everything into one file. */
const OUT = "dist-standalone"

/** One file the reader opens by double-click, which Vite will not enforce on its own: it is
 *  bundled to IIFE so no module rules apply on a null origin, the script is moved to the end of
 *  `<body>` because a classic inline script in `<head>` runs before the body is parsed, and the
 *  checks below fail the build if either slips or if anything external is left in the document. */
function standalone(): Plugin {
  return {
    name: "standalone-html",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".html")) continue
        const html = String(asset.source)
          .replace(/<script\b([^>]*)\stype="module"/g, "<script$1")
          .replace(/<script\b([^>]*)\scrossorigin\b/g, "<script$1")

        const script = html.match(/[ \t]*<script\b[^>]*>[\s\S]*?<\/script>\n?/)
        const headEnd = html.indexOf("</head>")
        if (script && headEnd >= 0 && html.indexOf(script[0]) < headEnd) {
          /* Function replacements throughout: the bundle is arbitrary minified JS and a
             `$&` inside it would otherwise be read as a substitution pattern. */
          asset.source = html
            .replace(script[0], "")
            .replace("</body>", () => script[0].trim() + "\n</body>")
        } else {
          asset.source = html
        }
      }
    },
    closeBundle() {
      const built = path.join(root, OUT, "index.html")
      if (!fs.existsSync(built)) throw new Error(`build produced no ${built}`)
      const html = fs.readFileSync(built, "utf8")

      const offenders: Array<[RegExp, string]> = [
        [/<script[^>]*\ssrc=/i, "an external <script src>"],
        [/<link[^>]*\srel=["']?stylesheet/i, "an external <link rel=stylesheet>"],
        [/\stype=["']module["']/i, 'a type="module" script (blocked risk under file://)'],
        [/(?:src|href)=["']https?:\/\//i, "an absolute http(s) URL"],
        [/(?:src|href)=["']\/(?!\/)/i, "a root-absolute path (breaks under file://)"],
        [/@import\s+url\(/i, "a CSS @import"],
      ]
      for (const [re, what] of offenders) {
        const m = html.match(re)
        if (m) throw new Error(`${STANDALONE} is not self-contained: found ${what} — ${m[0]}`)
      }

      /* Ordering, not content -- and it fails silently rather than loudly, so it is worth
         asserting: the page still paints, it just never wires anything up. */
      const firstScript = html.search(/<script\b/i)
      const mountPoint = html.indexOf('id="app"')
      if (firstScript >= 0 && firstScript < html.indexOf("</head>"))
        throw new Error(
          `${STANDALONE} runs its script inside <head>: a classic inline ` +
            "script there executes before <body> is parsed, so the page mounts against " +
            "nothing.",
        )
      if (firstScript >= 0 && mountPoint >= 0 && firstScript < mountPoint)
        throw new Error(`${STANDALONE} runs its script before #app exists in the document.`)

      fs.writeFileSync(path.join(root, STANDALONE), html)
      const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
      this.info?.(`${STANDALONE} — ${kb} KB, self-contained, opens with no server`)
    },
  }
}

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), viteSingleFile(), standalone()],
  build: {
    outDir: OUT,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    // singlefile already forces `codeSplitting: false`, which subsumes `inlineDynamicImports`;
    // setting both makes Rolldown warn.
    rolldownOptions: {
      output: { format: "iife" },
      /* The faces are dynamic imports, which pulls in Vite's preload helper -- and that reads
         `import.meta.url`, which an IIFE has no answer for. Harmless with no chunk to preload. */
      onwarn(warning, warn) {
        if (warning.code === "EMPTY_IMPORT_META") return
        warn(warning)
      },
    },
  },
})
