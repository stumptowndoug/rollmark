import { LIMITS } from "./limits.js";
import type {
  ChartAxis,
  ChartPartial,
  ChartSeries,
  ChartSpec,
  ChartValidationResult,
  ValidationIssue,
} from "./types.js";

const KNOWN_TOP_LEVEL = new Set(["version", "type", "title", "summary", "stack", "x", "series", "data"]);

const CHART_TYPES = new Set(["line", "bar", "area", "scatter", "pie"]);
const STACKABLE_TYPES = new Set(["bar", "area"]);
const KNOWN_AXIS = new Set(["field", "label", "type"]);
const KNOWN_SERIES = new Set(["field", "label"]);

// ISO 8601 date or date-time (SPEC.md §2.2): 2026-08-01, 2026-08-01T12:30:00Z, etc.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the raw text payload of a `chart` fenced block per SPEC.md §2.3.
 *
 * Unknown properties are warnings, never errors: renderers ignore them, but
 * evals and repair loops need them to be visible.
 */
export function validateChart(source: string): ChartValidationResult {
  let payload: unknown;
  try {
    payload = JSON.parse(source);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      errors: [{ code: "invalid-json", message: `payload is not well-formed JSON: ${message}` }],
      warnings: [],
      partial: {},
    };
  }
  return validateChartValue(payload);
}

/**
 * Validate an already-parsed chart payload. Exists so alternative payload
 * syntaxes (parsed elsewhere) share the exact same semantic validation.
 */
export function validateChartValue(payload: unknown): ChartValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!isPlainObject(payload)) {
    return {
      ok: false,
      errors: [{ code: "not-an-object", message: "payload must be an object" }],
      warnings,
      partial: {},
    };
  }

  const partial: ChartPartial = {};
  if (typeof payload.title === "string") partial.title = payload.title;
  if (typeof payload.summary === "string") partial.summary = payload.summary;

  for (const key of Object.keys(payload)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      warnings.push({ code: "unknown-property", message: `unknown property "${key}" is ignored` });
    }
  }

  // Rule 3: version.
  if (payload.version === undefined) {
    errors.push({ code: "missing-field", message: `required field "version" is missing` });
  } else if (payload.version !== 1) {
    errors.push({
      code: "unsupported-version",
      message: `unsupported schema version ${JSON.stringify(payload.version)}; this renderer supports version 1`,
    });
  }

  // Rule 4: type.
  if (payload.type === undefined) {
    errors.push({ code: "missing-field", message: `required field "type" is missing` });
  } else if (typeof payload.type !== "string" || !CHART_TYPES.has(payload.type)) {
    errors.push({
      code: "unsupported-type",
      message: `unsupported chart type ${JSON.stringify(payload.type)}; version 1 supports ${[...CHART_TYPES].map((t) => `"${t}"`).join(", ")}`,
    });
  }

  if (payload.stack !== undefined) {
    if (typeof payload.stack !== "boolean") {
      errors.push({ code: "wrong-type", message: `"stack" must be true or false` });
    } else if (
      payload.stack &&
      typeof payload.type === "string" &&
      CHART_TYPES.has(payload.type) &&
      !STACKABLE_TYPES.has(payload.type)
    ) {
      errors.push({
        code: "stack-not-supported",
        message: `"stack" applies only to bar and area charts, not "${payload.type}"`,
      });
    }
  }

  if (payload.title !== undefined) {
    if (typeof payload.title !== "string") {
      errors.push({ code: "wrong-type", message: `"title" must be a string` });
    } else if (payload.title.length > LIMITS.maxTitleLength) {
      errors.push({
        code: "title-too-long",
        message: `"title" exceeds ${LIMITS.maxTitleLength} characters`,
      });
    }
  }

  if (payload.summary !== undefined) {
    if (typeof payload.summary !== "string") {
      errors.push({ code: "wrong-type", message: `"summary" must be a string` });
    } else if (payload.summary.length > LIMITS.maxSummaryLength) {
      errors.push({
        code: "summary-too-long",
        message: `"summary" exceeds ${LIMITS.maxSummaryLength} characters`,
      });
    }
  }

  const x = validateAxis(payload.x, errors, warnings);
  const series = validateSeries(payload.series, errors, warnings);
  const data = validateData(payload.data, errors);

  if (x && series && data) {
    validateFieldPresence(x, series, data, errors);
    inferTemporalAxis(x, data);
    validateValueTypes(x, series, data, errors);
    if (typeof payload.type === "string") {
      validatePerType(payload.type, x, series, data, errors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings, partial };
  }

  const spec: ChartSpec = {
    version: 1,
    type: payload.type as ChartSpec["type"],
    x: x as ChartAxis,
    series: series as ChartSeries[],
    data: data as Record<string, unknown>[],
  };
  if (partial.title !== undefined) spec.title = partial.title;
  if (partial.summary !== undefined) spec.summary = partial.summary;
  if (payload.stack === true) spec.stack = true;

  return { ok: true, spec, warnings };
}

/**
 * When x.type is not declared and every x value is an ISO 8601 date string,
 * treat the axis as temporal. Declared types are never overridden.
 */
function inferTemporalAxis(x: ChartAxis, data: Record<string, unknown>[]): void {
  if (x.type !== undefined) return;
  const values = data.map((row) => row[x.field]).filter((v) => v !== undefined && v !== null);
  if (
    values.length > 0 &&
    values.every((v) => typeof v === "string" && ISO_8601.test(v) && !Number.isNaN(Date.parse(v)))
  ) {
    x.type = "temporal";
  }
}

/** Type-specific rules: pie shape and scatter axis requirements. */
function validatePerType(
  type: string,
  x: ChartAxis,
  series: ChartSeries[],
  data: Record<string, unknown>[],
  errors: ValidationIssue[],
): void {
  if (type === "pie") {
    if (series.length !== 1) {
      errors.push({
        code: "pie-series",
        message: `pie charts take exactly one series; found ${series.length}`,
      });
      return;
    }
    const field = series[0]!.field;
    for (const [index, row] of data.entries()) {
      const v = row[field];
      if (typeof v !== "number" || v < 0) {
        errors.push({
          code: "invalid-pie-value",
          message: `"data[${index}].${field}" must be a non-negative number for a pie chart`,
        });
        return;
      }
    }
  }
  if (type === "scatter" && x.type !== "temporal") {
    const values = data.map((row) => row[x.field]).filter((v) => v !== undefined && v !== null);
    if (!values.every((v) => typeof v === "number")) {
      errors.push({
        code: "invalid-scatter-x",
        message: "scatter charts need numeric or ISO 8601 date x values, not categories",
      });
    }
  }
}

function validateAxis(
  value: unknown,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): ChartAxis | undefined {
  if (value === undefined) {
    errors.push({ code: "missing-field", message: `required field "x" is missing` });
    return undefined;
  }
  if (!isPlainObject(value)) {
    errors.push({ code: "wrong-type", message: `"x" must be an object` });
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!KNOWN_AXIS.has(key)) {
      warnings.push({ code: "unknown-property", message: `unknown property "x.${key}" is ignored` });
    }
  }
  if (typeof value.field !== "string" || value.field.length === 0) {
    errors.push({ code: "wrong-type", message: `"x.field" must be a non-empty string` });
    return undefined;
  }
  if (value.label !== undefined && typeof value.label !== "string") {
    errors.push({ code: "wrong-type", message: `"x.label" must be a string` });
    return undefined;
  }
  if (value.type !== undefined && value.type !== "category" && value.type !== "temporal") {
    errors.push({
      code: "wrong-type",
      message: `"x.type" must be "category" or "temporal"`,
    });
    return undefined;
  }
  const axis: ChartAxis = { field: value.field };
  if (typeof value.label === "string") axis.label = value.label;
  if (value.type === "category" || value.type === "temporal") axis.type = value.type;
  return axis;
}

function validateSeries(
  value: unknown,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): ChartSeries[] | undefined {
  if (value === undefined) {
    errors.push({ code: "missing-field", message: `required field "series" is missing` });
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push({ code: "wrong-type", message: `"series" must be an array` });
    return undefined;
  }
  // Rule 5: 1–8 entries, unique fields.
  if (value.length === 0) {
    errors.push({ code: "empty-series", message: `"series" must contain at least one entry` });
    return undefined;
  }
  if (value.length > LIMITS.maxSeries) {
    errors.push({
      code: "too-many-series",
      message: `"series" has ${value.length} entries; the maximum is ${LIMITS.maxSeries}`,
    });
    return undefined;
  }
  const result: ChartSeries[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry)) {
      errors.push({ code: "wrong-type", message: `"series[${index}]" must be an object` });
      return undefined;
    }
    for (const key of Object.keys(entry)) {
      if (!KNOWN_SERIES.has(key)) {
        warnings.push({
          code: "unknown-property",
          message: `unknown property "series[${index}].${key}" is ignored`,
        });
      }
    }
    if (typeof entry.field !== "string" || entry.field.length === 0) {
      errors.push({
        code: "wrong-type",
        message: `"series[${index}].field" must be a non-empty string`,
      });
      return undefined;
    }
    if (entry.label !== undefined && typeof entry.label !== "string") {
      errors.push({ code: "wrong-type", message: `"series[${index}].label" must be a string` });
      return undefined;
    }
    if (seen.has(entry.field)) {
      errors.push({
        code: "duplicate-series-field",
        message: `duplicate series field "${entry.field}"; fields must be unique across series`,
      });
      return undefined;
    }
    seen.add(entry.field);
    const s: ChartSeries = { field: entry.field };
    if (typeof entry.label === "string") s.label = entry.label;
    result.push(s);
  }
  return result;
}

function validateData(
  value: unknown,
  errors: ValidationIssue[],
): Record<string, unknown>[] | undefined {
  if (value === undefined) {
    errors.push({ code: "missing-field", message: `required field "data" is missing` });
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push({ code: "wrong-type", message: `"data" must be an array` });
    return undefined;
  }
  // Rule 6: 1–1,000 rows.
  if (value.length === 0) {
    errors.push({ code: "empty-data", message: `"data" must contain at least one row` });
    return undefined;
  }
  if (value.length > LIMITS.maxDataRows) {
    errors.push({
      code: "too-many-rows",
      message: `"data" has ${value.length} rows; the maximum is ${LIMITS.maxDataRows}`,
    });
    return undefined;
  }
  for (const [index, row] of value.entries()) {
    if (!isPlainObject(row)) {
      errors.push({ code: "wrong-type", message: `"data[${index}]" must be an object` });
      return undefined;
    }
  }
  return value as Record<string, unknown>[];
}

/** Rule 7: a referenced field absent from every row is invalid. */
function validateFieldPresence(
  x: ChartAxis,
  series: ChartSeries[],
  data: Record<string, unknown>[],
  errors: ValidationIssue[],
): void {
  const fields = [x.field, ...series.map((s) => s.field)];
  for (const field of fields) {
    if (!data.some((row) => row[field] !== undefined)) {
      errors.push({
        code: "field-not-found",
        message: `field "${field}" was not found in the data`,
      });
    }
  }
}

/**
 * SPEC.md §2.2 value types: x values must be strings or numbers (ISO 8601
 * strings when temporal, rule 8); series values must be numbers or null.
 * A field merely missing from an individual row is a gap, not an error.
 */
function validateValueTypes(
  x: ChartAxis,
  series: ChartSeries[],
  data: Record<string, unknown>[],
  errors: ValidationIssue[],
): void {
  const temporal = x.type === "temporal";
  for (const [index, row] of data.entries()) {
    const xValue = row[x.field];
    if (xValue !== undefined) {
      if (typeof xValue !== "string" && typeof xValue !== "number") {
        errors.push({
          code: "invalid-x-value",
          message: `"data[${index}].${x.field}" must be a string or number`,
        });
        return;
      }
      if (temporal && (typeof xValue !== "string" || !ISO_8601.test(xValue) || Number.isNaN(Date.parse(xValue)))) {
        errors.push({
          code: "invalid-temporal-value",
          message: `"data[${index}].${x.field}" is not an ISO 8601 date or date-time string`,
        });
        return;
      }
    }
    for (const s of series) {
      const yValue = row[s.field];
      if (yValue !== undefined && yValue !== null && typeof yValue !== "number") {
        errors.push({
          code: "invalid-series-value",
          message: `"data[${index}].${s.field}" must be a number or null`,
        });
        return;
      }
    }
  }
}
