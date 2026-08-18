/* The read, against a folder that will not hold still: a transcript that grew under its snapshot,
   and one that cannot be read at all. */

import { describe, expect, it } from "vitest"
import { pickHandle, readEach, readPicked, type Source } from "../src/Upload.tsx"

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

/** A file handle stub, which is all `readPicked` and `pickHandle` ask for. */
const fileHandle = (name: string, text: string | Error): FileSystemFileHandle =>
  ({
    kind: "file",
    name,
    getFile: () => (text instanceof Error ? Promise.reject(text) : Promise.resolve(file(text))),
  }) as unknown as FileSystemFileHandle

/** A directory handle stub over a flat list of kids. */
const dirHandle = (name: string, kids: FileSystemHandle[]): FileSystemDirectoryHandle =>
  ({
    kind: "directory",
    name,
    values: async function* () {
      for (const k of kids) yield k
    },
  }) as unknown as FileSystemDirectoryHandle

describe("readPicked", () => {
  it("takes the bytes from the handle, not from the stale snapshot beside it", async () => {
    const p = {
      file: file(notReadable()),
      path: "-Users-me-code-thing/s.jsonl",
      handle: fileHandle("s.jsonl", "grown"),
    }
    await expect(readPicked(p)).resolves.toBe("grown")
  })

  it("reads the snapshot when there is no handle, as the file input hands over none", async () => {
    const p = { file: file("typed in"), path: "s.jsonl" }
    await expect(readPicked(p)).resolves.toBe("typed in")
  })

  it("fails rather than falling back when the handle will not open", async () => {
    const p = {
      file: file("stale"),
      path: "s.jsonl",
      handle: fileHandle("s.jsonl", notReadable()),
    }
    await expect(readPicked(p)).rejects.toThrow("could not be read")
  })
})

describe("pickHandle", () => {
  it("walks a dropped folder, keeping the handle each transcript will be read from", async () => {
    const out: { path: string; handle?: FileSystemFileHandle }[] = []
    const kid = fileHandle("s.jsonl", "one line")
    await pickHandle(
      dirHandle("-Users-me-code-thing", [dirHandle("nested", [kid]), kid]),
      out as never,
    )
    expect(out.map((p) => p.path)).toEqual([
      "-Users-me-code-thing/nested/s.jsonl",
      "-Users-me-code-thing/s.jsonl",
    ])
    expect(out.every((p) => p.handle === kid)).toBe(true)
  })

  it("takes a single dropped file as its own path", async () => {
    const out: { path: string }[] = []
    await pickHandle(fileHandle("s.jsonl", "one line"), out as never)
    expect(out.map((p) => p.path)).toEqual(["s.jsonl"])
  })
})
