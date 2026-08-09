import { describe, expect, it } from "vitest";

import { renderChartSVG } from "../src/render-svg.js";
import type { ChartSpec } from "../src/types.js";

/**
 * Full-output snapshots of every chart type. renderChartSVG is
 * deterministic, so any diff here is a deliberate visual change (review
 * and update) or an accidental one (a bug, or a d3 behavior change after
 * an upgrade). Run `vitest -u` to accept intended changes.
 */

const base = {
  version: 1 as const,
  summary: "Snapshot fixture.",
};

const CASES: Record<string, ChartSpec> = {
  "line-temporal-with-gap": {
    ...base,
    type: "line",
    title: "Daily visitors",
    x: { field: "date", type: "temporal" },
    series: [{ field: "visitors", label: "Visitors" }],
    data: [
      { date: "2026-08-01", visitors: 1240 },
      { date: "2026-08-02", visitors: null },
      { date: "2026-08-03", visitors: 1510 },
      { date: "2026-08-04", visitors: 1470 },
    ],
  },
  "bar-grouped": {
    ...base,
    type: "bar",
    title: "Tickets by area",
    x: { field: "area" },
    series: [
      { field: "opened", label: "Opened" },
      { field: "resolved", label: "Resolved" },
    ],
    data: [
      { area: "Billing", opened: 34, resolved: 29 },
      { area: "Onboarding", opened: 21, resolved: 22 },
      { area: "API", opened: 45, resolved: 31 },
    ],
  },
  "bar-stacked-with-negative": {
    ...base,
    type: "bar",
    stack: true,
    x: { field: "q" },
    series: [{ field: "a" }, { field: "b" }],
    data: [
      { q: "Q1", a: 40, b: 20 },
      { q: "Q2", a: 35, b: -10 },
    ],
  },
  "area-stacked": {
    ...base,
    type: "area",
    stack: true,
    x: { field: "day" },
    series: [{ field: "api" }, { field: "jobs" }],
    data: [
      { day: "Mon", api: 91, jobs: 8 },
      { day: "Tue", api: 84, jobs: 21 },
      { day: "Wed", api: 95, jobs: 10 },
    ],
  },
  "scatter-numeric": {
    ...base,
    type: "scatter",
    title: "Price vs rating",
    x: { field: "price" },
    series: [{ field: "rating" }],
    data: [
      { price: 9.99, rating: 3.8 },
      { price: 24.5, rating: 4.4 },
      { price: 49.99, rating: 4.5 },
    ],
  },
  "pie-with-other-bucket": {
    ...base,
    type: "pie",
    title: "Subscribers",
    x: { field: "plan" },
    series: [{ field: "n" }],
    data: Array.from({ length: 10 }, (_, i) => ({ plan: `Plan ${i + 1}`, n: 1000 - i * 90 })),
  },
};

describe("renderChartSVG snapshots", () => {
  for (const [name, spec] of Object.entries(CASES)) {
    it(`${name} (light)`, () => {
      expect(renderChartSVG(spec)).toMatchSnapshot();
    });
  }
  it("dark theme variant", () => {
    expect(renderChartSVG(CASES["bar-grouped"]!, { theme: "dark" })).toMatchSnapshot();
  });
});
