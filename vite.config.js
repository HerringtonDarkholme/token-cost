import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const STANDALONE = "cost-report.html";

/**
 * The deliverable is one file the reader opens by double-click, so the build has two
 * obligations Vite will not enforce on its own.
 *
 * 1. It must run from `file://`. A `<script type="module">` is fetched and linked under
 *    module rules, and on a null origin that is not something to gamble the whole
 *    deliverable on. Bundling to IIFE and dropping the `type`/`crossorigin` attributes
 *    leaves a classic inline script, which has no such constraints.
 * 2. It must reach the network never. Everything is inlined already; this asserts it,
 *    so a stray external reference fails the build instead of silently shipping a page
 *    that leaks a request the moment someone opens it.
 */
function standalone() {
  return {
    name: "standalone-html",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".html")) continue;
        asset.source = String(asset.source)
          .replace(/<script\b([^>]*)\stype="module"/g, "<script$1")
          .replace(/<script\b([^>]*)\scrossorigin\b/g, "<script$1");
      }
    },
    closeBundle() {
      const built = path.join(root, "dist", "index.html");
      if (!fs.existsSync(built)) throw new Error(`build produced no ${built}`);
      const html = fs.readFileSync(built, "utf8");

      const offenders = [
        [/<script[^>]*\ssrc=/i, "an external <script src>"],
        [/<link[^>]*\srel=["']?stylesheet/i, "an external <link rel=stylesheet>"],
        [/\stype=["']module["']/i, 'a type="module" script (blocked risk under file://)'],
        [/(?:src|href)=["']https?:\/\//i, "an absolute http(s) URL"],
        [/(?:src|href)=["']\/(?!\/)/i, "a root-absolute path (breaks under file://)"],
        [/@import\s+url\(/i, "a CSS @import"],
      ];
      for (const [re, what] of offenders) {
        const m = html.match(re);
        if (m) throw new Error(`${STANDALONE} is not self-contained: found ${what} — ${m[0]}`);
      }

      fs.writeFileSync(path.join(root, STANDALONE), html);
      const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
      this.info?.(`${STANDALONE} — ${kb} KB, self-contained, opens with no server`);
    },
  };
}

export default defineConfig({
  root,
  base: "./",
  plugins: [viteSingleFile(), standalone()],
  build: {
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: { format: "iife", inlineDynamicImports: true },
    },
  },
  server: { host: "127.0.0.1", port: 8000 },
});
