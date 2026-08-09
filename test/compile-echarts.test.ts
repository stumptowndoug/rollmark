import { describe, expect, it } from "vitest";

import { compileToECharts } from "../src/compile-echarts.js";
import type { ChartSpec } from "../src/types.js";

const categorySpec: ChartSpec = {
  version: 1,
  type: "bar",
  title: "Tasks by routine",
  summary: "Reading led with 6.",
  x: { field: "routine", label: "Routine" },
  series: [
    { field: "completed", label: "Completed" },
    { field: "skipped" },
  ],
  data: [
    { routine: "Workout", completed: 4, skipped: 1 },
    { routine: "Reading", completed: 6, skipped: 0 },
  ],
};

describe("compileToECharts", () => {
  it("compiles a category chart", () => {
    const option = compileToECharts(categorySpec) as any;
    expect(option.xAxis).toEqual({
      type: "category",
      name: "Routine",
      data: ["Workout", "Reading"],
    });
    expect(option.series).toHaveLength(2);
    expect(option.series[0]).toMatchObject({
      name: "Completed",
      type: "bar",
      data: [4, 6],
    });
    expect(option.series[1].name).toBe("skipped");
    expect(option.title).toEqual({ text: "Tasks by routine" });
    expect(option.legend).toEqual({});
    expect(option.aria.label.description).toBe("Reading led with 6.");
  });

  it("compiles a temporal chart as [x, y] pairs on a time axis", () => {
    const spec: ChartSpec = {
      version: 1,
      type: "line",
      x: { field: "date", type: "temporal" },
      series: [{ field: "visitors" }],
      data: [
        { date: "2026-08-01", visitors: 1240 },
        { date: "2026-08-02", visitors: null },
        { date: "2026-08-03", visitors: 1510 },
      ],
    };
    const option = compileToECharts(spec) as any;
    expect(option.xAxis.type).toBe("time");
    expect(option.series[0].data).toEqual([
      ["2026-08-01", 1240],
      ["2026-08-02", null],
      ["2026-08-03", 1510],
    ]);
    expect(option.series[0].connectNulls).toBe(false);
    expect(option.title).toBeUndefined();
    expect(option.legend).toBeUndefined();
  });

  it("renders missing row values as null gaps", () => {
    const spec: ChartSpec = {
      version: 1,
      type: "line",
      x: { field: "day" },
      series: [{ field: "value" }],
      data: [{ day: "Mon", value: 1 }, { day: "Tue" }],
    };
    const option = compileToECharts(spec) as any;
    expect(option.series[0].data).toEqual([1, null]);
  });
});
