import { defineConfig, type Plugin } from "vite"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import path from "node:path"

const root = fileURLToPath(new URL(".", import.meta.url))
const BUNDLE = "bin/cli.js"

/* npm installs a bin into `node_modules`, and Node refuses to strip types anywhere under it --
   so the published command has to be JavaScript, however the working tree runs it. */
function executable(): Plugin {
  return {
    name: "cli-executable",
    closeBundle() {
      const built = path.join(root, BUNDLE)
      if (!fs.existsSync(built)) throw new Error(`build produced no ${built}`)
      const js = fs.readFileSync(built, "utf8")
      if (!js.startsWith("#!")) throw new Error(`${BUNDLE} lost its shebang`)
      if (/from\s*["']\.\.?\//.test(js)) throw new Error(`${BUNDLE} still imports a source file`)

      /* Direct `./bin/cli.js` should work too, not only the shim npm writes on install. */
      fs.chmodSync(built, 0o755)
      const kb = (Buffer.byteLength(js) / 1024).toFixed(0)
      this.info?.(`${BUNDLE} — ${kb} KB, runs on plain node`)
    },
  }
}

export default defineConfig({
  root,
  plugins: [executable()],
  build: {
    // An SSR build leaves `node:*` external and bundles everything else, which for this entry
    // is the engine and nothing more.
    ssr: "bin/cli.ts",
    target: "node22",
    outDir: "bin",
    // The entry lives in the output directory, so emptying it would delete the source.
    emptyOutDir: false,
    minify: false,
    // The entry is a script, not a library: without this its top-level `main()` is treated as
    // dead code and the bundle comes out empty.
    rolldownOptions: {
      treeshake: { moduleSideEffects: true },
      output: {
        format: "esm",
        entryFileNames: "cli.js",
      },
    },
  },
})
