import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

/* Deliberately not `vite.config.ts`: that one carries the single-file build plugins, whose
   whole job is to write `cost-report.html`. Running the tests should never be able to
   touch the deliverable. All this config needs is the JSX transform and a DOM. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.tsx"],
  },
})
