import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderRollmark } from "../src/render.js";
import type { ChatMessage, ModelAdapter } from "./adapters.js";
import { OpenRouterAdapter, listOpenRouterModels, mockAdapter } from "./adapters.js";
import { judgeSummary } from "./judge.js";
import { toMarkdownReport } from "./report.js";
import { repairableIssues, scoreDocument } from "./score.js";
import type { MetricResults } from "./score.js";
import {
  STRUCTURED_RESPONSE_FORMAT,
  serializeStructuredReport,
  structuredApplicable,
  structuredMessages,
} from "./structured.js";
import { getTasks } from "./tasks.js";
import type { EvalTask } from "./tasks.js";

const evalsDir = fileURLToPath(new URL(".", import.meta.url));

export type EvalMode = "direct" | "structured";

export interface TaskResult {
  taskId: string;
  firstAttempt: MetricResults;
  /** Present when a repair attempt was made. */
  repairAttempt?: MetricResults;
  /** The attempt that counts: repair if attempted, else first. */
  final: MetricResults;
  documents: string[];
  usage: { promptTokens: number; completionTokens: number };
  error?: string;
}

export interface ModelResult {
  model: string;
  mode: EvalMode;
  tasks: TaskResult[];
}

export interface EvalRun {
  startedAt: string;
  models: ModelResult[];
  taskIds: string[];
}

function systemPrompt(): string {
  const raw = readFileSync(join(evalsDir, "..", "prompt-kit", "system-prompt.md"), "utf8");
  const match = raw.match(/---BEGIN SNIPPET---\n([\s\S]*)\n---END SNIPPET---/);
  if (!match) throw new Error("prompt-kit/system-prompt.md is missing its snippet markers");
  return match[1]!.trim();
}

function directMessages(system: string, task: EvalTask): ChatMessage[] {
  return [
    { role: "system", content: system },
    { role: "user", content: `${task.request}\n\nInput data:\n\n${task.input}` },
  ];
}

function repairPrompt(issues: string[]): string {
  return (
    `Your document failed validation with these problems:\n\n` +
    issues.map((i) => `- ${i}`).join("\n") +
    `\n\nPlease reply with the complete corrected output.`
  );
}

function failedMetrics(message: string): MetricResults {
  return {
    markdownValid: false,
    blockDetected: false,
    jsonValid: null,
    schemaValid: null,
    chartTypeOk: null,
    dataFidelity: null,
    hasTitle: null,
    hasSummary: null,
    renderOk: null,
    summaryConsistent: null,
    pass: false,
    issues: [message],
    warningCount: 0,
  };
}

interface RunTaskOptions {
  adapter: ModelAdapter;
  system: string;
  task: EvalTask;
  repair: boolean;
  mode: EvalMode;
  judge?: ModelAdapter;
}

async function runTask(opts: RunTaskOptions): Promise<TaskResult> {
  const { adapter, system, task, repair, mode, judge } = opts;
  const usage = { promptTokens: 0, completionTokens: 0 };
  const documents: string[] = [];
  const structured = mode === "structured";
  const meta = structured
    ? { taskId: task.id, responseFormat: STRUCTURED_RESPONSE_FORMAT }
    : { taskId: task.id };
  const messages: ChatMessage[] = structured
    ? structuredMessages(task)
    : directMessages(system, task);

  function toDocument(raw: string): { document: string; error?: string } {
    if (!structured) return { document: raw };
    try {
      return { document: serializeStructuredReport(raw) };
    } catch (cause) {
      return {
        document: raw,
        error: `structured response was not valid report JSON: ${
          cause instanceof Error ? cause.message : cause
        }`,
      };
    }
  }

  async function judgeFinal(final: MetricResults, document: string): Promise<void> {
    if (!judge || task.expected.blockType !== "chart" || !final.pass) return;
    try {
      const { blocks } = renderRollmark(document);
      const specs = blocks.flatMap((b) => (b.type === "chart" && b.spec ? [b.spec] : []));
      const verdicts = await Promise.all(specs.map((spec) => judgeSummary(judge, spec)));
      final.summaryConsistent = verdicts.every((v) => v.consistent);
      for (const v of verdicts) {
        if (!v.consistent) final.issues.push(`[judge] summary inconsistent: ${v.reason}`);
      }
    } catch (cause) {
      final.issues.push(`[judge] failed: ${cause instanceof Error ? cause.message : cause}`);
    }
  }

  try {
    const first = await adapter.generate(messages, meta);
    usage.promptTokens += first.usage?.promptTokens ?? 0;
    usage.completionTokens += first.usage?.completionTokens ?? 0;
    const firstDoc = toDocument(first.text);
    documents.push(firstDoc.document);
    const firstAttempt = scoreDocument(task, firstDoc.document);
    if (firstDoc.error) {
      firstAttempt.pass = false;
      firstAttempt.jsonValid = false;
      firstAttempt.issues.unshift(firstDoc.error);
    }

    const visibleIssues = repairableIssues(firstAttempt);
    if (firstAttempt.pass || !repair || visibleIssues.length === 0) {
      await judgeFinal(firstAttempt, firstDoc.document);
      return { taskId: task.id, firstAttempt, final: firstAttempt, documents, usage };
    }

    messages.push(
      { role: "assistant", content: first.text },
      { role: "user", content: repairPrompt(visibleIssues) },
    );
    const second = await adapter.generate(messages, meta);
    usage.promptTokens += second.usage?.promptTokens ?? 0;
    usage.completionTokens += second.usage?.completionTokens ?? 0;
    const secondDoc = toDocument(second.text);
    documents.push(secondDoc.document);
    const repairAttempt = scoreDocument(task, secondDoc.document);
    if (secondDoc.error) {
      repairAttempt.pass = false;
      repairAttempt.jsonValid = false;
      repairAttempt.issues.unshift(secondDoc.error);
    }
    await judgeFinal(repairAttempt, secondDoc.document);
    return { taskId: task.id, firstAttempt, repairAttempt, final: repairAttempt, documents, usage };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      taskId: task.id,
      firstAttempt: failedMetrics(`generation failed: ${message}`),
      final: failedMetrics(`generation failed: ${message}`),
      documents,
      usage,
      error: message,
    };
  }
}

export interface RunEvalsOptions {
  repair?: boolean;
  concurrency?: number;
  modes?: EvalMode[];
  judge?: ModelAdapter;
  log?: (line: string) => void;
}

export async function runEvals(
  adapters: ModelAdapter[],
  tasks: EvalTask[],
  options: RunEvalsOptions = {},
): Promise<EvalRun> {
  const repair = options.repair ?? true;
  const concurrency = options.concurrency ?? 4;
  const modes = options.modes ?? ["direct"];
  const log = options.log ?? (() => {});
  const system = systemPrompt();
  const models: ModelResult[] = [];

  for (const adapter of adapters) {
    for (const mode of modes) {
      const modeTasks = mode === "structured" ? tasks.filter(structuredApplicable) : tasks;
      if (modeTasks.length === 0) continue;
      log(`── ${adapter.id}${mode === "structured" ? " [structured]" : ""}`);
      const results: TaskResult[] = new Array(modeTasks.length);
      let next = 0;
      async function worker(): Promise<void> {
        while (next < modeTasks.length) {
          const index = next++;
          const task = modeTasks[index]!;
          const result = await runTask({ adapter, system, task, repair, mode, judge: options.judge });
          results[index] = result;
          const marker = result.final.pass ? "✓" : "✗";
          const repaired = result.repairAttempt ? " (after repair)" : "";
          const judgeFlag = result.final.summaryConsistent === false ? " [summary inconsistent]" : "";
          log(
            `  ${marker} ${task.id}${
              result.final.pass ? repaired + judgeFlag : `: ${result.final.issues[0] ?? ""}`
            }`,
          );
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, modeTasks.length) }, worker));
      models.push({ model: adapter.id, mode, tasks: results });
    }
  }

  return { startedAt: new Date().toISOString(), models, taskIds: tasks.map((t) => t.id) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  adapter: "openrouter" | "mock";
  models: string[];
  tasks: string[];
  repair: boolean;
  mode: "direct" | "structured" | "both";
  judge?: string;
  listModels?: string | true;
  out: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    adapter: "openrouter",
    models: [],
    tasks: [],
    repair: true,
    mode: "direct",
    out: join(evalsDir, "results"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--adapter":
        args.adapter = argv[++i] as CliArgs["adapter"];
        break;
      case "--models":
        args.models = (argv[++i] ?? "").split(",").filter(Boolean);
        break;
      case "--tasks":
        args.tasks = (argv[++i] ?? "").split(",").filter(Boolean);
        break;
      case "--mode":
        args.mode = argv[++i] as CliArgs["mode"];
        break;
      case "--judge":
        args.judge = argv[++i]!;
        break;
      case "--no-repair":
        args.repair = false;
        break;
      case "--out":
        args.out = argv[++i]!;
        break;
      case "--list-models":
        args.listModels = argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : true;
        break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.listModels) {
    const filter = args.listModels === true ? undefined : args.listModels;
    for (const id of await listOpenRouterModels(filter)) console.log(id);
    return;
  }

  const tasks = getTasks(args.tasks);
  const modes: EvalMode[] = args.mode === "both" ? ["direct", "structured"] : [args.mode];
  let adapters: ModelAdapter[];
  let judge: ModelAdapter | undefined;

  if (args.adapter === "mock") {
    adapters = [mockAdapter("perfect"), mockAdapter("sloppy")];
  } else {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error("OPENROUTER_API_KEY is not set. Export it or use --adapter mock.");
      process.exit(1);
    }
    if (args.models.length === 0) {
      const defaults = JSON.parse(readFileSync(join(evalsDir, "models.json"), "utf8")) as {
        models: string[];
      };
      args.models = defaults.models;
    }
    adapters = args.models.map((m) => new OpenRouterAdapter(m, apiKey));
    if (args.judge) judge = new OpenRouterAdapter(args.judge, apiKey, { temperature: 0 });
  }

  const run = await runEvals(adapters, tasks, { repair: args.repair, modes, judge, log: console.log });

  mkdirSync(args.out, { recursive: true });
  const stamp = run.startedAt.replace(/[:.]/g, "-");
  const jsonPath = join(args.out, `run-${stamp}.json`);
  const mdPath = join(args.out, `run-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(run, null, 2));
  writeFileSync(mdPath, toMarkdownReport(run));
  console.log(`\n${toMarkdownReport(run)}`);
  console.log(`Saved: ${jsonPath}\n       ${mdPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((cause) => {
    console.error(cause);
    process.exit(1);
  });
}
