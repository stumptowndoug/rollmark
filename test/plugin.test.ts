import { describe, expect, it } from "vitest";

import { renderRollmark } from "../src/render.js";

const validChart = JSON.stringify({
  version: 1,
  type: "bar",
  title: "Tasks by routine",
  summary: "Reading led with 6 completions.",
  x: { field: "routine" },
  series: [{ field: "completed" }],
  data: [
    { routine: "Workout", completed: 4 },
    { routine: "Reading", completed: 6 },
  ],
});

function doc(fence: string, body: string): string {
  return `# Report\n\nSome text.\n\n\`\`\`${fence}\n${body}\n\`\`\`\n\nMore text.\n`;
}

describe("rollmarkPlugin", () => {
  it("renders ordinary fences as code blocks", () => {
    const { html, blocks } = renderRollmark(doc("python", "print('hi')"));
    expect(html).toContain("language-python");
    expect(html).toContain("print(");
    expect(blocks).toEqual([]);
  });

  it("renders unregistered fences as code blocks (forward compatibility)", () => {
    const { html, blocks } = renderRollmark(doc("metricz", "{}"));
    expect(html).toContain("<code");
    expect(blocks).toEqual([]);
  });

  it("upgrades a valid chart fence to a placeholder and registers it", () => {
    const { html, blocks } = renderRollmark(doc("chart", validChart));
    expect(html).toContain('data-rollmark-block="chart"');
    expect(html).toContain('data-rollmark-id="0"');
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.type).toBe("chart");
    if (block.type === "chart") {
      expect(block.spec?.title).toBe("Tasks by routine");
      expect(block.errors).toBeUndefined();
    }
  });

  it("treats extra info-string content as reserved and ignores it", () => {
    const { blocks } = renderRollmark(doc("chart foo=bar", validChart));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("chart");
  });

  it("renders fallback HTML inline for an invalid chart", () => {
    const bad = JSON.stringify({
      version: 1,
      type: "line",
      title: "Broken chart",
      summary: "This should still appear.",
      x: { field: "day" },
      series: [{ field: "missing" }],
      data: [{ day: "Mon", completed: 2 }],
    });
    const { html, blocks } = renderRollmark(doc("chart", bad));
    expect(html).toContain("rollmark-fallback");
    expect(html).toContain("Chart could not be rendered");
    expect(html).toContain("Broken chart");
    expect(html).toContain("This should still appear.");
    expect(html).toContain("View chart specification");
    const block = blocks[0]!;
    if (block.type === "chart") {
      expect(block.errors?.[0]?.code).toBe("field-not-found");
      expect(block.spec).toBeUndefined();
    }
  });

  it("escapes HTML inside fallback source (untrusted input)", () => {
    const { html } = renderRollmark(doc("chart", `{"version": "<script>alert(1)</script>"}`));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps the rest of the document rendering around a failed block", () => {
    const { html } = renderRollmark(doc("chart", "{ not json"));
    expect(html).toContain("<h1>Report</h1>");
    expect(html).toContain("More text.");
    expect(html).toContain("rollmark-fallback");
  });

  it("registers mermaid fences as placeholders", () => {
    const { html, blocks } = renderRollmark(doc("mermaid", "flowchart LR\n  A --> B"));
    expect(html).toContain('data-rollmark-block="mermaid"');
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.type).toBe("mermaid");
    expect(block.source).toContain("A --> B");
  });

  it("assigns sequential ids across mixed blocks", () => {
    const source =
      doc("chart", validChart) + "\n" + doc("mermaid", "flowchart LR\n  A --> B");
    const { html, blocks } = renderRollmark(source);
    expect(blocks.map((b) => b.id)).toEqual([0, 1]);
    expect(html).toContain('data-rollmark-id="0"');
    expect(html).toContain('data-rollmark-id="1"');
  });

  it("escapes raw HTML in the document (untrusted input)", () => {
    const { html } = renderRollmark("hello <script>alert(1)</script> world\n");
    expect(html).not.toContain("<script>");
  });
});
