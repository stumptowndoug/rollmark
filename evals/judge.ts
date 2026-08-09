import type { ChartSpec } from "../src/types.js";
import type { ModelAdapter } from "./adapters.js";

export interface JudgeVerdict {
  consistent: boolean;
  reason: string;
}

/**
 * LLM judge for summary-vs-data consistency (SPEC.md §2.5): does the chart's
 * natural-language summary make only claims the data supports? Presence of a
 * summary is scored mechanically; whether it tells the truth needs a judge.
 *
 * The judge never affects pass/fail — it is reported as its own metric.
 */
export async function judgeSummary(judge: ModelAdapter, spec: ChartSpec): Promise<JudgeVerdict> {
  const payload = {
    title: spec.title ?? null,
    x: spec.x,
    series: spec.series,
    data: spec.data,
  };
  const result = await judge.generate([
    {
      role: "system",
      content:
        "You check whether a chart's natural-language summary is consistent with its data. " +
        "The summary is inconsistent if it states a number, direction, extreme, or comparison the data contradicts. " +
        "Reasonable rounding and qualitative phrasing are fine. " +
        'Reply with ONLY a JSON object: {"consistent": true|false, "reason": "<one sentence>"}',
    },
    {
      role: "user",
      content:
        `Chart data:\n${JSON.stringify(payload, null, 2)}\n\n` +
        `Summary to check:\n"${spec.summary ?? ""}"`,
    },
  ]);
  const match = result.text.match(/\{[\s\S]*\}/);
  if (!match) return { consistent: false, reason: `judge reply unparseable: ${result.text.slice(0, 120)}` };
  try {
    const parsed = JSON.parse(match[0]) as { consistent?: unknown; reason?: unknown };
    return {
      consistent: parsed.consistent === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return { consistent: false, reason: `judge reply unparseable: ${result.text.slice(0, 120)}` };
  }
}
