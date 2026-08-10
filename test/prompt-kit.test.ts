import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { promptKit } from "../src/prompts.js";

const md = readFileSync(
  join(import.meta.dirname, "..", "prompt-kit", "system-prompt.md"),
  "utf8",
);

function between(marker: string): string {
  const m = md.match(new RegExp(`---BEGIN ${marker}---\\n([\\s\\S]*?)\\n---END ${marker}---`));
  if (!m) throw new Error(`missing ${marker} markers`);
  return m[1]!;
}

describe("prompt kit sections", () => {
  it("the markdown file and the exports are identical (no drift)", () => {
    expect(between("FORMAT")).toBe(promptKit.format);
    expect(between("PREAMBLE")).toBe(promptKit.preamble);
  });

  it("full composes preamble + format", () => {
    expect(promptKit.full).toBe(`${promptKit.preamble}\n\n${promptKit.format}`);
  });

  it("the format contract is renderer-scoped: no document guidance inside", () => {
    expect(promptKit.format).not.toContain("Write your report");
    expect(promptKit.format.startsWith("Never wrap your whole response in a code fence")).toBe(
      true,
    );
  });

  it("the format contract carries every eval-derived rule", () => {
    for (const rule of [
      "ALWAYS a header row",           // omitted-header pie failure
      "never across the header",       // categorical transposition
      "exact numbers from the source", // data fidelity
      "never chart one or two values", // chart restraint
      "summary:",                      // summary requirement
      "stack: true",
    ]) {
      expect(promptKit.format).toContain(rule);
    }
  });
});
