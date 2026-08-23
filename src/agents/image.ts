/* Reading a picture, for the readers that meet one. */

/* A picture is billed by its size on screen rather than by the bytes it arrives as, so a reader
   sizes one by reading its header -- the alternative, taken once, billed a screenshot as a million
   characters of text. */
const IMAGE_FALLBACK = 1500,
  IMAGE_CAP = 1600
function b64Bytes(data: unknown, limit: number): Uint8Array | null {
  try {
    const want = Math.ceil(limit / 3) * 4
    // A screenshot is megabytes of base64 and the header is in the first few hundred bytes, so
    // cut a generous prefix before scrubbing rather than scrubbing the whole payload.
    const clean = String(data)
      .slice(0, want * 2)
      .replace(/^data:[^,]*,/, "")
      .replace(/[^A-Za-z0-9+/=]/g, "")
    const slice = clean.slice(0, want)
    const bin =
      typeof atob === "function"
        ? atob(slice.replace(/=+$/, ""))
        : Buffer.from(slice, "base64").toString("binary")
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** Pixel dimensions decoded from an image header. */
export interface ImageDims {
  w: number
  h: number
}

export function imageDims(data: unknown): ImageDims | null {
  if (!data) return null
  const B = b64Bytes(data, 65536)
  if (!B || B.length < 24) return null
  const be16 = (i: number) => (B[i] << 8) | B[i + 1]
  const be32 = (i: number) => ((B[i] << 24) | (B[i + 1] << 16) | (B[i + 2] << 8) | B[i + 3]) >>> 0
  if (B[0] === 0x89 && B[1] === 0x50) return { w: be32(16), h: be32(20) } // PNG IHDR
  if (B[0] === 0x47 && B[1] === 0x49) return { w: B[6] | (B[7] << 8), h: B[8] | (B[9] << 8) } // GIF
  if (B[0] === 0xff && B[1] === 0xd8) {
    // JPEG: find SOFn
    let i = 2
    while (i + 9 < B.length) {
      if (B[i] !== 0xff) {
        i++
        continue
      }
      const mk = B[i + 1]
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc)
        return { h: be16(i + 5), w: be16(i + 7) }
      if (mk === 0xd8 || (mk >= 0xd0 && mk <= 0xd9)) {
        i += 2
        continue
      }
      i += 2 + be16(i + 2)
    }
    return null
  }
  if (B[8] === 0x57 && B[9] === 0x45 && B[10] === 0x42 && B[11] === 0x50) {
    // WEBP
    const le16 = (i: number) => B[i] | (B[i + 1] << 8)
    if (B[15] === 0x58)
      return {
        w: (B[24] | (B[25] << 8) | (B[26] << 16)) + 1,
        h: (B[27] | (B[28] << 8) | (B[29] << 16)) + 1,
      }
    if (B[15] === 0x20) return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff }
    return null
  }
  return null
}
/** What a picture is worth, in tokens. The formula is the one Anthropic publishes and the estimate
 *  every agent here gets, none of the others having published their own. */
export function imageTokens(data: unknown): number {
  const d = imageDims(data)
  if (!d || !d.w || !d.h || d.w > 20000 || d.h > 20000) return IMAGE_FALLBACK
  const scale = Math.min(1, 1568 / Math.max(d.w, d.h)) // long edge is clamped
  return Math.max(1, Math.min(IMAGE_CAP, Math.round((d.w * scale * d.h * scale) / 750)))
}
