import type { ChartCompiler, ChartSpec } from "./types.js";

/**
 * Compile a validated chart spec into a plain ECharts option object.
 *
 * This module has no dependency on the echarts package — it emits JSON the
 * host passes to its own echarts instance. Per SPEC.md §2.4 the payload
 * carries no presentation properties; colors, fonts, and theming come from
 * the host's ECharts theme.
 */
export function compileToECharts(spec: ChartSpec): Record<string, unknown> {
  const temporal = spec.x.type === "temporal";
  const xLabel = spec.x.label ?? spec.x.field;

  if (spec.type === "pie") {
    const field = spec.series[0]!.field;
    return {
      aria: { enabled: true, ...(spec.summary ? { label: { description: spec.summary } } : {}) },
      ...(spec.title ? { title: { text: spec.title } } : {}),
      tooltip: { trigger: "item" },
      legend: {},
      series: [
        {
          type: "pie",
          radius: ["45%", "70%"],
          data: spec.data.map((row) => ({ name: String(row[spec.x.field]), value: row[field] })),
        },
      ],
    };
  }

  const markType = spec.type === "area" ? "line" : spec.type;
  const option: Record<string, unknown> = {
    aria: {
      enabled: true,
      ...(spec.summary ? { label: { description: spec.summary } } : {}),
    },
    tooltip: { trigger: "axis" },
    xAxis: temporal
      ? { type: "time", name: xLabel }
      : { type: "category", name: xLabel, data: spec.data.map((row) => row[spec.x.field]) },
    yAxis: { type: "value" },
    series: spec.series.map((s) => ({
      name: s.label ?? s.field,
      type: markType,
      ...(spec.type === "area" ? { areaStyle: {} } : {}),
      ...(spec.stack ? { stack: "total" } : {}),
      // null y values render as gaps, not zero (SPEC.md §2.2).
      connectNulls: false,
      data: temporal
        ? spec.data.map((row) => [row[spec.x.field], row[s.field] ?? null])
        : spec.data.map((row) => row[s.field] ?? null),
    })),
  };

  if (spec.title) {
    option.title = { text: spec.title };
  }
  if (spec.series.length > 1) {
    option.legend = {};
  }
  return option;
}

export const echartsCompiler: ChartCompiler<Record<string, unknown>> = {
  compile: compileToECharts,
};
