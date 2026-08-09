import { describe, expect, it } from "vitest";

import { renderChartSVG } from "../src/render-svg.js";
import type { ChartSpec } from "../src/types.js";

function spec(overrides: Partial<ChartSpec>): ChartSpec {
  return {
    version: 1,
    type: "bar",
    summary: "Test chart.",
    x: { field: "k" },
    series: [{ field: "v", label: "Value" }],
    data: [
      { k: "A", v: 10 },
      { k: "B", v: 20 },
      { k: "C", v: 15 },
    ],
    ...overrides,
  };
}

function count(svg: string, pattern: RegExp): number {
  return (svg.match(pattern) ?? []).length;
}

describe("renderChartSVG", () => {
  it("renders a bar chart with one rect per value and accessible labeling", () => {
    const svg = renderChartSVG(spec({ title: "By key" }));
    expect(svg).toContain("<svg");
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="By key. Test chart."');
    expect(count(svg, /<rect(?![^>]*rx=)/g)).toBe(3); // bars (legend swatches have rx)
    expect(svg).toContain("By key");
    expect(svg).toContain("</svg>");
  });

  it("renders grouped and stacked multi-series bars", () => {
    const multi = spec({
      series: [{ field: "a" }, { field: "b" }],
      data: [
        { k: "A", a: 1, b: 2 },
        { k: "B", a: 3, b: -1 },
      ],
    });
    const grouped = renderChartSVG(multi);
    expect(count(grouped, /<rect(?![^>]*rx=)/g)).toBe(4);
    const stacked = renderChartSVG({ ...multi, stack: true });
    expect(count(stacked, /<rect(?![^>]*rx=)/g)).toBe(4); // diverging stack handles the negative
    expect(stacked).toContain("B · a: 3");
  });

  it("renders lines with gaps (two path segments around a null)", () => {
    const svg = renderChartSVG(
      spec({
        type: "line",
        data: [
          { k: "2026-08-01", v: 1 },
          { k: "2026-08-02", v: null },
          { k: "2026-08-03", v: 3 },
        ],
      }),
    );
    expect(svg).toContain('stroke-width="2"');
    expect(count(svg, /<circle/g)).toBe(2); // point markers skip the gap
  });

  it("renders temporal axes with time ticks", () => {
    const svg = renderChartSVG(
      spec({
        type: "line",
        x: { field: "k", type: "temporal" },
        data: [
          { k: "2026-08-01", v: 1 },
          { k: "2026-08-05", v: 3 },
        ],
      }),
    );
    expect(svg).toMatch(/Aug \d/);
  });

  it("renders area, scatter, and pie without errors", () => {
    expect(renderChartSVG(spec({ type: "area" }))).toContain("fill-opacity");
    expect(
      renderChartSVG(
        spec({
          type: "scatter",
          data: [
            { k: 1, v: 2 },
            { k: 3, v: 4 },
          ],
        }),
      ),
    ).toContain("<circle");
    const pie = renderChartSVG(
      spec({
        type: "pie",
        data: [
          { k: "Free", v: 9120 },
          { k: "Pro", v: 2480 },
        ],
      }),
    );
    expect(count(pie, /<path/g)).toBe(2);
    expect(pie).toContain("79%"); // 9120 / 11600
  });

  it("buckets pie tails into Other", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ k: `S${i}`, v: 100 - i }));
    const svg = renderChartSVG(spec({ type: "pie", data: rows }));
    expect(svg).toContain("Other");
    expect(count(svg, /<path/g)).toBe(8);
  });

  it("supports the dark theme", () => {
    const svg = renderChartSVG(spec({ title: "Dark" }), { theme: "dark" });
    expect(svg).toContain("#e5e7eb"); // dark text on the title
    expect(svg).toContain("#9ca3af"); // dark muted ticks
  });

  it("escapes untrusted text in titles and labels", () => {
    const svg = renderChartSVG(
      spec({ title: '<script>"x"</script>', data: [{ k: "<b>", v: 1 }] }),
    );
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});
