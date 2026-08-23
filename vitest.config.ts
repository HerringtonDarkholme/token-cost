import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

/* Deliberately not `vite.config.ts`: that one writes `cost-report.html`, and running the tests
   must not be able to touch the deliverable. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.tsx"],
  },
})
