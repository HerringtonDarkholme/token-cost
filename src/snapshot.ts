/* The card, rasterised to a PNG inside the page. */

/** Extra paper around the card, so the crop does not read as a cut-off screenshot. */
const PAD = 20

/** Rasterise at 2× and the image survives a retina timeline without looking soft. */
const SCALE = 2

/** Elements the reader needs but the picture does not: controls that do nothing in a PNG. */
const OMIT = "[data-nosnap]"

/** Figures whose digits live in a shadow root, which does not survive the trip below. */
const FLAT = "[data-snaptext]"

/** Replace the animated figures with their own text. */
function flatten(clone: HTMLElement): void {
  for (const el of Array.from(clone.querySelectorAll(FLAT))) {
    const span = document.createElement("span")
    span.className = el.className
    span.textContent = el.getAttribute("data-snaptext") || ""
    el.replaceWith(span)
  }
}

/** Every rule of every stylesheet the page loaded, as text. */
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

/** The theme, flattened. */
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

/** The frame's style is written into an XML attribute by hand, and the values going into it are
 *  CSS the page authored -- `--sans` alone is `"Helvetica Neue",Helvetica,…`, whose quotes would
 *  close the attribute and fail the parse. */
const attr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** `<img>` reports SVG parse failures as a plain error event, so the promise has to supply the
 *  diagnosis itself. */
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
  flatten(clone)
  /* The picture is not a performance. */
  clone.setAttribute("data-snapshot", "")
  /* Pinned rather than left to re-resolve: the card's height comes from an aspect ratio against
     a width that would otherwise be whatever the foreignObject decided. */
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

  /* CDATA because the stylesheet is XML text here, and one `&` or `<` in it would otherwise fail
     the parse -- silently, as an image that will not load. */
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
  /* The SVG's own background covers this, but a PNG dropped on a dark timeline should not be
     able to show transparent pixels if any edge rounds the wrong way. */
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

/** Hand the blob to the reader as a file. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  /* Revoked on a turn of the loop rather than immediately: Safari reads the href after the click
     handler returns. */
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
