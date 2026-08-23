/* What the DOM types are missing. */

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

interface DataTransferItem {
  /** Chrome and Edge only, and the reason a dropped store can be read from a live handle rather
   *  than from a snapshot; the others hand over a `FileSystemEntry` instead. */
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
}
