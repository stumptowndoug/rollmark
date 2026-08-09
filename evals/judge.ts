import type { ChartSpec } from "../src/types.js";
import type { ModelAdapter } from "./adapters.js";

export interface JudgeVerdict {
  /** null: the judge failed to produce a verdict — treat as "not judged". */
  consistent: boolean | null;
  reason: string;
}

/**
 * LLM judge for summary-vs-data consistency (SPEC.md §2.5): does the chart's
 * natural-language summary make claims the data contradicts? Presence of a
 * summary is scored mechanically; whether it tells the truth needs a judge.
 *
 * Calibration lessons baked into the rubric (see FINDINGS.md):
 * - The judge gets the original source input, so claims drawn from context
 *   (e.g. an explanation the input itself states) are not "invented".
 * - Only numerically checkable contradictions count — a stated number,
 *   direction, extremum, or comparison the data disproves. Tone, rounding,
 *   emphasis, and omissions are never flagged.
 *
 * The judge never affects pass/fail — it is reported as its own metric.
 */
export async function judgeSummary(
  judge: ModelAdapter,
  spec: ChartSpec,
  sourceContext?: string,
): Promise<JudgeVerdict> {
  const payload = {
    title: spec.title ?? null,
    x: spec.x,
    series: spec.series,
    data: spec.data,
  };
  const messages: Parameters<ModelAdapter["generate"]>[0] = [
    {
      role: "system",
      content:
        "You check whether a chart's natural-language summary is consistent with its data. " +
        "Flag it as inconsistent ONLY if it states a specific number, direction, extremum, or comparison " +
        "that the data numerically contradicts. " +
        "Do NOT flag: reasonable rounding; qualitative phrasing or tone; emphasis choices or omissions; " +
        "or claims and explanations that are supported by the original source input (provided below) even if " +
        "they are not visible in the chart data itself. When uncertain, answer consistent. " +
        'Reply with ONLY a JSON object: {"consistent": true|false, "reason": "<one sentence>"}',
    },
    {
      role: "user",
      content:
        (sourceContext ? `Original source input the report was written from:\n${sourceContext}\n\n` : "") +
        `Chart data:\n${JSON.stringify(payload, null, 2)}\n\n` +
        `Summary to check:\n"${spec.summary ?? ""}"`,
    },
  ];

  // A judge that fails to answer is "no verdict", never "inconsistent".
  // One retry covers transient empty replies.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await judge.generate(messages);
    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) continue;
    try {
      const parsed = JSON.parse(match[0]) as { consistent?: unknown; reason?: unknown };
      return {
        consistent: parsed.consistent === true,
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      };
    } catch {
      continue;
    }
  }
  return { consistent: null, reason: "judge produced no parseable verdict" };
}
