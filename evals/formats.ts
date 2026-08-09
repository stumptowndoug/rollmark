/**
 * Chart payload syntax candidates for the format A/B eval. All formats map
 * to the same semantic model (ChartSpec) and share the same validator —
 * only the surface syntax inside the ```chart fence differs.
 *
 *   json    — the current SPEC.md v1 payload (baseline)
 *   dsl     — key: value front-matter + a pipe table (row-oriented data)
 *   yaml    — the JSON schema expressed as YAML (same structure, less noise)
 *   arrays  — mermaid-xychart-style parallel arrays (tests data locality)
 */

import { parse as parseYaml } from "yaml";

import { parseChartDsl } from "../src/parse-dsl.js";
import { validateChart, validateChartValue } from "../src/validate.js";
import type { ChartValidationResult } from "../src/types.js";

export type FormatId = "json" | "dsl" | "yaml" | "arrays";

export interface ChartFormat {
  id: FormatId;
  /** Chart-syntax section of the system prompt, including one example. */
  promptSection: string;
  /** Validate a fence body written in this syntax. */
  validate(source: string): ChartValidationResult;
}

function parseError(message: string): ChartValidationResult {
  return { ok: false, errors: [{ code: "parse-error", message }], warnings: [], partial: {} };
}

/** Error codes that mean "the payload didn't parse at all". */
export const PARSE_ERROR_CODES = new Set(["invalid-json", "not-an-object", "parse-error"]);

// ---------------------------------------------------------------------------
// Cell coercion shared by dsl and arrays
// ---------------------------------------------------------------------------

function coerceCell(text: string): number | string | null {
  if (text === "" || text === "null") return null;
  const grouped = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replace(/,/g, "") : text;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(grouped)) return Number(grouped);
  return text;
}

// ---------------------------------------------------------------------------
// arrays: mermaid-xychart-style parallel arrays
// ---------------------------------------------------------------------------

const ARRAYS_META_KEYS = new Set(["type", "title", "summary", "x-type", "x-label"]);

function parseArrays(source: string): ChartValidationResult {
  const meta: Record<string, string> = {};
  const seriesLines: { name: string; values: string }[] = [];
  let xLine: string | undefined;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) return parseError(`unrecognized line: "${line.slice(0, 60)}"`);
    const key = m[1]!.trim();
    const lower = key.toLowerCase();
    if (lower === "x") xLine = m[2]!.trim();
    else if (ARRAYS_META_KEYS.has(lower)) meta[lower] = m[2]!.trim();
    else seriesLines.push({ name: key, values: m[2]!.trim() });
  }
  if (xLine === undefined) return parseError(`missing "x:" line with the axis values`);
  if (seriesLines.length === 0) {
    return parseError("expected at least one series line like `Revenue: 1, 2, 3`");
  }

  const xValues = xLine.split(",").map((v) => coerceCell(v.trim()) ?? v.trim());
  const series = seriesLines.map((s) => ({
    field: s.name,
    values: s.values.split(",").map((v) => coerceCell(v.trim())),
  }));

  const data = xValues.map((x, i) => {
    const row: Record<string, unknown> = { __x: x };
    for (const s of series) row[s.field] = s.values[i] ?? null;
    return row;
  });

  return validateChartValue({
    version: 1,
    ...(meta.type !== undefined ? { type: meta.type } : {}),
    ...(meta.title !== undefined ? { title: meta.title } : {}),
    ...(meta.summary !== undefined ? { summary: meta.summary } : {}),
    x: {
      field: "__x",
      ...(meta["x-label"] !== undefined ? { label: meta["x-label"] } : {}),
      ...(meta["x-type"] === "temporal" ? { type: "temporal" } : {}),
    },
    series: series.map((s) => ({ field: s.field })),
    data,
  });
}

// ---------------------------------------------------------------------------
// yaml: the JSON schema in YAML syntax
// ---------------------------------------------------------------------------

function parseYamlChart(source: string): ChartValidationResult {
  let value: unknown;
  try {
    value = parseYaml(source);
  } catch (cause) {
    return parseError(
      `payload is not well-formed YAML: ${cause instanceof Error ? cause.message : cause}`,
    );
  }
  return validateChartValue(value);
}

// ---------------------------------------------------------------------------
// Prompt sections (one example each, same data, same rule structure)
// ---------------------------------------------------------------------------

const SHARED_RULES = `
Rules that always apply:
- \`type\` is "line" (trends over an ordered axis) or "bar" (category comparisons).
- Always include a \`summary\`: one or two sentences stating what the chart shows, consistent with the data.
- CRITICAL: use the exact numbers from the source data. Never round, estimate, invent, or omit data points.
- Do not add colors, sizes, or styling — presentation is handled by the renderer.`;

const FORMATS: Record<FormatId, ChartFormat> = {
  json: {
    id: "json",
    validate: validateChart,
    promptSection: `The payload is a single JSON object:

\`\`\`chart
{
  "version": 1,
  "type": "line",
  "title": "Daily visitors",
  "summary": "Daily visitors grew from 1,240 to 1,510 over three days.",
  "x": { "field": "date", "label": "Date", "type": "temporal" },
  "series": [{ "field": "visitors", "label": "Visitors" }],
  "data": [
    { "date": "2026-08-01", "visitors": 1240 },
    { "date": "2026-08-02", "visitors": 1380 },
    { "date": "2026-08-03", "visitors": 1510 }
  ]
}
\`\`\`

Format rules:
- "version" is always 1. "x.field" names the field providing x values; set "x.type" to "temporal" when x values are ISO 8601 dates, otherwise omit it.
- "series" lists 1–8 fields to plot. Series values in data rows are numbers, or null for a missing value.
- "data" holds 1–1,000 rows as flat JSON objects whose keys match x.field and the series fields.
${SHARED_RULES}`,
  },
  dsl: {
    id: "dsl",
    validate: parseChartDsl,
    promptSection: `The payload starts with the chart type on its own line, then optional \`key: value\` lines, then a pipe-separated data table:

\`\`\`chart
line
title: Daily visitors
summary: Daily visitors grew from 1,240 to 1,510 over three days.

date | visitors
2026-08-01 | 1240
2026-08-02 | 1380
2026-08-03 | 1510
\`\`\`

Format rules:
- The first line is the chart type: line, bar, area, scatter, or pie. Add \`stack: true\` for stacked bars or areas.
- The first table column is the x-axis; every additional column is a series (1–8). Column headers are the labels.
- Each data row is ONE x-axis entry — one date or one category. For category comparisons the categories go down the first column, one per row (e.g. \`channel | visitors\` with a row per channel) — never across the header.
- Write dates as ISO 8601 (2026-08-01); the axis is treated as time automatically.
- Series cells are numbers; leave a cell empty for a missing value. Pie charts take exactly one value column.
${SHARED_RULES}`,
  },
  yaml: {
    id: "yaml",
    validate: parseYamlChart,
    promptSection: `The payload is a single YAML document:

\`\`\`chart
version: 1
type: line
title: Daily visitors
summary: Daily visitors grew from 1,240 to 1,510 over three days.
x:
  field: date
  label: Date
  type: temporal
series:
  - field: visitors
    label: Visitors
data:
  - date: "2026-08-01"
    visitors: 1240
  - date: "2026-08-02"
    visitors: 1380
  - date: "2026-08-03"
    visitors: 1510
\`\`\`

Format rules:
- \`version\` is always 1. \`x.field\` names the field providing x values; set \`x.type\` to \`temporal\` when x values are ISO 8601 dates, otherwise omit it. Quote date strings.
- \`series\` lists 1–8 fields to plot. Series values in data rows are numbers, or null for a missing value.
- \`data\` holds 1–1,000 rows as flat maps whose keys match \`x.field\` and the series fields.
${SHARED_RULES}`,
  },
  arrays: {
    id: "arrays",
    validate: parseArrays,
    promptSection: `The payload lists the x-axis values and each series as comma-separated arrays aligned by position:

\`\`\`chart
type: line
title: Daily visitors
summary: Daily visitors grew from 1,240 to 1,510 over three days.
x-type: temporal
x: 2026-08-01, 2026-08-02, 2026-08-03
Visitors: 1240, 1380, 1510
\`\`\`

Format rules:
- The \`x:\` line holds the axis values — the dates OR the category names (e.g. \`x: Billing, Onboarding, API\`). Every other \`Name: v1, v2, ...\` line is one measured series (1–8); the name is the label.
- Never write one line per category — categories belong on the \`x:\` line, and each series line holds that measure's value for every x entry.
- Series values align with the x values by position and must have the same count; write null for a missing value.
- Include \`x-type: temporal\` only when x values are ISO 8601 dates; omit it for categories.
${SHARED_RULES}`,
  },
};

export function getFormat(id: string): ChartFormat {
  const format = FORMATS[id as FormatId];
  if (!format) {
    throw new Error(`unknown format "${id}"; known: ${Object.keys(FORMATS).join(", ")}`);
  }
  return format;
}

export function buildFormatSystemPrompt(format: ChartFormat): string {
  return `Write your report as a Markdown document. Reply with the document itself — never wrap your whole response in a code fence, or the visual blocks inside it will not render.

For quantitative data — values that compare or change — include a \`\`\`chart fenced block. ${format.promptSection}

For relationships and structure (workflows, dependencies, sequences, schedules) use a \`\`\`mermaid fenced block instead, preferring stable diagram types (flowchart, sequenceDiagram, stateDiagram, gantt, timeline, pie).

Only add a visual block when it genuinely aids understanding; a handful of values is better stated in a sentence or a small Markdown table.`;
}

/**
 * Rewrite each ```chart fence body to canonical JSON when it validates in
 * the given syntax, so format-run documents render in the standard viewer.
 */
export function transcodeChartFences(
  document: string,
  validate: (source: string) => ChartValidationResult,
): string {
  const lines = document.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  let buffer: string[] = [];
  for (const line of lines) {
    if (fence === null) {
      const m = line.match(/^(\s*)(`{3,}|~{3,})\s*chart\b.*$/);
      if (m) {
        fence = m[2]!;
        out.push(`${m[1]}${m[2]}chart`);
        buffer = [];
      } else {
        out.push(line);
      }
    } else if (line.trim().startsWith(fence)) {
      const result = validate(buffer.join("\n"));
      out.push(result.ok ? JSON.stringify(result.spec, null, 2) : buffer.join("\n"));
      out.push(line);
      fence = null;
    } else {
      buffer.push(line);
    }
  }
  if (fence !== null) out.push(...buffer);
  return out.join("\n");
}
