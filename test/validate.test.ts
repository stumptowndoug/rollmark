import { describe, expect, it } from "vitest";

import { validateChart } from "../src/validate.js";

const valid = {
  version: 1,
  type: "line",
  title: "Daily visitors",
  summary: "Visitors grew from 1,240 to 1,510.",
  x: { field: "date", label: "Date", type: "temporal" },
  series: [{ field: "visitors", label: "Visitors" }],
  data: [
    { date: "2026-08-01", visitors: 1240 },
    { date: "2026-08-02", visitors: 1380 },
    { date: "2026-08-03", visitors: 1510 },
  ],
};

function spec(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...valid, ...overrides });
}

function errorCodes(source: string): string[] {
  const result = validateChart(source);
  return result.ok ? [] : result.errors.map((e) => e.code);
}

describe("validateChart", () => {
  it("accepts a valid spec with no warnings", () => {
    const result = validateChart(JSON.stringify(valid));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.type).toBe("line");
      expect(result.spec.data).toHaveLength(3);
      expect(result.warnings).toEqual([]);
    }
  });

  it("rejects malformed JSON (rule 1)", () => {
    expect(errorCodes("{ not json")).toEqual(["invalid-json"]);
  });

  it("rejects non-object payloads (rule 1)", () => {
    expect(errorCodes("[1, 2, 3]")).toEqual(["not-an-object"]);
    expect(errorCodes('"hello"')).toEqual(["not-an-object"]);
  });

  it("rejects missing required fields (rule 2)", () => {
    const result = validateChart(JSON.stringify({ version: 1, type: "line" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const missing = result.errors.filter((e) => e.code === "missing-field");
      expect(missing).toHaveLength(3); // x, series, data
    }
  });

  it("rejects unsupported versions (rule 3)", () => {
    expect(errorCodes(spec({ version: 2 }))).toContain("unsupported-version");
  });

  it("rejects unsupported chart types (rule 4)", () => {
    expect(errorCodes(spec({ type: "pie" }))).toContain("unsupported-type");
  });

  it("enforces series count and uniqueness (rule 5)", () => {
    expect(errorCodes(spec({ series: [] }))).toContain("empty-series");
    const nine = Array.from({ length: 9 }, (_, i) => ({ field: `s${i}` }));
    expect(errorCodes(spec({ series: nine }))).toContain("too-many-series");
    expect(
      errorCodes(spec({ series: [{ field: "visitors" }, { field: "visitors" }] })),
    ).toContain("duplicate-series-field");
  });

  it("enforces data row count (rule 6)", () => {
    expect(errorCodes(spec({ data: [] }))).toContain("empty-data");
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      date: "2026-08-01",
      visitors: i,
    }));
    expect(errorCodes(spec({ data: rows }))).toContain("too-many-rows");
  });

  it("rejects a field absent from every row (rule 7)", () => {
    expect(
      errorCodes(spec({ series: [{ field: "nonexistent" }] })),
    ).toContain("field-not-found");
  });

  it("allows a field missing from only some rows (gap, not error)", () => {
    const result = validateChart(
      spec({
        data: [
          { date: "2026-08-01", visitors: 1240 },
          { date: "2026-08-02" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects non-ISO temporal x values (rule 8)", () => {
    expect(
      errorCodes(spec({ data: [{ date: "August 1st", visitors: 1 }] })),
    ).toContain("invalid-temporal-value");
    expect(
      errorCodes(spec({ data: [{ date: 20260801, visitors: 1 }] })),
    ).toContain("invalid-temporal-value");
  });

  it("accepts ISO date-time temporal values", () => {
    const result = validateChart(
      spec({ data: [{ date: "2026-08-01T12:30:00Z", visitors: 1 }] }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects non-numeric series values, allows null", () => {
    expect(
      errorCodes(spec({ data: [{ date: "2026-08-01", visitors: "many" }] })),
    ).toContain("invalid-series-value");
    const result = validateChart(
      spec({
        data: [
          { date: "2026-08-01", visitors: 1240 },
          { date: "2026-08-02", visitors: null },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("warns on unknown properties without failing", () => {
    const result = validateChart(spec({ color: "red", x: { field: "date", type: "temporal", fancy: true } }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const codes = result.warnings.map((w) => w.code);
      expect(codes).toContain("unknown-property");
      expect(result.warnings).toHaveLength(2); // "color" and "x.fancy"
    }
  });

  it("enforces title and summary length limits", () => {
    expect(errorCodes(spec({ title: "x".repeat(201) }))).toContain("title-too-long");
    expect(errorCodes(spec({ summary: "x".repeat(501) }))).toContain("summary-too-long");
  });

  it("salvages title and summary for fallback display on invalid payloads", () => {
    const result = validateChart(spec({ version: 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.partial.title).toBe("Daily visitors");
      expect(result.partial.summary).toContain("Visitors grew");
    }
  });
});
