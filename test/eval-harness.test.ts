import { describe, expect, it } from "vitest";

import { mockAdapter } from "../evals/adapters.js";
import { toMarkdownReport } from "../evals/report.js";
import { runEvals } from "../evals/run.js";
import { scoreDocument } from "../evals/score.js";
import { TASKS, getTasks } from "../evals/tasks.js";

describe("eval harness", () => {
  it("the perfect mock passes every task first try", async () => {
    const run = await runEvals([mockAdapter("perfect")], TASKS, { repair: true });
    const model = run.models[0]!;
    for (const t of model.tasks) {
      expect(t.firstAttempt.pass, `${t.taskId}: ${t.firstAttempt.issues.join("; ")}`).toBe(true);
      expect(t.repairAttempt).toBeUndefined();
    }
  });

  it("the sloppy mock fails first, then recovers via the repair loop", async () => {
    const run = await runEvals([mockAdapter("sloppy")], getTasks(["ts-basic", "cat-multi"]), {
      repair: true,
    });
    for (const t of run.models[0]!.tasks) {
      expect(t.firstAttempt.pass).toBe(false);
      expect(t.firstAttempt.jsonValid).toBe(false);
      expect(t.repairAttempt?.pass, `${t.taskId} repair`).toBe(true);
      expect(t.final.pass).toBe(true);
    }
  });

  it("without repair, the sloppy mock's failures stand", async () => {
    const run = await runEvals([mockAdapter("sloppy")], getTasks(["ts-basic"]), { repair: false });
    const t = run.models[0]!.tasks[0]!;
    expect(t.final.pass).toBe(false);
    expect(t.repairAttempt).toBeUndefined();
  });

  it("catches data infidelity (altered values)", () => {
    const task = getTasks(["ts-basic"])[0]!;
    const doc =
      "# Report\n\n```chart\n" +
      JSON.stringify({
        version: 1,
        type: "line",
        title: "Daily visitors",
        summary: "Visitors grew.",
        x: { field: "date", type: "temporal" },
        series: [{ field: "visitors" }],
        data: [
          { date: "2026-08-03", visitors: 1240 },
          { date: "2026-08-04", visitors: 1380 },
          { date: "2026-08-05", visitors: 1400 }, // altered: source says 1350
          { date: "2026-08-06", visitors: 1470 },
          { date: "2026-08-07", visitors: 1510 },
        ],
      }) +
      "\n```\n";
    const score = scoreDocument(task, doc);
    expect(score.schemaValid).toBe(true);
    expect(score.dataFidelity).toBe(false);
    expect(score.pass).toBe(false);
  });

  it("catches omitted data points", () => {
    const task = getTasks(["ts-basic"])[0]!;
    const doc =
      "# Report\n\n```chart\n" +
      JSON.stringify({
        version: 1,
        type: "line",
        summary: "Visitors grew.",
        x: { field: "date", type: "temporal" },
        series: [{ field: "visitors" }],
        data: [
          { date: "2026-08-03", visitors: 1240 },
          { date: "2026-08-07", visitors: 1510 },
        ],
      }) +
      "\n```\n";
    expect(scoreDocument(task, doc).dataFidelity).toBe(false);
  });

  it("accepts date-time x values against date expectations", () => {
    const task = getTasks(["ts-basic"])[0]!;
    const doc =
      "# Report\n\n```chart\n" +
      JSON.stringify({
        version: 1,
        type: "line",
        summary: "Visitors grew day over day.",
        x: { field: "date", type: "temporal" },
        series: [{ field: "visitors" }],
        data: [
          { date: "2026-08-03T00:00:00Z", visitors: 1240 },
          { date: "2026-08-04T00:00:00Z", visitors: 1380 },
          { date: "2026-08-05T00:00:00Z", visitors: 1350 },
          { date: "2026-08-06T00:00:00Z", visitors: 1470 },
          { date: "2026-08-07T00:00:00Z", visitors: 1510 },
        ],
      }) +
      "\n```\n";
    const score = scoreDocument(task, doc);
    expect(score.dataFidelity, score.issues.join("; ")).toBe(true);
  });

  it("accepts swapped series order in multi-series tasks", () => {
    const task = getTasks(["cat-multi"])[0]!;
    const doc =
      "# Report\n\n```chart\n" +
      JSON.stringify({
        version: 1,
        type: "bar",
        summary: "API leads ticket volume.",
        x: { field: "area" },
        series: [{ field: "resolved" }, { field: "opened" }], // reversed order
        data: [
          { area: "Billing", opened: 34, resolved: 29 },
          { area: "Onboarding", opened: 21, resolved: 22 },
          { area: "API", opened: 45, resolved: 31 },
        ],
      }) +
      "\n```\n";
    const score = scoreDocument(task, doc);
    expect(score.dataFidelity, score.issues.join("; ")).toBe(true);
  });

  it("fails the no-chart task when a chart is emitted", () => {
    const task = getTasks(["no-chart"])[0]!;
    const doc =
      '# Storage\n\n```chart\n{"version":1,"type":"bar","summary":"s","x":{"field":"a"},"series":[{"field":"b"}],"data":[{"a":"used","b":412}]}\n```\n';
    expect(scoreDocument(task, doc).pass).toBe(false);
  });

  it("produces a markdown report with one row per model", async () => {
    const run = await runEvals([mockAdapter("perfect")], getTasks(["ts-basic", "no-chart"]), {});
    const report = toMarkdownReport(run);
    expect(report).toContain("| mock-perfect |");
    expect(report).toContain("First-pass");
  });

  it("structured mode serializes to a passing document and skips non-chart tasks", async () => {
    const run = await runEvals(
      [mockAdapter("perfect")],
      getTasks(["ts-basic", "cat-multi", "multi-chart", "mermaid-flow", "no-chart"]),
      { modes: ["structured"] },
    );
    const model = run.models[0]!;
    expect(model.mode).toBe("structured");
    expect(model.tasks.map((t) => t.taskId)).toEqual(["ts-basic", "cat-multi", "multi-chart"]);
    for (const t of model.tasks) {
      expect(t.final.pass, `${t.taskId}: ${t.final.issues.join("; ")}`).toBe(true);
      expect(t.documents[0]).toContain("```chart");
    }
  });

  it("structured mode repairs an unparseable response", async () => {
    const run = await runEvals([mockAdapter("sloppy")], getTasks(["ts-basic"]), {
      modes: ["structured"],
    });
    const t = run.models[0]!.tasks[0]!;
    expect(t.firstAttempt.pass).toBe(false);
    expect(t.firstAttempt.jsonValid).toBe(false);
    expect(t.final.pass).toBe(true);
    expect(t.repairAttempt).toBeDefined();
  });

  it("mode 'both' yields a direct and a structured row per model", async () => {
    const run = await runEvals([mockAdapter("perfect")], getTasks(["ts-basic"]), {
      modes: ["direct", "structured"],
    });
    expect(run.models.map((m) => m.mode)).toEqual(["direct", "structured"]);
    const report = toMarkdownReport(run);
    expect(report).toContain("mock-perfect [structured]");
  });

  it("records the judge verdict without affecting pass/fail", async () => {
    const badJudge = {
      id: "mock-judge-strict",
      async generate() {
        return { text: '{"consistent": false, "reason": "summary overstates growth"}' };
      },
    };
    const run = await runEvals([mockAdapter("perfect")], getTasks(["ts-basic"]), {
      judge: badJudge,
    });
    const t = run.models[0]!.tasks[0]!;
    expect(t.final.pass).toBe(true); // judge never flips pass
    expect(t.final.summaryConsistent).toBe(false);
    expect(t.final.issues.some((i) => i.includes("[judge]"))).toBe(true);
    expect(toMarkdownReport(run)).toContain("summary overstates growth");
  });
});
