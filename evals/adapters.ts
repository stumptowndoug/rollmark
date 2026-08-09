import type { EvalTask } from "./tasks.js";
import { TASKS } from "./tasks.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateResult {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface GenerateMeta {
  /** Task id, for mock adapters; real adapters ignore it. */
  taskId?: string;
  /**
   * Provider response_format payload (e.g. json_schema strict mode) for the
   * structured-generation arm. Adapters that cannot honor it should throw.
   */
  responseFormat?: unknown;
}

export interface ModelAdapter {
  id: string;
  generate(messages: ChatMessage[], meta?: GenerateMeta): Promise<GenerateResult>;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export class OpenRouterAdapter implements ModelAdapter {
  constructor(
    readonly id: string,
    private readonly apiKey: string,
    private readonly options: { temperature?: number; maxRetries?: number } = {},
  ) {}

  async generate(messages: ChatMessage[], meta?: GenerateMeta): Promise<GenerateResult> {
    const maxRetries = this.options.maxRetries ?? 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
      try {
        const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/rollmark",
            "X-Title": "Rollmark evals",
          },
          body: JSON.stringify({
            model: this.id,
            messages,
            temperature: this.options.temperature ?? 0.2,
            ...(meta?.responseFormat ? { response_format: meta.responseFormat } : {}),
          }),
          signal: AbortSignal.timeout(180_000),
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
          continue;
        }
        if (!res.ok) {
          throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 500)}`);
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: { message?: string };
        };
        if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message}`);
        const text = data.choices?.[0]?.message?.content;
        if (typeof text !== "string") {
          lastError = new Error(`no completion text in response`);
          continue;
        }
        return {
          text,
          usage: {
            promptTokens: data.usage?.prompt_tokens,
            completionTokens: data.usage?.completion_tokens,
          },
        };
      } catch (cause) {
        lastError = cause;
      }
    }
    throw new Error(`model ${this.id} failed after ${maxRetries + 1} attempts: ${lastError}`);
  }
}

export async function listOpenRouterModels(filter?: string): Promise<string[]> {
  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  const ids = (data.data ?? []).map((m) => m.id).sort();
  return filter ? ids.filter((id) => id.includes(filter)) : ids;
}

// ---------------------------------------------------------------------------
// Mock adapters: exercise the full harness offline. "perfect" emits a correct
// document straight from the task expectation; "sloppy" emits broken JSON
// first and only fixes it when the repair prompt arrives, testing the loop.
// ---------------------------------------------------------------------------

function perfectDocument(task: EvalTask): string {
  const exp = task.expected;
  if (exp.blockType === "none") {
    return "Storage is at **412 GB of 500 GB (82%)** and grew 9 GB last month.\n";
  }
  if (exp.blockType === "mermaid") {
    return (
      "## Deploy pipeline\n\n```mermaid\nflowchart LR\n" +
      "    Commit --> CI\n    CI -->|pass| Staging\n    CI -->|fail| Slack\n" +
      "    Staging --> Approval\n    Approval --> Production\n```\n"
    );
  }
  // One chart holding all series, or one chart per series for multi-chart tasks.
  return `# Report\n\nHere is the requested report.\n\n${buildChartSpecs(task)
    .map((spec) => "```chart\n" + JSON.stringify(spec, null, 2) + "\n```")
    .join("\n\n")}\n\nEnd of report.\n`;
}

/** Correct chart specs derived from a chart task's expectation. */
function buildChartSpecs(task: EvalTask): Record<string, unknown>[] {
  const exp = task.expected;
  // One chart holding all series, or one chart per series for multi-chart tasks.
  const seriesGroups =
    (exp.minCharts ?? 1) > 1 ? exp.series!.map((s) => [s]) : [exp.series!];
  return seriesGroups.map((group, g) => {
    const xValues =
      seriesGroups.length === 1 && exp.xValues && exp.xValues.length > 0
        ? exp.xValues
        : group[0]!.values.map((_, j) => `item-${g}-${j}`);
    return {
      version: 1,
      type: exp.chartTypes?.[0] ?? "line",
      title: `Chart ${g + 1}`,
      summary: `Values range across ${group[0]!.values.length} points.`,
      x: { field: "x", ...(exp.temporal ? { type: "temporal" as const } : {}) },
      series: group.map((_, i) => ({ field: `y${i}` })),
      data: xValues.map((x, row) => {
        const rowObj: Record<string, unknown> = { x };
        group.forEach((s, i) => {
          rowObj[`y${i}`] = s.values[row] ?? null;
        });
        return rowObj;
      }),
    };
  });
}

/** A structured-arm response (parallel-array shape) built from the same expectation. */
function structuredReport(task: EvalTask): string {
  const exp = task.expected;
  const seriesGroups =
    (exp.minCharts ?? 1) > 1 ? exp.series!.map((s) => [s]) : [exp.series!];
  const charts = seriesGroups.map((group, g) => {
    const xValues =
      seriesGroups.length === 1 && exp.xValues && exp.xValues.length > 0
        ? exp.xValues
        : group[0]!.values.map((_, j) => `item-${g}-${j}`);
    return {
      type: exp.chartTypes?.[0] ?? "line",
      title: `Chart ${g + 1}`,
      summary: `Values range across ${group[0]!.values.length} points.`,
      x_label: null,
      x_temporal: exp.temporal ?? false,
      x_values: xValues.map(String),
      series: group.map((s, i) => ({ label: `Series ${i + 1}`, values: s.values })),
    };
  });
  return JSON.stringify({ intro: "Here is the requested report.", charts, outro: null });
}

export function mockAdapter(kind: "perfect" | "sloppy"): ModelAdapter {
  const byId = new Map(TASKS.map((t) => [t.id, t]));
  return {
    id: `mock-${kind}`,
    async generate(messages, meta) {
      const task = meta?.taskId ? byId.get(meta.taskId) : undefined;
      if (!task) throw new Error("mock adapter requires meta.taskId");
      const isRepair = messages.some(
        (m) => m.role === "user" && m.content.includes("failed validation"),
      );
      if (meta?.responseFormat) {
        if (kind === "sloppy" && !isRepair) {
          // Unparseable response: exercises the serialization-failure path.
          return { text: "I cannot produce JSON right now." };
        }
        return { text: structuredReport(task) };
      }
      if (kind === "sloppy" && !isRepair && task.expected.blockType === "chart") {
        // Well-formed Markdown, broken chart payload (trailing comma).
        return {
          text: '# Report\n\n```chart\n{ "version": 1, "type": "line", }\n```\n',
        };
      }
      return { text: perfectDocument(task) };
    },
  };
}
