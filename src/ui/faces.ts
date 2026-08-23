/* The card's two faces, fetched one at a time: the empty one carries the transcript walk and the
   folder picker, the report one carries the charts, and no visit needs both to paint. */

import { useSyncExternalStore } from "react"
import type { Dict } from "./copy.tsx"
import { onIdle } from "./idle.ts"
import type { Analysis, Dataset } from "../core/engine.ts"

/** What the card holds once there is a bill, and what stands under it. */
export interface ReportFace {
  Body: () => React.JSX.Element
  Below: () => React.JSX.Element
  /** What the eyebrow adds about the dataset -- a string rather than a component, because the
   *  line it joins is assembled in `Page`. */
  scope: (t: Dict, d: Dataset) => string
}

/** And before there is one. */
export interface IntakeFace {
  Body: (p: {
    onData: (data: Analysis, sample: boolean) => void
    sofar: React.RefObject<number>
  }) => React.JSX.Element
  Below: () => React.JSX.Element
}

export type FaceKind = "report" | "intake"

export interface Faces {
  report: ReportFace | null
  intake: IntakeFace | null
}

const held: Faces = { report: null, intake: null }
const loading: Partial<Record<FaceKind, Promise<void>>> = {}

let version = 0
const listeners = new Set<() => void>()

function announce(): void {
  version++
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Fetch a face unless it is already in hand. The promise is kept rather than the fetch repeated,
 *  because the two callers race on every turn: the page drawing the face, and the App holding the
 *  turn until it is there. */
export function loadFace(kind: FaceKind): Promise<void> {
  if (held[kind]) return Promise.resolve()
  return (loading[kind] ??= fetchFace(kind))
}

async function fetchFace(kind: FaceKind): Promise<void> {
  if (kind === "report") held.report = (await import("./FaceReport.tsx")).face
  else held.intake = (await import("./FaceIntake.tsx")).face
  announce()
}

/** The face the page is not showing, once the browser has nothing better to do: a turn is one
 *  click away in either direction, and a card that turns to an empty slot is worse than a chunk
 *  fetched and never used. */
export function prefetchFace(kind: FaceKind): void {
  onIdle(() => void loadFace(kind))
}

/** Whichever faces are in hand, re-read when one arrives. */
export function useFaces(): Faces {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  )
  return held
}
