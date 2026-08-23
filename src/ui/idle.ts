/* Fetching a lazy chunk before the click that needs it, without competing with the paint that
   is still going out. */

/** How long idle is allowed to not arrive; a report animating in can stay busy a while. */
const LATEST = 2000

/** Run `fn` once the browser is idle, or by `LATEST` regardless -- a background tab gets
 *  neither, since Chrome holds idle callbacks until it is on screen. */
export function onIdle(fn: () => void): void {
  const idle = globalThis.requestIdleCallback
  if (idle) idle(() => fn(), { timeout: LATEST })
  else setTimeout(fn, LATEST)
}
