/* The read, against a folder that will not hold still: a transcript that grew under its snapshot,
   and one that cannot be read at all. */

import { describe, expect, it } from "vitest"
import { chunkPicked, pickedFile, pickHandle, readEach, type Source } from "../src/ui/Upload.tsx"

/** A source that gives up its own name, in one chunk. */
const ok = (name: string): Source => ({
  name,
  size: name.length,
  chunks: async function* () {
    yield name
  },
})

/** A source that fails the way Chrome does when the file moved out from under the snapshot. */
const bad = (name: string): Source => ({
  name,
  size: name.length,
  /* Spelled out rather than an empty generator, because the failure has to arrive on the first
     pull the way Chrome delivers it, not on the call that asks for the iterator. */
  chunks: () => ({
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<string>> =>
        Promise.reject(Object.assign(new Error(name + " moved"), { name: "NotReadableError" })),
    }),
  }),
})

/** Everything the read asks of a `File`: its bytes as a stream, or the failure instead of them. */
const file = (text: string | Error): File =>
  ({
    name: "t.jsonl",
    size: text instanceof Error ? 0 : text.length,
    stream: () => {
      if (text instanceof Error) throw text
      return new Blob([text]).stream()
    },
  }) as unknown as File

/** A `File` whose bytes arrive in exactly these pieces, so a test can put a join where it wants
 *  one rather than where the platform happens to put it. */
const bytes = (pieces: number[][]): File =>
  ({
    name: "t.jsonl",
    size: pieces.reduce((n, b) => n + b.length, 0),
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const b of pieces) c.enqueue(new Uint8Array(b))
          c.close()
        },
      }),
  }) as unknown as File

/** The chunks of a source, joined back up. */
const drink = async (src: AsyncIterable<string>): Promise<string> => {
  let out = ""
  for await (const chunk of src) out += chunk
  return out
}

const notReadable = (): Error =>
  Object.assign(new Error("could not be read"), { name: "NotReadableError" })

describe("readEach", () => {
  it("walks past a transcript that will not read", async () => {
    const seen: string[] = []
    const r = await readEach([ok("a"), bad("b"), ok("c")], async (f) => {
      const text = await drink(f.chunks())
      seen.push(text)
      return text.length > 0
    })
    expect(seen).toEqual(["a", "c"])
    expect(r.skipped).toBe(1)
    expect(r.firstErr?.message).toBe("b moved")
  })

  it("reports every file, in order, when none of them read", async () => {
    const seen: string[] = []
    const r = await readEach([bad("a"), bad("b")], async (f) => {
      seen.push(f.name)
      await drink(f.chunks())
      return true
    })
    expect(seen).toEqual(["a", "b"])
    expect(r.skipped).toBe(2)
    expect(r.firstErr?.message).toBe("a moved")
  })

  it("counts nothing when the folder is clean", async () => {
    const r = await readEach([ok("a"), ok("b")], () => Promise.resolve(true))
    expect(r).toEqual({ skipped: 0, firstErr: null })
  })

  it("counts a transcript that gave up no bytes at all, however it ended", async () => {
    // Chrome hands back an empty string rather than an error past the length a string can hold.
    const r = await readEach([ok("a"), ok("b")], (f) => Promise.resolve(f.name !== "b"))
    expect(r).toEqual({ skipped: 1, firstErr: null })
  })

  it("leaves the rest of the folder unread once the pick it belongs to is gone", async () => {
    const seen: string[] = []
    let live = true
    const r = await readEach(
      [ok("a"), ok("b"), ok("c"), ok("d")],
      (f) => {
        seen.push(f.name)
        // A second pick, arriving while the first is still reading.
        if (f.name === "b") live = false
        return Promise.resolve(true)
      },
      () => live,
    )
    expect(seen).toEqual(["a", "b"])
    expect(r).toEqual({ skipped: 0, firstErr: null })
  })
})

/** A file handle stub, which is all the read and `pickHandle` ask for. */
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

describe("chunkPicked", () => {
  it("takes the bytes from the handle, not from the stale snapshot beside it", async () => {
    const p = {
      file: file(notReadable()),
      path: "-Users-me-code-thing/s.jsonl",
      handle: fileHandle("s.jsonl", "grown"),
    }
    await expect(drink(chunkPicked(p))).resolves.toBe("grown")
  })

  it("reads the snapshot when there is no handle, as the file input hands over none", async () => {
    const p = { file: file("typed in"), path: "s.jsonl" }
    await expect(drink(chunkPicked(p))).resolves.toBe("typed in")
  })

  it("fails rather than falling back when the handle will not open", async () => {
    const p = {
      file: file("stale"),
      path: "s.jsonl",
      handle: fileHandle("s.jsonl", notReadable()),
    }
    await expect(drink(chunkPicked(p))).rejects.toThrow("could not be read")
    await expect(pickedFile(p)).rejects.toThrow("could not be read")
  })

  it("carries a character split across two chunks over the join", async () => {
    /* The whole reason the bytes go through a decoder that holds state: where the pieces fall is
       the platform's business, and one will land inside a character sooner or later. */
    const p = {
      file: bytes([
        [0x63, 0x61, 0x66, 0xc3],
        [0xa9, 0x21],
      ]),
      path: "s.jsonl",
    }
    const seen: string[] = []
    for await (const chunk of chunkPicked(p)) seen.push(chunk)
    expect(seen.join("")).toBe("café!")
    expect(seen.length).toBeGreaterThan(1)
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
