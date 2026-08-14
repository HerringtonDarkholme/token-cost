/* What the DOM types are missing.

   `FileSystemDirectoryHandle` is declared in `lib.dom` -- the walk in `Upload.tsx` typechecks
   against the real thing -- but the call that hands one over is not, because the File System
   Access API is not on a standards track every browser has signed up to. Declared here rather
   than cast at the call site, so the options bag is checked: `startIn` in particular takes a
   fixed set of words, and a wrong one is a `TypeError` at the picker rather than a red squiggle.

   Feature-detected before it is called, and every call sits in a `try` -- see `pickFolder`. A
   declaration says what the function looks like if it is there, not that it is. */

declare function showDirectoryPicker(options?: {
  /** Remembers a directory per key, so the next pick opens where the last one ended. */
  id?: string
  mode?: "read" | "readwrite"
  startIn?:
    | FileSystemHandle
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos"
}): Promise<FileSystemDirectoryHandle>
