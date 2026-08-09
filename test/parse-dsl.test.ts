import { describe, expect, it } from "vitest";

import { parseChartDsl, validateChartPayload } from "../src/parse-dsl.js";

describe("parseChartDsl (canonical syntax)", () => {
  it("parses bare type + meta + table, inferring the temporal axis", () => {
    const result = parseChartDsl(
      "line\ntitle: Daily visitors\nsummary: Grew steadily.\n\n" +
        "date | visitors\n2026-08-01 | 1240\n2026-08-02 | 1380\n",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect(result.spec.type).toBe("line");
      expect(result.spec.x).toEqual({ field: "date", type: "temporal" });
      expect(result.spec.summary).toBe("Grew steadily.");
    }
  });

  it("keeps category axes categorical (no false temporal inference)", () => {
    const result = parseChartDsl("bar\nsummary: s\n\nmonth | revenue\nJan | 25\nFeb | 50\n");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.x.type).toBeUndefined();
  });

  it("accepts `type:` meta as an alternate to the bare line", () => {
    const result = parseChartDsl("type: bar\nsummary: s\n\nk | v\na | 1\n");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.type).toBe("bar");
  });

  it("parses stack and validates it per type", () => {
    const ok = parseChartDsl("bar\nstack: true\nsummary: s\n\nm | a | b\nJan | 1 | 2\n");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.spec.stack).toBe(true);
    const bad = parseChartDsl("pie\nstack: true\nsummary: s\n\nk | v\na | 1\n");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.code)).toContain("stack-not-supported");
  });

  it("quoted cells stay strings and may contain pipes", () => {
    const result = parseChartDsl(
      'bar\nsummary: s\n\nsku | sold\n"007" | 12\n"a|b" | 3\n',
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect(result.spec.data[0]!.sku).toBe("007");
      expect(result.spec.data[1]!.sku).toBe("a|b");
    }
  });

  it("parses pie charts with a single value column", () => {
    const result = parseChartDsl(
      "pie\ntitle: Subscribers by plan\nsummary: Free dominates.\n\nplan | subscribers\nFree | 9120\nPro | 2480\nTeam | 640\n",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.spec.type).toBe("pie");
  });

  it("parses scatter with numeric x", () => {
    const result = parseChartDsl(
      "scatter\nsummary: s\n\nprice | rating\n9.99 | 4.1\n24.5 | 4.7\n",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});

describe("validateChartPayload", () => {
  it("routes JSON payloads to the JSON validator", () => {
    const result = validateChartPayload(
      '{"version":1,"type":"bar","summary":"s","x":{"field":"k"},"series":[{"field":"v"}],"data":[{"k":"a","v":1}]}',
    );
    expect(result.ok).toBe(true);
  });

  it("routes everything else to the DSL parser", () => {
    const result = validateChartPayload("bar\nsummary: s\n\nk | v\na | 1\n");
    expect(result.ok).toBe(true);
  });
});
