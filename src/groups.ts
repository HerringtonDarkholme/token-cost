/* The nine groups, kept apart from the walk that fills them: the dictionary needs their names on
   every page, and the walk is fetched only where a folder is being read. */

/** The nine stable group identities. */
export type GroupId =
  | "shell"
  | "ingest"
  | "emit"
  | "twoway"
  | "output"
  | "preamble"
  | "harness"
  | "media"
  | "typed"

export interface GroupDef {
  id: GroupId
  name: string
  short: string
}

export const GROUPS: GroupDef[] = [
  { id: "shell", name: "Shell commands", short: "Shell" },
  { id: "ingest", name: "Tools · content read in", short: "Read in" },
  { id: "emit", name: "Tools · content written out", short: "Written out" },
  { id: "twoway", name: "Tools · two-way", short: "Two-way" },
  { id: "output", name: "Model output", short: "Output" },
  { id: "preamble", name: "System prompt & tool schemas", short: "System prompt" },
  { id: "harness", name: "Harness & reminders", short: "Harness" },
  { id: "media", name: "Images & attachments", short: "Media" },
  { id: "typed", name: "My typing", short: "My typing" },
]
