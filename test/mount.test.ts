// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { mountRollmarkDocument } from "../src/mount.js";

const doc = `# Report

\`\`\`chart
bar
title: Test chart
summary: A beats B.

k | v
A | 2
B | 1
\`\`\`

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;

describe("mountRollmarkDocument", () => {
  it("mounts markdown, chart SVG, and mermaid via the provided instance", async () => {
    const container = document.createElement("div");
    const mermaid = {
      initialize: vi.fn(),
      render: vi.fn(async () => ({ svg: "<svg data-mmd></svg>" })),
    };
    const mounted = await mountRollmarkDocument(container, doc, { theme: "light", mermaid });

    expect(container.querySelector("h1")?.textContent).toBe("Report");
    expect(container.querySelector(".rollmark-chart-svg")).toBeTruthy();
    expect(container.innerHTML).toContain("Test chart");
    expect(container.querySelector("[data-mmd]")).toBeTruthy();
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict" }),
    );
    expect(mounted.blocks).toHaveLength(2);
    expect(mounted.theme).toBe("light");

    mounted.dispose();
    expect(container.innerHTML).toBe("");
  });

  it("degrades mermaid blocks to code when no instance is provided", async () => {
    const container = document.createElement("div");
    await mountRollmarkDocument(container, doc, { theme: "light" });
    expect(container.querySelector(".rollmark-chart-svg")).toBeTruthy();
    expect(container.innerHTML).toContain("flowchart LR");
    expect(container.innerHTML).toContain("<code>");
  });

  it("shows the mermaid fallback card when rendering throws", async () => {
    const container = document.createElement("div");
    const mermaid = {
      render: vi.fn(async () => {
        throw new Error("bad diagram");
      }),
    };
    await mountRollmarkDocument(container, doc, { theme: "light", mermaid });
    expect(container.innerHTML).toContain("Diagram could not be rendered: bad diagram");
    expect(container.innerHTML).toContain("flowchart LR");
  });

  it("renders the chart fallback card inline for invalid charts", async () => {
    const container = document.createElement("div");
    await mountRollmarkDocument(container, "```chart\nnot a chart\n```\n", { theme: "light" });
    expect(container.innerHTML).toContain("Chart could not be rendered");
  });

  it("respects an explicit dark theme", async () => {
    const container = document.createElement("div");
    const mounted = await mountRollmarkDocument(container, doc, { theme: "dark" });
    expect(mounted.theme).toBe("dark");
    expect(container.innerHTML).toContain("#e5e7eb"); // dark text color in the SVG
  });
});
