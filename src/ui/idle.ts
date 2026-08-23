/* Fetching a chunk before it is asked for, without competing with the paint that is still going
   out: everything lazy here is one click away, and a click that waits on a fetch is a click the
   reader feels. */

/** How long idle is allowed to not arrive. A report is several charts animating in, so "quiet"
 *  can be a while coming -- and a prefetch that never runs is worse than one that runs early. */
const LATEST = 2000

/** Run `fn` once the browser has nothing better to do, or by `LATEST` regardless. A tab nobody is
 *  looking at gets neither: Chrome holds idle callbacks until it is on screen again, which is the
 *  right answer for work done on the chance of a click. */
export function onIdle(fn: () => void): void {
  const idle = globalThis.requestIdleCallback
  if (idle) idle(() => fn(), { timeout: LATEST })
  else setTimeout(fn, LATEST)
}
