/* What the motion helpers promise the components above them: a duration read off the stylesheet
   in whichever unit the build wrote it, and a phase that ends when the CSS drawing it does. */

import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { act, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { cssMs, useMotionEnd } from "../src/ui/Motion.tsx"

const NAME = "--test-dur"

beforeAll(() => {
  ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

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

/** One phase, waiting on whatever the element is playing. */
function Probe({ on, done }: { on: boolean; done: () => void }): React.JSX.Element {
  const el = useRef<HTMLDivElement>(null)
  useMotionEnd(el, on, done)
  return <div ref={el} />
}

/** Long enough for the wait's frame and the promise behind it. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
  })
}

describe("useMotionEnd", () => {
  let root: Root

  afterEach(() => {
    act(() => root.unmount())
    delete (Element.prototype as { getAnimations?: unknown }).getAnimations
  })

  function mount(on: boolean, done: () => void): void {
    const host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(<Probe on={on} done={done} />))
  }

  it("ends the phase on the next frame where nothing is playing", async () => {
    /* Which is every test run and every reader who asked for stillness: no animation, no
       `animationend`, and a phase that waited for one would never end. */
    let ended = 0
    mount(true, () => ended++)
    await settle()
    expect(ended).toBe(1)
  })

  it("waits for what is playing, and ends once", async () => {
    let finish = (): void => {}
    const playing = { finished: new Promise((r) => (finish = () => r(null))) }
    ;(Element.prototype as { getAnimations?: unknown }).getAnimations = () => [playing, playing]

    let ended = 0
    mount(true, () => ended++)
    await settle()
    expect(ended).toBe(0)

    finish()
    await settle()
    expect(ended).toBe(1)
  })

  it("stays shut until the phase opens it", async () => {
    let ended = 0
    mount(false, () => ended++)
    await settle()
    expect(ended).toBe(0)
  })
})
