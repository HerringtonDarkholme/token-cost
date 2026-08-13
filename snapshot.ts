/* The card, rasterised to a PNG inside the page.

   There is no server and no screenshot library. The browser already knows how to draw this
   card, so the snapshot hands it back its own markup inside an `<svg><foreignObject>` with
   the page's own stylesheet inlined, and lets it rasterise that into a canvas. The image is
   therefore the same DOM and the same CSS the reader is looking at -- their theme, their
   lens, their drill-down -- and the deliverable stays one dependency-free file.

   The one rule that shapes everything below: an SVG loaded through `<img>` is a separate
   document with no access back to this page. Anything it references externally either fails
   to load or taints the canvas and makes `toBlob` throw. The page ships no fonts and no
   images, so the only two things that have to be carried across by hand are the stylesheet
   text and the custom properties the theme resolved to -- `:root` inside the image is the
   `<svg>` element, not this document's `<html>`, so the variables have to be re-stated. */

/** Extra paper around the card, so the crop does not read as a cut-off screenshot. */
const PAD = 20

/** Rasterise at 2× and the image survives a retina timeline without looking soft. The SVG
 *  is vector, so this is drawn at size rather than upscaled. */
const SCALE = 2

/** Elements the reader needs but the picture does not: controls that do nothing in a PNG. */
const OMIT = "[data-nosnap]"

/** Every rule of every stylesheet the page loaded, as text.
 *
 *  `cssRules` throws on a cross-origin sheet. This page has none -- the stylesheet is a
 *  sibling file in dev and an inline `<style>` in the built single file -- but a browser
 *  extension injecting one should degrade to a slightly wrong image, not an exception. */
function pageCss(): string {
  let out = ""
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) out += rule.cssText + "\n"
    } catch {
      /* unreadable sheet, not ours */
    }
  }
  return out
}

/** The theme, flattened. Custom property names are scraped from the stylesheet and resolved
 *  against the live `<html>`, which is what makes the image follow the dark/light toggle and
 *  the OS preference without the image having to reason about either. */
function themeVars(css: string): string {
  const root = getComputedStyle(document.documentElement)
  const seen = new Set(css.match(/--[\w-]+/g) || [])
  let out = ""
  for (const name of seen) {
    const value = root.getPropertyValue(name).trim()
    if (value) out += `${name}:${value};`
  }
  return out
}

/** The frame's style is written into an XML attribute by hand, and the values going into it
 *  are CSS the page authored -- `--sans` alone is `"Helvetica Neue",Helvetica,…`, whose
 *  quotes would close the attribute and fail the parse. */
const attr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** `<img>` reports SVG parse failures as a plain error event, so the promise has to supply
 *  the diagnosis itself. */
function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("the browser could not render the card as an image"))
    img.src = src
  })
}

/** `el`, drawn as it stands, as a PNG blob. */
export async function snapshot(el: HTMLElement, scale = SCALE): Promise<Blob> {
  const rect = el.getBoundingClientRect()
  const w = Math.ceil(rect.width) + PAD * 2,
    h = Math.ceil(rect.height) + PAD * 2

  const clone = el.cloneNode(true) as HTMLElement
  for (const gone of Array.from(clone.querySelectorAll(OMIT))) gone.remove()
  /* Pinned rather than left to re-resolve: the card's height comes from an aspect ratio
     against a width that would otherwise be whatever the foreignObject decided. */
  clone.style.width = `${rect.width}px`
  clone.style.height = `${rect.height}px`

  const css = pageCss()
  const paper =
    getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#fff"
  const body = getComputedStyle(document.body)
  const frame =
    `${themeVars(css)}width:${w}px;height:${h}px;padding:${PAD}px;` +
    `background:${paper};color:${body.color};font-family:${body.fontFamily};` +
    "font-variant-numeric:tabular-nums;box-sizing:border-box;"

  /* CDATA because the stylesheet is XML text here, and one `&` or `<` in it would otherwise
     fail the parse -- silently, as an image that will not load. */
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" ` +
    `viewBox="0 0 ${w} ${h}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="${attr(frame)}">` +
    `<style><![CDATA[\n${css}\n]]></style>` +
    new XMLSerializer().serializeToString(clone) +
    "</div></foreignObject></svg>"

  const img = await load("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg))

  const canvas = document.createElement("canvas")
  canvas.width = w * scale
  canvas.height = h * scale
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("no 2d canvas context")
  /* The SVG's own background covers this, but a PNG dropped on a dark timeline should not
     be able to show transparent pixels if any edge rounds the wrong way. */
  ctx.fillStyle = paper
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("the canvas produced no image"))),
      "image/png",
    )
  })
}

/** Hand the blob to the reader as a file. The only fallback that works everywhere the
 *  clipboard does not -- including `file://`, where clipboard permission can be absent. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  /* Revoked on a turn of the loop rather than immediately: Safari reads the href after the
     click handler returns. */
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
