/**
 * The structured-generation arm (testing-overview.md): instead of writing the
 * whole Markdown document, the model returns a JSON object under a strict
 * json_schema response_format, and a deterministic serializer assembles the
 * Rollmark document. The result is scored by the same scorer as the direct
 * arm, so the two strategies are directly comparable.
 *
 * Only chart tasks run in this arm — it exists to test chart generation.
 */

import type { ChatMessage } from "./adapters.js";
import type { EvalTask } from "./tasks.js";

/**
 * Strict-mode variant of the chart schema: every property required,
 * optionality expressed as nullable types (OpenAI-style strict json_schema
 * forbids optional keys). The serializer drops nulls when emitting Rollmark.
 */
const STRICT_CHART_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "type", "title", "summary", "x", "series", "data"],
  properties: {
    version: { type: "integer", enum: [1] },
    type: { type: "string", enum: ["line", "bar"] },
    title: { type: ["string", "null"], description: "Chart title, or null." },
    summary: {
      type: "string",
      description:
        "One or two sentences stating what the chart shows, consistent with the data.",
    },
    x: {
      type: "object",
      additionalProperties: false,
      required: ["field", "label", "type"],
      properties: {
        field: { type: "string" },
        label: { type: ["string", "null"] },
        type: {
          type: ["string", "null"],
          enum: ["category", "temporal", null],
          description: 'Use "temporal" with ISO 8601 x values for dates; null otherwise.',
        },
      },
    },
    series: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "label"],
        properties: {
          field: { type: "string" },
          label: { type: ["string", "null"] },
        },
      },
    },
    data: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        description:
          "One row. Keys are the field names used by x and series; series values are numbers or null.",
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
      items: STRICT_CHART_SCHEMA,
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
        "The `charts` array holds chart specifications; `intro` and `outro` are Markdown prose. " +
        "CRITICAL: use the exact numbers from the source data — never round, estimate, invent, or omit data points. " +
        "Always write a `summary` for each chart that is consistent with its data. " +
        'When x values are dates, set x.type to "temporal" and write ISO 8601 dates. ' +
        "Data rows are flat objects whose keys match x.field and each series field; series values are numbers, or null for a missing value.",
    },
    { role: "user", content: `${task.request}\n\nInput data:\n\n${task.input}` },
  ];
}

interface StructuredChart {
  version: number;
  type: string;
  title: string | null;
  summary: string;
  x: { field: string; label: string | null; type: string | null };
  series: { field: string; label: string | null }[];
  data: Record<string, unknown>[];
}

interface StructuredReport {
  intro: string;
  charts: StructuredChart[];
  outro: string | null;
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== null) out[k] = stripNulls(v);
    }
    return out;
  }
  return value;
}

/**
 * Deterministically assemble a Rollmark document from the structured
 * response. Nulls for optional fields are dropped; data-row nulls are
 * preserved (they mean "gap" per SPEC.md §2.2).
 */
export function serializeStructuredReport(raw: string): string {
  const report = JSON.parse(raw) as StructuredReport;
  const parts: string[] = [report.intro.trim()];
  for (const chart of report.charts) {
    const spec: Record<string, unknown> = {
      version: chart.version,
      type: chart.type,
      ...(chart.title !== null ? { title: chart.title } : {}),
      summary: chart.summary,
      x: stripNulls(chart.x),
      series: chart.series.map(stripNulls),
      // Preserve nulls inside rows — a null series value is a gap.
      data: chart.data,
    };
    parts.push("```chart\n" + JSON.stringify(spec, null, 2) + "\n```");
  }
  if (report.outro !== null && report.outro !== undefined && report.outro.trim() !== "") {
    parts.push(report.outro.trim());
  }
  return parts.join("\n\n") + "\n";
}
