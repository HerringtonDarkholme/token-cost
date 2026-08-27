/* The durations the motion reads off the stylesheet, in both spellings a CSS value arrives in:
   the source writes `2200ms`, and the minified build hands back `2.2s`. */

import { afterEach, describe, expect, it } from "vitest"
import { cssMs } from "../src/ui/Motion.tsx"

const NAME = "--test-dur"

afterEach(() => {
  document.documentElement.style.removeProperty(NAME)
})

function read(value: string): number {
  document.documentElement.style.setProperty(NAME, value)
  return cssMs(NAME, 999)
}

describe("cssMs", () => {
  it("reads milliseconds", () => {
    expect(read("2200ms")).toBe(2200)
    expect(read("320ms")).toBe(320)
  })

  it("reads the seconds the minifier rewrites them to", () => {
    expect(read("2.2s")).toBe(2200)
    expect(read(".32s")).toBeCloseTo(320)
    expect(read("0.15s")).toBeCloseTo(150)
  })

  it("falls back where the stylesheet has not loaded", () => {
    expect(cssMs("--absent-dur", 350)).toBe(350)
  })
})
