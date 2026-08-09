import { describe, expect, it } from "vitest";

import { getFormat, transcodeChartFences } from "../evals/formats.js";
import { scoreDocument } from "../evals/score.js";
import { getTasks } from "../evals/tasks.js";

const dsl = getFormat("dsl");
const arrays = getFormat("arrays");
const yaml = getFormat("yaml");

describe("dsl format", () => {
  it("parses meta + pipe table into a valid spec", () => {
    const result = dsl.validate(
      "type: line\ntitle: Daily visitors\nsummary: Grew steadily.\nx-type: temporal\n\n" +
        "date | visitors\n2026-08-01 | 1240\n2026-08-02 | 1380\n",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect(result.spec.type).toBe("line");
      expect(result.spec.x).toEqual({ field: "date", type: "temporal" });
      expect(result.spec.data).toEqual([
        { date: "2026-08-01", visitors: 1240 },
        { date: "2026-08-02", visitors: 1380 },
      ]);
    }
  });

  it("supports GFM-style tables with outer pipes and separator rows", () => {
    const result = dsl.validate(
      "type: bar\nsummary: s\n\n| team | gb |\n|------|----|\n| Platform | 412 |\n| Web | 96 |\n",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.spec.data[0]).toEqual({ team: "Platform", gb: 412 });
  });

  it("treats empty cells and missing trailing cells as gaps", () => {
    const result = dsl.validate(
      "type: line\nsummary: s\n\nday | a | b\nMon | 1 | 2\nTue |   | 3\nWed | 4\n",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect(result.spec.data[1]).toEqual({ day: "Tue", a: null, b: 3 });
      expect(result.spec.data[2]).toEqual({ day: "Wed", a: 4, b: null });
    }
  });

  it("strips valid thousands separators but not garbled ones", () => {
    const ok = dsl.validate("type: bar\nsummary: s\n\nk | v\na | 12,480\n");
    if (ok.ok) expect(ok.spec.data[0]!.v).toBe(12480);
    const bad = dsl.validate("type: bar\nsummary: s\n\nk | v\na | 1,9020\n");
    expect(bad.ok).toBe(false); // "1,9020" stays a string → invalid series value
  });

  it("routes semantic problems through the shared validator", () => {
    const result = dsl.validate("type: sankey\nsummary: s\n\nk | v\na | 1\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain("unsupported-type");
  });

  it("reports a parse error without a table", () => {
    const result = dsl.validate("type: bar\nsummary: s\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("parse-error");
  });
});

describe("arrays format", () => {
  it("parses parallel arrays into a valid spec", () => {
    const result = arrays.validate(
      "type: bar\ntitle: Revenue\nsummary: s\nx: Jan, Feb, Mar\nRevenue: 25, 42, 61\nCosts: 10, 20, 30\n",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) {
      expect(result.spec.series.map((s) => s.field)).toEqual(["Revenue", "Costs"]);
      expect(result.spec.data[1]).toEqual({ __x: "Feb", Revenue: 42, Costs: 20 });
    }
  });

  it("turns short series into trailing gaps (misalignment shows up as fidelity loss)", () => {
    const result = arrays.validate("type: line\nsummary: s\nx: a, b, c\nV: 1, 2\n");
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (result.ok) expect(result.spec.data[2]).toEqual({ __x: "c", V: null });
  });

  it("requires an x line", () => {
    const result = arrays.validate("type: line\nsummary: s\nV: 1, 2\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("parse-error");
  });
});

describe("yaml format", () => {
  it("parses the schema in YAML syntax", () => {
    const result = yaml.validate(
      "version: 1\ntype: line\nsummary: s\nx:\n  field: date\n  type: temporal\n" +
        "series:\n  - field: visitors\ndata:\n  - date: \"2026-08-01\"\n    visitors: 1240\n",
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it("reports YAML parse errors as parse-error", () => {
    const result = yaml.validate("type: [unclosed\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]!.code).toBe("parse-error");
  });
});

describe("format scoring and transcoding", () => {
  const dslDoc =
    "# Report\n\n```chart\ntype: line\ntitle: Daily visitors\nsummary: Visitors grew from 1,240 to 1,510.\nx-type: temporal\n\n" +
    "date | visitors\n2026-08-03 | 1240\n2026-08-04 | 1380\n2026-08-05 | 1350\n2026-08-06 | 1470\n2026-08-07 | 1510\n```\n";

  it("scores a DSL document against ts-basic with full fidelity", () => {
    const task = getTasks(["ts-basic"])[0]!;
    const score = scoreDocument(task, dslDoc, dsl.validate);
    expect(score.pass, score.issues.join("; ")).toBe(true);
    expect(score.dataFidelity).toBe(true);
  });

  it("the same document fails under the strict json validator (parse error)", () => {
    const task = getTasks(["ts-basic"])[0]!;
    const score = scoreDocument(task, dslDoc, getFormat("json").validate);
    expect(score.pass).toBe(false);
    expect(score.jsonValid).toBe(false);
  });

  it("the default scorer accepts the canonical DSL", () => {
    const task = getTasks(["ts-basic"])[0]!;
    const score = scoreDocument(task, dslDoc);
    expect(score.pass, score.issues.join("; ")).toBe(true);
  });

  it("transcodes chart fences to canonical JSON for rendering", () => {
    const out = transcodeChartFences(dslDoc, dsl.validate);
    expect(out).toContain('"version": 1');
    expect(out).toContain('"field": "date"');
    expect(out).not.toContain("x-type");
    // Prose and fence structure survive.
    expect(out).toContain("# Report");
    expect(out.match(/```/g)!.length).toBe(2);
  });

  it("leaves unparseable fences untouched when transcoding", () => {
    const doc = "```chart\nnot a table\n```\n";
    expect(transcodeChartFences(doc, dsl.validate)).toContain("not a table");
  });
});
