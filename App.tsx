/* The whole app: an upload screen until an analysis exists, the report after.

   The analysis is component state rather than a module global because it is genuinely
   owned by this boundary -- "New file" is just dropping it, which unmounts the report and
   takes its DOM with it, instead of hiding one div and showing another. */

import { useCallback, useEffect, useState } from "react";
import type { Analysis } from "./engine.ts";
import { readHash, resetState, setState, useViewState } from "./store.ts";
import { Report } from "./Report.tsx";
import { Upload } from "./Upload.tsx";

/** Theme is an attribute on the root element, outside React's tree, because the stylesheet
 *  needs it above `body`. "system" removes the attribute rather than guessing a value --
 *  that is the un-stamped state where `prefers-color-scheme` decides. */
function useTheme(): void {
  const { theme } = useViewState();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
}

export function App(): React.JSX.Element {
  const [data, setData] = useState<Analysis | null>(null);
  useTheme();

  /* Seed from the shared link before anything paints, so a link that says "dark, table
     view, drilled into shell commands" arrives that way rather than snapping into it. */
  useEffect(() => {
    setState(readHash(location.hash));
  }, []);

  /* One function for the life of the app rather than a fresh one per render: dropping the
     analysis is the same act every time, and `setData` is already stable. */
  const reset = useCallback(() => {
    setData(null);
    resetState();
  }, []);

  return data ? <Report data={data} onReset={reset} /> : <Upload onData={setData} />;
}
