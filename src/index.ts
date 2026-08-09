export { LIMITS } from "./limits.js";
export { validateChart, validateChartValue } from "./validate.js";
export { rollmarkPlugin } from "./markdown-it-plugin.js";
export type { RollmarkEnvState } from "./markdown-it-plugin.js";
export { renderRollmark } from "./render.js";
export type { RenderResult } from "./render.js";
export { renderChartFallback, renderMermaidFallback, escapeHtml } from "./fallback.js";
export { compileToECharts, echartsCompiler } from "./compile-echarts.js";
export type {
  ChartAxis,
  ChartCompiler,
  ChartPartial,
  ChartSeries,
  ChartSpec,
  ChartValidationResult,
  RollmarkBlock,
  ValidationIssue,
} from "./types.js";
