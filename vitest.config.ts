import { defineConfig } from "vitest/config";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

/* Deliberately not `vite.config.ts`: that one carries the single-file build plugins, whose
   whole job is to write `cost-report.html`. Running the tests should never be able to
   touch the deliverable. All this config needs is the JSX transform and a DOM.

   The compiler preset is the one thing worth duplicating rather than dropping: it rewrites
   every component, so a suite that ran without it would be asserting different code from
   the one that ships. */
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.tsx"],
  },
});
