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
    const m = await mountRollmarkDocument(container, doc, { theme: "light" });
    expect(container.querySelector(".rollmark-chart-svg")).toBeTruthy();
    expect(container.innerHTML).toContain("flowchart LR");
    expect(container.innerHTML).toContain("<code>");
    m.dispose();
  });

  it("shows the mermaid fallback card when rendering throws", async () => {
    const container = document.createElement("div");
    const mermaid = {
      render: vi.fn(async () => {
        throw new Error("bad diagram");
      }),
    };
    const m = await mountRollmarkDocument(container, doc, { theme: "light", mermaid });
    expect(container.innerHTML).toContain("Diagram could not be rendered: bad diagram");
    expect(container.innerHTML).toContain("flowchart LR");
    m.dispose();
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
    mounted.dispose();
  });

  it("shows a styled tooltip on mark hover and hides it on leave", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = await mountRollmarkDocument(container, doc, { theme: "light" });

    const mark = container.querySelector("[data-rm-v]")!;
    expect(mark.querySelector("title")).toBeNull(); // native title replaced

    const tipsBefore = document.querySelectorAll(".rollmark-tooltip").length;
    mark.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, clientX: 40, clientY: 40 }));
    const tips = Array.from(document.querySelectorAll<HTMLElement>(".rollmark-tooltip"));
    const tip = tips[tips.length - 1]!; // this mount's tooltip is the newest
    expect(tip.style.display).toBe("block");
    expect(tip.textContent).toContain("A · 2");

    mark.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    expect(tip.style.display).toBe("none");

    mounted.dispose();
    expect(document.querySelectorAll(".rollmark-tooltip").length).toBe(tipsBefore - 1);
    container.remove();
  });

  it("keeps native titles when tooltips are disabled", async () => {
    const container = document.createElement("div");
    const before = document.querySelectorAll(".rollmark-tooltip").length;
    await mountRollmarkDocument(container, doc, { theme: "light", tooltips: false });
    expect(container.querySelector("[data-rm-v] title")).toBeTruthy();
    expect(document.querySelectorAll(".rollmark-tooltip").length).toBe(before);
  });

  it("passes palette and color overrides through to charts", async () => {
    const container = document.createElement("div");
    const m = await mountRollmarkDocument(container, doc, {
      theme: "light",
      palette: "okabe-ito",
      colors: { grid: "#ABCDEF" },
    });
    expect(container.innerHTML).toContain("#0072B2");
    expect(container.innerHTML).toContain("#ABCDEF");
    m.dispose();
  });
});
