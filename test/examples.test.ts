import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderRollmark } from "../src/render.js";

const examplesDir = join(import.meta.dirname, "..", "examples");

describe("example documents", () => {
  for (const file of readdirSync(examplesDir).filter((f) => f.endsWith(".md"))) {
    it(`${file} renders with every visual block valid`, () => {
      const source = readFileSync(join(examplesDir, file), "utf8");
      const { html, blocks } = renderRollmark(source);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        if (block.type === "chart") {
          expect(block.errors, `${file} chart #${block.id}: ${JSON.stringify(block.errors)}`).toBeUndefined();
          expect(block.warnings).toEqual([]);
        }
      }
      expect(html).not.toContain("rollmark-fallback");
    });
  }
});
