import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ChatMessage, ModelAdapter } from "./adapters.js";
import { OpenRouterAdapter, listOpenRouterModels, mockAdapter } from "./adapters.js";
import { toMarkdownReport } from "./report.js";
import { repairableIssues, scoreDocument } from "./score.js";
import type { MetricResults } from "./score.js";
import { getTasks } from "./tasks.js";
import type { EvalTask } from "./tasks.js";

const evalsDir = fileURLToPath(new URL(".", import.meta.url));

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

function userPrompt(task: EvalTask): string {
  return `${task.request}\n\nInput data:\n\n${task.input}`;
}

function repairPrompt(issues: string[]): string {
  return (
    `Your document failed validation with these problems:\n\n` +
    issues.map((i) => `- ${i}`).join("\n") +
    `\n\nPlease reply with the complete corrected Markdown document.`
  );
}

async function runTask(
  adapter: ModelAdapter,
  system: string,
  task: EvalTask,
  repair: boolean,
): Promise<TaskResult> {
  const usage = { promptTokens: 0, completionTokens: 0 };
  const documents: string[] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: userPrompt(task) },
  ];
  try {
    const first = await adapter.generate(messages, { taskId: task.id });
    usage.promptTokens += first.usage?.promptTokens ?? 0;
    usage.completionTokens += first.usage?.completionTokens ?? 0;
    documents.push(first.text);
    const firstAttempt = scoreDocument(task, first.text);

    const visibleIssues = repairableIssues(firstAttempt);
    if (firstAttempt.pass || !repair || visibleIssues.length === 0) {
      return { taskId: task.id, firstAttempt, final: firstAttempt, documents, usage };
    }

    messages.push(
      { role: "assistant", content: first.text },
      { role: "user", content: repairPrompt(visibleIssues) },
    );
    const second = await adapter.generate(messages, { taskId: task.id });
    usage.promptTokens += second.usage?.promptTokens ?? 0;
    usage.completionTokens += second.usage?.completionTokens ?? 0;
    documents.push(second.text);
    const repairAttempt = scoreDocument(task, second.text);
    return { taskId: task.id, firstAttempt, repairAttempt, final: repairAttempt, documents, usage };
  } catch (cause) {
    const failed: MetricResults = {
      markdownValid: false,
      blockDetected: false,
      jsonValid: null,
      schemaValid: null,
      chartTypeOk: null,
      dataFidelity: null,
      hasTitle: null,
      hasSummary: null,
      renderOk: null,
      pass: false,
      issues: [`generation failed: ${cause instanceof Error ? cause.message : cause}`],
      warningCount: 0,
    };
    return {
      taskId: task.id,
      firstAttempt: failed,
      final: failed,
      documents,
      usage,
      error: String(cause instanceof Error ? cause.message : cause),
    };
  }
}

export async function runEvals(
  adapters: ModelAdapter[],
  tasks: EvalTask[],
  options: { repair?: boolean; concurrency?: number; log?: (line: string) => void } = {},
): Promise<EvalRun> {
  const repair = options.repair ?? true;
  const concurrency = options.concurrency ?? 4;
  const log = options.log ?? (() => {});
  const system = systemPrompt();
  const models: ModelResult[] = [];

  for (const adapter of adapters) {
    log(`── ${adapter.id}`);
    const results: TaskResult[] = new Array(tasks.length);
    let next = 0;
    async function worker(): Promise<void> {
      while (next < tasks.length) {
        const index = next++;
        const task = tasks[index]!;
        const result = await runTask(adapter, system, task, repair);
        results[index] = result;
        const marker = result.final.pass ? "✓" : "✗";
        const repaired = result.repairAttempt ? " (after repair)" : "";
        log(`  ${marker} ${task.id}${result.final.pass ? repaired : `: ${result.final.issues[0] ?? ""}`}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
    models.push({ model: adapter.id, tasks: results });
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
  listModels?: string | true;
  out: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { adapter: "openrouter", models: [], tasks: [], repair: true, out: join(evalsDir, "results") };
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
  let adapters: ModelAdapter[];
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
  }

  const run = await runEvals(adapters, tasks, { repair: args.repair, log: console.log });

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
