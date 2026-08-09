import { compileToECharts } from "../src/compile-echarts.js";
import { renderRollmark } from "../src/render.js";
import type { ChartSpec, RollmarkBlock } from "../src/types.js";
import type { EvalTask } from "./tasks.js";

/**
 * Per-attempt metric results. `null` means not applicable to this task
 * (e.g. jsonValid for a mermaid task) — aggregation skips nulls.
 */
export interface MetricResults {
  markdownValid: boolean;
  blockDetected: boolean;
  jsonValid: boolean | null;
  schemaValid: boolean | null;
  chartTypeOk: boolean | null;
  dataFidelity: boolean | null;
  hasTitle: boolean | null;
  hasSummary: boolean | null;
  renderOk: boolean | null;
  /**
   * Summary-vs-data consistency, filled in post-hoc by the LLM judge when
   * one is configured. Reported separately; never affects `pass`.
   */
  summaryConsistent: boolean | null;
  /** All applicable metrics passed. */
  pass: boolean;
  /** Human-readable problems, used for the repair prompt and reports. */
  issues: string[];
  /** Validator warnings (unknown properties etc.) across chart blocks. */
  warningCount: number;
}

export const METRIC_KEYS = [
  "markdownValid",
  "blockDetected",
  "jsonValid",
  "schemaValid",
  "chartTypeOk",
  "dataFidelity",
  "hasTitle",
  "hasSummary",
  "renderOk",
  "summaryConsistent",
] as const satisfies readonly (keyof MetricResults)[];

/**
 * Issues a producer could see for itself (validation output, block presence).
 * Only these justify a repair attempt — fidelity failures are invisible to
 * the model and repairing them would leak the expected answer.
 */
export function repairableIssues(m: MetricResults): string[] {
  return m.issues.filter((issue) => !issue.startsWith("[hidden]"));
}

function normalizeX(value: unknown, temporal: boolean | undefined): string {
  if (temporal) {
    const s = String(value);
    // Compare on the date part; models legitimately emit either 2026-08-01
    // or 2026-08-01T00:00:00Z.
    return s.slice(0, 10);
  }
  return String(value).trim().toLowerCase();
}

interface ActualSeries {
  x: unknown[];
  y: (number | null)[];
}

function extractSeries(spec: ChartSpec): ActualSeries[] {
  return spec.series.map((s) => ({
    x: spec.data.map((row) => row[spec.x.field]),
    y: spec.data.map((row) => {
      const v = row[s.field];
      return v === undefined || v === null ? null : (v as number);
    }),
  }));
}

function seriesEqual(
  expected: (number | null)[],
  actual: ActualSeries,
  expectedX: (string | number)[] | undefined,
  temporal: boolean | undefined,
): boolean {
  if (!expectedX || expectedX.length === 0) {
    // No x expectation: y sequences must match in order.
    if (actual.y.length !== expected.length) return false;
    return expected.every((v, i) => actual.y[i] === v);
  }
  // Match by x: build x → y and look up each expected x in order. A null
  // expectation is satisfied by an explicit null or an omitted row.
  const map = new Map<string, number | null>();
  for (const [i, x] of actual.x.entries()) {
    map.set(normalizeX(x, temporal), actual.y[i] ?? null);
  }
  if (actual.y.length > expectedX.length) return false; // invented rows
  return expected.every((v, i) => {
    const key = normalizeX(expectedX[i], temporal);
    const got = map.has(key) ? map.get(key)! : null;
    return got === v || (v === null && !map.has(key));
  });
}

/** Order-flexible series matching: each expected series must find a distinct actual match. */
function fidelityOk(
  task: EvalTask,
  specs: ChartSpec[],
): { ok: boolean; detail?: string } {
  const expected = task.expected.series;
  if (!expected || expected.length === 0) return { ok: true };
  const actual = specs.flatMap(extractSeries);
  if (actual.length !== expected.length) {
    return { ok: false, detail: `expected ${expected.length} series, found ${actual.length}` };
  }
  const used = new Set<number>();
  for (const [i, exp] of expected.entries()) {
    const match = actual.findIndex(
      (a, j) => !used.has(j) && seriesEqual(exp.values, a, task.expected.xValues, task.expected.temporal),
    );
    if (match === -1) {
      return { ok: false, detail: `no series matches expected values for series ${i}` };
    }
    used.add(match);
  }
  return { ok: true };
}

export function scoreDocument(task: EvalTask, document: string): MetricResults {
  const issues: string[] = [];
  let blocks: RollmarkBlock[] = [];
  let markdownValid = true;
  try {
    blocks = renderRollmark(document).blocks;
  } catch (cause) {
    markdownValid = false;
    issues.push(`document failed to render: ${cause instanceof Error ? cause.message : cause}`);
  }

  const charts = blocks.filter((b) => b.type === "chart");
  const mermaids = blocks.filter((b) => b.type === "mermaid");
  const na: MetricResults = {
    markdownValid,
    blockDetected: false,
    jsonValid: null,
    schemaValid: null,
    chartTypeOk: null,
    dataFidelity: null,
    hasTitle: null,
    hasSummary: null,
    renderOk: null,
    summaryConsistent: null,
    pass: false,
    issues,
    warningCount: 0,
  };

  if (task.expected.blockType === "none") {
    na.blockDetected = charts.length === 0;
    if (!na.blockDetected) issues.push("[hidden] emitted a chart where none was warranted");
    na.pass = markdownValid && na.blockDetected;
    return na;
  }

  if (task.expected.blockType === "mermaid") {
    na.blockDetected = mermaids.length > 0;
    if (!na.blockDetected) issues.push("no mermaid diagram block was found in the document");
    na.pass = markdownValid && na.blockDetected;
    return na;
  }

  // Chart task.
  const minCharts = task.expected.minCharts ?? 1;
  na.blockDetected = charts.length >= minCharts;
  if (!na.blockDetected) {
    issues.push(
      charts.length === 0
        ? "no ```chart fenced block was found in the document"
        : `expected at least ${minCharts} chart blocks, found ${charts.length}`,
    );
    return na;
  }

  na.warningCount = charts.reduce((n, c) => n + (c.type === "chart" ? c.warnings.length : 0), 0);

  na.jsonValid = charts.every(
    (c) => c.type === "chart" && !(c.errors ?? []).some((e) => e.code === "invalid-json"),
  );
  if (!na.jsonValid) issues.push("a chart payload is not well-formed JSON");

  const specs = charts.flatMap((c) => (c.type === "chart" && c.spec ? [c.spec] : []));
  na.schemaValid = specs.length === charts.length;
  if (!na.schemaValid) {
    for (const c of charts) {
      if (c.type === "chart" && c.errors) {
        for (const e of c.errors) issues.push(`chart validation error: ${e.message}`);
      }
    }
    return na;
  }

  na.chartTypeOk = task.expected.chartTypes
    ? specs.every((s) => task.expected.chartTypes!.includes(s.type))
    : true;
  if (!na.chartTypeOk) {
    issues.push(`[hidden] chart type ${specs.map((s) => s.type).join(", ")} not among ${task.expected.chartTypes!.join("/")}`);
  }

  const fidelity = fidelityOk(task, specs);
  na.dataFidelity = fidelity.ok;
  if (!fidelity.ok) issues.push(`[hidden] data fidelity: ${fidelity.detail}`);

  na.hasTitle = specs.every((s) => Boolean(s.title));
  na.hasSummary = specs.every((s) => Boolean(s.summary));
  if (!na.hasSummary) issues.push('a chart block is missing its "summary" field');

  na.renderOk = specs.every((s) => {
    try {
      compileToECharts(s);
      return true;
    } catch (cause) {
      issues.push(`chart failed to compile: ${cause instanceof Error ? cause.message : cause}`);
      return false;
    }
  });

  // hasTitle is tracked but not required: title is optional in SPEC.md §2.2.
  na.pass =
    markdownValid &&
    na.blockDetected &&
    na.jsonValid &&
    na.schemaValid &&
    na.chartTypeOk &&
    na.dataFidelity &&
    na.hasSummary &&
    na.renderOk;
  return na;
}
