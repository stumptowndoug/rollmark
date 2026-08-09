/**
 * The structured-generation arm (testing-overview.md): instead of writing the
 * whole Markdown document, the model returns a JSON object under a strict
 * json_schema response_format, and a deterministic serializer assembles the
 * Rollmark document. The result is scored by the same scorer as the direct
 * arm, so the two strategies are directly comparable.
 *
 * The response shape uses parallel arrays (x_values + per-series values)
 * rather than field-keyed rows, for two reasons learned from the first run:
 * strict-mode validators (OpenAI, Google, Anthropic) require
 * additionalProperties:false on every object, which forbids dynamic
 * field-name keys; and field-keyed rows make models responsible for keeping
 * x.field/series[].field consistent with row keys, a pure bookkeeping
 * failure mode. The serializer owns field naming instead.
 *
 * Only chart tasks run in this arm — it exists to test chart generation.
 */

import type { ChatMessage } from "./adapters.js";
import type { EvalTask } from "./tasks.js";

const STRUCTURED_CHART_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "title", "summary", "x_label", "x_temporal", "x_values", "series"],
  properties: {
    type: { type: "string", enum: ["line", "bar"] },
    title: { type: ["string", "null"], description: "Chart title, or null." },
    summary: {
      type: "string",
      description: "One or two sentences stating what the chart shows, consistent with the data.",
    },
    x_label: { type: ["string", "null"], description: "X-axis label, or null." },
    x_temporal: {
      type: "boolean",
      description: "True when x values are dates. Dates must be ISO 8601 strings.",
    },
    x_values: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        description: "X value: a category label, or an ISO 8601 date when x_temporal is true.",
      },
    },
    series: {
      // No maxItems: Anthropic's endpoint rejects it, and the runtime
      // validator enforces the 8-series limit after serialization anyway.
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "values"],
        properties: {
          label: { type: "string" },
          values: {
            type: "array",
            items: {
              type: ["number", "null"],
              description: "Y value aligned with x_values by index; null for a missing value.",
            },
          },
        },
      },
    },
  },
} as const;

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intro", "charts", "outro"],
  properties: {
    intro: {
      type: "string",
      description: "Markdown prose that opens the report. No code fences.",
    },
    charts: {
      type: "array",
      minItems: 1,
      items: STRUCTURED_CHART_SCHEMA,
    },
    outro: {
      type: ["string", "null"],
      description: "Optional Markdown prose closing the report. No code fences.",
    },
  },
} as const;

export const STRUCTURED_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "rollmark_report",
    strict: true,
    schema: REPORT_SCHEMA,
  },
} as const;

export function structuredApplicable(task: EvalTask): boolean {
  return task.expected.blockType === "chart";
}

export function structuredMessages(task: EvalTask): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You produce data reports as JSON conforming to the provided schema. " +
        "`intro` and `outro` are Markdown prose; `charts` holds chart specifications. " +
        "Each chart lists its x-axis values in `x_values` and one or more `series`, whose `values` " +
        "array aligns with `x_values` by index (use null for a missing value). " +
        'When x values are dates, set `x_temporal` to true and write ISO 8601 dates ("2026-08-01"). ' +
        "CRITICAL: use the exact numbers from the source data — never round, estimate, invent, or omit data points. " +
        "Always write a `summary` for each chart that is consistent with its data.",
    },
    { role: "user", content: `${task.request}\n\nInput data:\n\n${task.input}` },
  ];
}

interface StructuredChart {
  type: string;
  title: string | null;
  summary: string;
  x_label: string | null;
  x_temporal: boolean;
  x_values: string[];
  series: { label: string; values: (number | null)[] }[];
}

interface StructuredReport {
  intro: string;
  charts: StructuredChart[];
  outro: string | null;
}

/**
 * Deterministically assemble a Rollmark document from the structured
 * response. The serializer owns field naming (x, s0..sN); a series value
 * missing at some index becomes null — a gap per SPEC.md §2.2.
 */
export function serializeStructuredReport(raw: string): string {
  const report = JSON.parse(raw) as StructuredReport;
  const parts: string[] = [report.intro.trim()];
  for (const chart of report.charts) {
    const spec: Record<string, unknown> = {
      version: 1,
      type: chart.type,
      ...(chart.title !== null && chart.title !== undefined ? { title: chart.title } : {}),
      summary: chart.summary,
      x: {
        field: "x",
        ...(chart.x_label !== null && chart.x_label !== undefined ? { label: chart.x_label } : {}),
        ...(chart.x_temporal ? { type: "temporal" } : {}),
      },
      series: chart.series.map((s, i) => ({ field: `s${i}`, label: s.label })),
      data: chart.x_values.map((x, row) => {
        const rowObj: Record<string, unknown> = { x };
        chart.series.forEach((s, i) => {
          rowObj[`s${i}`] = s.values[row] ?? null;
        });
        return rowObj;
      }),
    };
    parts.push("```chart\n" + JSON.stringify(spec, null, 2) + "\n```");
  }
  if (report.outro !== null && report.outro !== undefined && report.outro.trim() !== "") {
    parts.push(report.outro.trim());
  }
  return parts.join("\n\n") + "\n";
}
