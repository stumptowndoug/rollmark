import { darkQuery, renderDocumentInto } from "./mount.js";
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
  /** Format runs: chart fences transcoded to JSON for rendering. */
  rendered?: string[];
  error?: string;
}
interface ModelResult {
  model: string;
  mode?: "direct" | "structured";
  format?: string;
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
let mountedList: MountedDocument[] = [];
let selected: { model: number; task: string } | undefined;
let selectedTask: string | undefined; // compare-across-models mode
let attemptIndex = 0;

function disposeMounted(): void {
  for (const m of mountedList) m.dispose();
  mountedList = [];
}

function modelLabel(m: ModelResult): string {
  if (m.format) return `${m.model} [${m.format}]`;
  return m.mode === "structured" ? `${m.model} [structured]` : m.model;
}

/** Renderable version of an attempt: format runs render the transcoded doc. */
function renderableDoc(t: TaskResult, index: number): string | undefined {
  return t.rendered?.[index] ?? t.documents[index];
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
  const head = tasks
    .map(
      (id) =>
        `<th class="col${selectedTask === id ? " selected" : ""}" data-task="${id}" title="compare all models on ${id}">${id}</th>`,
    )
    .join("");
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
      selectedTask = undefined;
      attemptIndex = -1; // latest
      renderMatrix(run);
      void renderDetail();
    });
  });
  matrixEl.querySelectorAll<HTMLElement>("thead th.col").forEach((th) => {
    th.addEventListener("click", () => {
      selectedTask = th.dataset.task!;
      selected = undefined;
      renderMatrix(run);
      void renderCompare();
    });
  });
}

/** Compare mode: every model's final output for one task, stacked. */
async function renderCompare(): Promise<void> {
  disposeMounted();
  if (!currentRun || !selectedTask) return;
  const entries = currentRun.models
    .map((m, mi) => ({ m, mi, t: m.tasks.find((t) => t.taskId === selectedTask) }))
    .filter((e): e is { m: ModelResult; mi: number; t: TaskResult } => e.t !== undefined);

  detailEl.innerHTML =
    `<h2>${selectedTask} · ${entries.length} model outputs</h2>` +
    `<p class="placeholder">Final attempt per model. Click a matrix cell for full details and attempt history.</p>` +
    entries
      .map(({ m, mi, t }) => {
        const chip = chipFor(t);
        const doc = renderableDoc(t, t.documents.length - 1);
        const note = !t.final.pass
          ? escapeHtml(t.error ?? t.final.issues[0] ?? "failed")
          : t.final.summaryConsistent === false
            ? escapeHtml(t.final.issues.find((i) => i.includes("[judge]")) ?? "summary flagged")
            : t.repairAttempt
              ? "passed after repair — showing the repaired document"
              : "";
        return (
          `<section class="cmp">` +
          `<div class="cmp-head"><span class="chip ${chip.cls}">${chip.text}</span><strong>${modelLabel(m)}</strong></div>` +
          (note ? `<p class="cmp-note">${note}</p>` : "") +
          (doc !== undefined
            ? `<div class="cmp-doc" id="cmp-doc-${mi}"></div>`
            : `<p class="cmp-note">no document produced</p>`) +
          `</section>`
        );
      })
      .join("");

  for (const { mi, t } of entries) {
    const el = document.getElementById(`cmp-doc-${mi}`);
    const doc = renderableDoc(t, t.documents.length - 1);
    if (el && doc !== undefined) {
      mountedList.push(await renderDocumentInto(el, doc));
    }
  }
}

async function renderDetail(): Promise<void> {
  disposeMounted();
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

  const renderable = renderableDoc(task, attemptIndex);
  if (renderable !== undefined) {
    mountedList.push(await renderDocumentInto(document.getElementById("doc")!, renderable));
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
  selectedTask = undefined;
  disposeMounted();
  detailEl.innerHTML = `<p class="placeholder">Pick a cell to see one model's output, or click a task column header to compare every model on that task.</p>`;
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

darkQuery.addEventListener("change", () => {
  void (selectedTask ? renderCompare() : renderDetail());
});

init();
