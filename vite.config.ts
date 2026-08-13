import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { viteSingleFile } from "vite-plugin-singlefile"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import path from "node:path"

const root = fileURLToPath(new URL(".", import.meta.url))
const STANDALONE = "cost-report.html"

/**
 * The deliverable is one file the reader opens by double-click, so the build has three
 * obligations Vite will not enforce on its own.
 *
 * 1. It must run from `file://`. A `<script type="module">` is fetched and linked under
 *    module rules, and on a null origin that is not something to gamble the whole
 *    deliverable on. Bundling to IIFE and dropping the `type`/`crossorigin` attributes
 *    leaves a classic inline script, which has no such constraints.
 * 2. That script has to run after the document exists. Vite hoists the bundle into
 *    `<head>`, which is harmless while it is a module — modules are deferred — and fatal
 *    the moment step 1 strips the `type`, because a classic inline script in `<head>`
 *    executes before `<body>` is parsed. So it is moved to the end of `<body>`, and the
 *    check below fails the build if it ever ends up back in the head.
 * 3. It must reach the network never. Everything is inlined already; this asserts it,
 *    so a stray external reference fails the build instead of silently shipping a page
 *    that leaks a request the moment someone opens it.
 */
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
      const built = path.join(root, "dist", "index.html")
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
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    // Vite 8 bundles with Rolldown; `rollupOptions` still works but is deprecated.
    // singlefile already forces `codeSplitting: false`, which subsumes
    // `inlineDynamicImports` -- setting both makes Rolldown warn.
    rolldownOptions: {
      output: { format: "iife" },
    },
  },
  server: { host: "127.0.0.1", port: 8000 },
})
