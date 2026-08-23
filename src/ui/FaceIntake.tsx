/* The empty face: the folder picker, the walk it feeds, and the help for finding the transcripts
   in the first place -- all of it dead weight to a report the CLI handed over. */

import { Intake, Where } from "./Upload.tsx"
import type { IntakeFace } from "./faces.ts"

export const face: IntakeFace = { Body: Intake, Below: Where }
