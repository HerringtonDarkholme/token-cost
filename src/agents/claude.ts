/* Claude Code transcripts are the record shape the walk reads, so what is left here is only the
   two places the format spells something in its own hand. */

import type { TranscriptRecord } from "../engine.ts"

type Out = (rec: TranscriptRecord) => void

const SESSION_RE = /"sessionId"\s*:\s*"([^"]+)"/

/** The session a transcript belongs to, or null for a file that names none -- which is what the
 *  other stores' files look like from here. */
export function claudeSession(head: string): string | null {
  const m = SESSION_RE.exec(head)
  return m ? m[1] : null
}

/** One line of a transcript. `false` is a line that did not parse, which the bill admits to
 *  rather than passing off as an empty record. */
export function claudeLine(line: string, out: Out): boolean {
  let rec: TranscriptRecord | null = null
  try {
    rec = JSON.parse(line) as TranscriptRecord
  } catch {
    return false
  }
  if (rec && typeof rec === "object") out(rec)
  return true
}
