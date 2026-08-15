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
