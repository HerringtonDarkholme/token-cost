/* The read, against a folder that will not hold still: a transcript that grew under its snapshot,
   and one that cannot be read at all. */

import { describe, expect, it } from "vitest"
import { readEach, readPicked, type Source } from "../src/Upload.tsx"

/** A source that resolves with its own name. */
const ok = (name: string): Source => ({ name, read: () => Promise.resolve(name) })

/** A source that rejects the way Chrome does when the file moved under the snapshot. */
const bad = (name: string): Source => ({
  name,
  read: () =>
    Promise.reject(Object.assign(new Error(name + " moved"), { name: "NotReadableError" })),
})

/** A `File` stub, since only `text` is ever asked of one. */
const file = (text: string | Error): File =>
  ({
    name: "t.jsonl",
    text: () => (text instanceof Error ? Promise.reject(text) : Promise.resolve(text)),
  }) as unknown as File

const notReadable = (): Error =>
  Object.assign(new Error("could not be read"), { name: "NotReadableError" })

describe("readEach", () => {
  it("walks past a transcript that will not read", async () => {
    const seen: (string | null)[] = []
    const r = await readEach([ok("a"), bad("b"), ok("c")], (_n, text) => {
      seen.push(text)
    })
    expect(seen).toEqual(["a", null, "c"])
    expect(r.skipped).toBe(1)
    expect(r.firstErr?.message).toBe("b moved")
  })

  it("reports every file, in order, when none of them read", async () => {
    const seen: (string | null)[] = []
    const r = await readEach([bad("a"), bad("b")], (_n, text) => {
      seen.push(text)
    })
    expect(seen).toEqual([null, null])
    expect(r.skipped).toBe(2)
    expect(r.firstErr?.message).toBe("a moved")
  })

  it("counts nothing when the folder is clean", async () => {
    const r = await readEach([ok("a"), ok("b")], () => {})
    expect(r).toEqual({ skipped: 0, firstErr: null })
  })
})

describe("readPicked", () => {
  it("reads again from a fresh snapshot when the file moved", async () => {
    const p = {
      file: file(notReadable()),
      path: "-Users-me-code-thing/s.jsonl",
      handle: { getFile: () => Promise.resolve(file("grown")) } as unknown as FileSystemFileHandle,
    }
    await expect(readPicked(p)).resolves.toBe("grown")
  })

  it("gives up when there is no handle to take one from", async () => {
    const p = { file: file(notReadable()), path: "s.jsonl" }
    await expect(readPicked(p)).rejects.toThrow("could not be read")
  })

  it("does not retry a failure that a fresh snapshot cannot fix", async () => {
    const p = {
      file: file(Object.assign(new Error("gone"), { name: "NotFoundError" })),
      path: "s.jsonl",
      handle: { getFile: () => Promise.resolve(file("grown")) } as unknown as FileSystemFileHandle,
    }
    await expect(readPicked(p)).rejects.toThrow("gone")
  })
})
