import type { ChartValidationResult } from "./types.js";
import { validateChart, validateChartValue } from "./validate.js";

/**
 * Parser for the canonical Rollmark chart DSL (SPEC.md §2):
 *
 *   bar
 *   title: Revenue by month
 *   summary: Revenue peaked in April at $80k.
 *
 *   month | revenue
 *   Jan   | 25
 *   Feb   | 50
 *
 * Grammar:
 * - The first bare word line is the chart type (line, bar, area, scatter,
 *   pie). `type: bar` is accepted as an alternate.
 * - Meta lines are `key: value`. Known keys: title, summary, stack,
 *   x-type, x-label. Unknown keys are ignored (SPEC unknown-property rule).
 * - The data table is pipe-separated. The first column is the x-axis; every
 *   additional column is a series; headers are the labels. GFM-style outer
 *   pipes and `|---|` separator rows are tolerated.
 * - Cells: empty means a gap (null). Unquoted numeric cells become numbers
 *   (valid thousands groupings like 12,480 are stripped). Double-quoted
 *   cells are always strings and may contain pipes ("a|b", "007").
 * - x.type is inferred as temporal when every x value is an ISO 8601 date;
 *   `x-type:` overrides inference.
 */

const META_KEYS = new Set(["type", "title", "summary", "stack", "x-type", "x-label"]);
const TYPE_TOKENS = new Set(["line", "bar", "area", "scatter", "pie"]);

function parseErrorResult(message: string): ChartValidationResult {
  return { ok: false, errors: [{ code: "parse-error", message }], warnings: [], partial: {} };
}

/** Split a table row on pipes, respecting double-quoted cells. */
function splitCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if (ch === "|" && !inQuote) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function coerceCell(text: string): number | string | null {
  if (text === "" || text === "null") return null;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  const grouped = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replace(/,/g, "") : text;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(grouped)) return Number(grouped);
  return text;
}

export function parseChartDsl(source: string): ChartValidationResult {
  const meta: Record<string, string> = {};
  const tableLines: string[] = [];
  let bareType: string | undefined;

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.includes("|")) {
      // Skip GFM separator rows like | --- | --- |
      if (!/^[\s|:\-]+$/.test(line)) tableLines.push(line);
      continue;
    }
    if (bareType === undefined && tableLines.length === 0 && TYPE_TOKENS.has(line)) {
      bareType = line;
      continue;
    }
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (m) {
      const key = m[1]!.toLowerCase();
      if (META_KEYS.has(key)) meta[key] = m[2]!.trim();
      // Unknown meta keys are ignored, mirroring the unknown-property rule.
      continue;
    }
    return parseErrorResult(`unrecognized line outside the table: "${line.slice(0, 60)}"`);
  }

  if (tableLines.length < 2) {
    return parseErrorResult("expected a data table: a header row plus at least one data row");
  }

  const headerRaw = tableLines[0]!;
  const leading = headerRaw.startsWith("|");
  const trailing = headerRaw.endsWith("|");
  const splitRow = (line: string): string[] => {
    let cells = splitCells(line);
    if (leading && cells[0] === "") cells = cells.slice(1);
    if (trailing && cells[cells.length - 1] === "") cells = cells.slice(0, -1);
    return cells;
  };

  const header = splitRow(headerRaw).map((h) =>
    h.length >= 2 && h.startsWith('"') && h.endsWith('"') ? h.slice(1, -1) : h,
  );
  if (header.length < 2) {
    return parseErrorResult("the table needs at least two columns: an x column and one series column");
  }

  const data = tableLines.slice(1).map((line) => {
    const cells = splitRow(line);
    const row: Record<string, unknown> = {};
    header.forEach((name, i) => {
      const cell = cells[i] ?? "";
      row[name] = i === 0 ? (coerceCell(cell) ?? cell) : coerceCell(cell);
    });
    return row;
  });

  const type = bareType ?? meta.type;
  let stack: boolean | string | undefined;
  if (meta.stack !== undefined) {
    stack = meta.stack === "true" ? true : meta.stack === "false" ? false : meta.stack;
  }

  return validateChartValue({
    version: 1,
    ...(type !== undefined ? { type } : {}),
    ...(meta.title !== undefined ? { title: meta.title } : {}),
    ...(meta.summary !== undefined ? { summary: meta.summary } : {}),
    ...(stack !== undefined ? { stack } : {}),
    x: {
      field: header[0]!,
      ...(meta["x-label"] !== undefined ? { label: meta["x-label"] } : {}),
      ...(meta["x-type"] === "temporal" || meta["x-type"] === "category"
        ? { type: meta["x-type"] }
        : {}),
    },
    series: header.slice(1).map((field) => ({ field })),
    data,
  });
}

/**
 * Validate a `chart` fence payload in either accepted syntax: the canonical
 * DSL, or a JSON object (detected by a leading "{").
 */
export function validateChartPayload(source: string): ChartValidationResult {
  return source.trimStart().startsWith("{") ? validateChart(source) : parseChartDsl(source);
}
