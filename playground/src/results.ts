import { darkQuery, initMermaid, renderDocumentInto } from "./mount.js";
import type { MountedDocument } from "./mount.js";

// Minimal shapes of evals/run.ts output — kept local so the viewer only
// depends on the persisted JSON, not the eval harness code.
interface MetricResults {
  markdownValid: boolean;
  blockDetected: boolean;
  jsonValid: boolean | null;
  schemaValid: boolean | null;
  chartTypeOk: boolean | null;
  dataFidelity: boolean | null;
  hasTitle: boolean | null;
  hasSummary: boolean | null;
  renderOk: boolean | null;
  summaryConsistent?: boolean | null;
  pass: boolean;
  issues: string[];
}
interface TaskResult {
  taskId: string;
  firstAttempt: MetricResults;
  repairAttempt?: MetricResults;
  final: MetricResults;
  documents: string[];
  error?: string;
}
interface ModelResult {
  model: string;
  mode?: "direct" | "structured";
  tasks: TaskResult[];
}
interface EvalRun {
  startedAt: string;
  models: ModelResult[];
  taskIds: string[];
}

const METRICS: [keyof MetricResults, string][] = [
  ["markdownValid", "markdown"],
  ["blockDetected", "block"],
  ["jsonValid", "json"],
  ["schemaValid", "schema"],
  ["chartTypeOk", "chart type"],
  ["dataFidelity", "fidelity"],
  ["hasTitle", "title"],
  ["hasSummary", "summary"],
  ["renderOk", "render"],
  ["summaryConsistent", "summary honest"],
];

// Eagerly list, lazily load: new run files appear after a dev-server restart.
const runFiles = import.meta.glob("../../evals/results/run-*.json") as Record<
  string,
  () => Promise<{ default: EvalRun }>
>;

const runSelect = document.getElementById("run-select") as HTMLSelectElement;
const matrixEl = document.getElementById("matrix") as HTMLDivElement;
const detailEl = document.getElementById("detail") as HTMLDivElement;

let currentRun: EvalRun | undefined;
let mounted: MountedDocument | undefined;
let selected: { model: number; task: string } | undefined;
let attemptIndex = 0;

function modelLabel(m: ModelResult): string {
  return m.mode === "structured" ? `${m.model} [structured]` : m.model;
}

function chipFor(t: TaskResult | undefined): { cls: string; text: string; title: string } {
  if (!t) return { cls: "empty", text: "", title: "" };
  if (!t.final.pass) return { cls: "fail", text: "✗", title: t.final.issues[0] ?? "failed" };
  if (t.final.summaryConsistent === false)
    return { cls: "flag", text: "⚠", title: "passed, but summary judged inconsistent" };
  if (t.repairAttempt) return { cls: "repair", text: "↻", title: "passed after repair" };
  return { cls: "pass", text: "✓", title: "passed first try" };
}

function renderMatrix(run: EvalRun): void {
  const tasks = run.taskIds;
  const head = tasks.map((id) => `<th>${id}</th>`).join("");
  const rows = run.models
    .map((m, mi) => {
      const byTask = new Map(m.tasks.map((t) => [t.taskId, t]));
      const cells = tasks
        .map((taskId) => {
          const chip = chipFor(byTask.get(taskId));
          const sel =
            selected && selected.model === mi && selected.task === taskId ? " selected" : "";
          return `<td><span class="chip ${chip.cls}${sel}" title="${chip.title.replaceAll('"', "&quot;")}" data-model="${mi}" data-task="${taskId}">${chip.text}</span></td>`;
        })
        .join("");
      return `<tr><th>${modelLabel(m)}</th>${cells}</tr>`;
    })
    .join("");
  matrixEl.innerHTML =
    `<table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>` +
    `<div id="legend">` +
    `<span><span class="chip pass">✓</span>first try</span>` +
    `<span><span class="chip repair">↻</span>after repair</span>` +
    `<span><span class="chip flag">⚠</span>summary flagged</span>` +
    `<span><span class="chip fail">✗</span>failed</span>` +
    `</div>`;

  matrixEl.querySelectorAll<HTMLElement>(".chip:not(.empty)").forEach((chip) => {
    chip.addEventListener("click", () => {
      selected = { model: Number(chip.dataset.model), task: chip.dataset.task! };
      attemptIndex = -1; // latest
      renderMatrix(run);
      void renderDetail();
    });
  });
}

async function renderDetail(): Promise<void> {
  mounted?.dispose();
  mounted = undefined;
  if (!currentRun || !selected) return;
  const model = currentRun.models[selected.model]!;
  const task = model.tasks.find((t) => t.taskId === selected!.task);
  if (!task) return;

  const attempts = task.documents.length;
  if (attemptIndex < 0 || attemptIndex >= attempts) attemptIndex = Math.max(0, attempts - 1);
  const metrics = attemptIndex === 0 ? task.firstAttempt : (task.repairAttempt ?? task.final);

  const metricChips = METRICS.map(([key, label]) => {
    const v = metrics[key];
    const cls = v === true ? "ok" : v === false ? "bad" : "";
    const mark = v === true ? "✓" : v === false ? "✗" : "—";
    return `<span class="metric ${cls}">${label} ${mark}</span>`;
  }).join("");

  const issues =
    metrics.issues.length > 0
      ? `<ul class="issues">${metrics.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
      : "";

  const tabs =
    attempts > 1
      ? `<div class="attempt-tabs">` +
        task.documents
          .map(
            (_, i) =>
              `<button data-attempt="${i}" class="${i === attemptIndex ? "active" : ""}">` +
              `${i === 0 ? "attempt 1" : "after repair"}</button>`,
          )
          .join("") +
        `</div>`
      : "";

  const source = task.documents[attemptIndex];
  detailEl.innerHTML =
    `<h2>${modelLabel(model)} · ${task.taskId}</h2>` +
    `<div class="metrics">${metricChips}</div>` +
    issues +
    tabs +
    (task.error && attempts === 0 ? `<p class="issues">${escapeHtml(task.error)}</p>` : "") +
    `<div id="doc"></div>` +
    (source !== undefined
      ? `<details class="source"><summary>View Markdown source</summary><pre>${escapeHtml(source)}</pre></details>`
      : "");

  detailEl.querySelectorAll<HTMLButtonElement>(".attempt-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      attemptIndex = Number(btn.dataset.attempt);
      void renderDetail();
    });
  });

  if (source !== undefined) {
    mounted = await renderDocumentInto(document.getElementById("doc")!, source);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadRun(path: string): Promise<void> {
  currentRun = (await runFiles[path]!()).default;
  selected = undefined;
  detailEl.innerHTML = `<p class="placeholder">Pick a cell to see that model's actual output.</p>`;
  renderMatrix(currentRun);
}

function init(): void {
  const paths = Object.keys(runFiles).sort().reverse();
  if (paths.length === 0) {
    matrixEl.innerHTML = `<p class="placeholder" style="color: var(--muted)">No runs found. Run <code>npm run eval</code> first — results land in <code>evals/results/</code>. (New files need a dev-server restart.)</p>`;
    return;
  }
  runSelect.innerHTML = paths
    .map((p) => {
      const name = p.split("/").pop()!.replace(/\.json$/, "");
      return `<option value="${p}">${name}</option>`;
    })
    .join("");
  runSelect.addEventListener("change", () => void loadRun(runSelect.value));
  void loadRun(paths[0]!);
}

window.addEventListener("resize", () => mounted?.resize());
darkQuery.addEventListener("change", () => {
  initMermaid();
  void renderDetail();
});

initMermaid();
init();
