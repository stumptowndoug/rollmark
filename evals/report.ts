import type { EvalRun, ModelResult } from "./run.js";
import { METRIC_KEYS } from "./score.js";
import type { MetricResults } from "./score.js";

function pct(passed: number, applicable: number): string {
  if (applicable === 0) return "—";
  return `${Math.round((passed / applicable) * 100)}%`;
}

function metricColumn(results: MetricResults[], key: (typeof METRIC_KEYS)[number]): string {
  const applicable = results.filter((r) => r[key] !== null);
  const passed = applicable.filter((r) => r[key] === true);
  return pct(passed.length, applicable.length);
}

function summarizeModel(model: ModelResult): Record<string, string> {
  const firsts = model.tasks.map((t) => t.firstAttempt);
  const finals = model.tasks.map((t) => t.final);
  const repairsTried = model.tasks.filter((t) => t.repairAttempt);
  const repairsWon = repairsTried.filter((t) => t.final.pass);
  const tokens = model.tasks.reduce((n, t) => n + t.usage.completionTokens, 0);
  return {
    model: model.model,
    firstPass: pct(firsts.filter((r) => r.pass).length, firsts.length),
    finalPass: pct(finals.filter((r) => r.pass).length, finals.length),
    repairSuccess: pct(repairsWon.length, repairsTried.length),
    schemaValid: metricColumn(firsts, "schemaValid"),
    dataFidelity: metricColumn(firsts, "dataFidelity"),
    hasSummary: metricColumn(firsts, "hasSummary"),
    completionTokens: String(tokens || "—"),
  };
}

export function toMarkdownReport(run: EvalRun): string {
  const lines: string[] = [];
  lines.push(`# Rollmark eval run`);
  lines.push("");
  lines.push(`Started: ${run.startedAt} · Tasks: ${run.taskIds.length} (${run.taskIds.join(", ")})`);
  lines.push("");
  lines.push(
    `| Model | First-pass | Final (with repair) | Repair success | Schema valid | Data fidelity | Has summary | Output tokens |`,
  );
  lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const model of run.models) {
    const s = summarizeModel(model);
    lines.push(
      `| ${s.model} | ${s.firstPass} | ${s.finalPass} | ${s.repairSuccess} | ${s.schemaValid} | ${s.dataFidelity} | ${s.hasSummary} | ${s.completionTokens} |`,
    );
  }
  lines.push("");

  const failures = run.models.flatMap((m) =>
    m.tasks
      .filter((t) => !t.final.pass)
      .map((t) => ({ model: m.model, task: t.taskId, issues: t.final.issues, error: t.error })),
  );
  if (failures.length > 0) {
    lines.push(`## Failures`);
    lines.push("");
    for (const f of failures) {
      lines.push(`- **${f.model} / ${f.task}**: ${f.error ?? f.issues.join("; ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
