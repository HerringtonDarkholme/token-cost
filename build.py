#!/usr/bin/env python3
"""Inline engine.js, views.js and style.css into one standalone HTML file.

Why: browsers block ES-module `import` over file://, so the modular index.html only
works behind a server. The standalone build has no imports and opens by double-click.

    python3 build.py            -> cost-report.html
"""
import re, pathlib, sys

HERE = pathlib.Path(__file__).parent
OUT = HERE / "cost-report.html"

def strip_module(src: str) -> str:
    """Remove ESM syntax so the code can live in one classic <script>."""
    src = re.sub(r'^\s*import\s.*?;\s*$', '', src, flags=re.M)          # import lines
    src = re.sub(r'^\s*export\s+(?=(function|const|let|class))', '', src, flags=re.M)
    src = re.sub(r'^\s*export\s*\{[^}]*\}\s*;?\s*$', '', src, flags=re.M)
    return src

def main():
    html = (HERE / "index.html").read_text()
    css = (HERE / "style.css").read_text()
    engine = strip_module((HERE / "engine.js").read_text())
    views = strip_module((HERE / "views.js").read_text())

    # external stylesheet -> inline
    html = html.replace('<link rel="stylesheet" href="style.css">',
                        "<style>\n" + css + "\n</style>")

    # the module script -> classic script with both modules prepended
    m = re.search(r'<script type="module">(.*?)</script>', html, re.S)
    if not m:
        sys.exit("could not find the module <script> in index.html")
    app = strip_module(m.group(1))
    combined = ("<script>\n/* ---- engine.js ---- */\n" + engine +
                "\n/* ---- views.js ---- */\n" + views +
                "\n/* ---- app ---- */\n" + app + "\n</script>")
    html = html[:m.start()] + combined + html[m.end():]

    for tok in ("import ", "export "):
        if re.search(r'^\s*' + tok, html, flags=re.M):
            sys.exit(f"ESM leftover in output: {tok!r} — build would break under file://")

    OUT.write_text(html)
    kb = len(html) / 1024
    print(f"wrote {OUT.name}  ({kb:.0f} KB) — opens directly, no server needed")

if __name__ == "__main__":
    main()
