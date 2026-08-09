import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        results: resolve(import.meta.dirname, "results.html"),
      },
    },
  },
  server: {
    fs: {
      // The viewer globs ../evals/results/*.json and the playground imports
      // ../examples/*.md — allow serving from the repo root.
      allow: [".."],
    },
  },
});
