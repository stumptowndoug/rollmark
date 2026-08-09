import { describe, expect, it } from "vitest";

import { PALETTES } from "../src/palettes.js";
import { renderChartSVG } from "../src/render-svg.js";
import type { ChartSpec } from "../src/types.js";

const spec: ChartSpec = {
  version: 1,
  type: "bar",
  summary: "s",
  x: { field: "k" },
  series: [{ field: "a" }, { field: "b" }],
  data: [
    { k: "A", a: 1, b: 2 },
    { k: "B", a: 3, b: 4 },
  ],
};

describe("palettes and color overrides", () => {
  it("every palette defines 8 valid hex colors per theme", () => {
    for (const def of Object.values(PALETTES)) {
      for (const variant of [def.light, def.dark]) {
        expect(variant).toHaveLength(8);
        for (const c of variant) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it("defaults to the default palette", () => {
    const svg = renderChartSVG(spec);
    expect(svg).toContain("#4E79A7");
    expect(svg).toContain("#F28E2B");
  });

  it("named palettes switch the series colors, per theme", () => {
    const light = renderChartSVG(spec, { palette: "okabe-ito", theme: "light" });
    expect(light).toContain("#0072B2");
    expect(light).not.toContain("#4E79A7");
    const dark = renderChartSVG(spec, { palette: "okabe-ito", theme: "dark" });
    expect(dark).toContain("#56B4E9"); // dark variant reorders; no black on dark
  });

  it("custom colors.series wins over a named palette and cycles", () => {
    const svg = renderChartSVG(spec, {
      palette: "muted",
      colors: { series: ["#111111"] },
    });
    expect(svg).toContain("#111111");
    expect(svg).not.toContain("#4878D0");
  });

  it("structural overrides apply independently", () => {
    const svg = renderChartSVG(spec, { colors: { grid: "#ABCDEF", text: "#123456" } });
    expect(svg).toContain('stroke="#ABCDEF"');
    // Series palette untouched.
    expect(svg).toContain("#4E79A7");
  });

  it("mono palette uses light-on-dark ordering", () => {
    const dark = renderChartSVG(spec, { palette: "monochrome", theme: "dark" });
    expect(dark).toContain("#E3F0FA"); // first series is the lightest on dark
  });
});
