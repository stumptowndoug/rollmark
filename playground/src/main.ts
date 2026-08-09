import * as echarts from "echarts";
import mermaid from "mermaid";
import { compileToECharts, renderMermaidFallback, renderRollmark } from "rollmark";

import exampleDoc from "../../examples/weekly-analytics.md?raw";

const input = document.getElementById("input") as HTMLTextAreaElement;
const preview = document.getElementById("preview") as HTMLDivElement;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

let liveCharts: echarts.ECharts[] = [];
let mermaidCounter = 0;

function initMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    // Rollmark documents are untrusted input (SPEC.md §3).
    securityLevel: "strict",
    theme: darkQuery.matches ? "dark" : "default",
  });
}

async function render(): Promise<void> {
  for (const chart of liveCharts) chart.dispose();
  liveCharts = [];

  const { html, blocks } = renderRollmark(input.value);
  // Safe to inject: the renderer escapes raw HTML (markdown-it html:false),
  // and fallback content is escaped by the package.
  preview.innerHTML = html;

  for (const block of blocks) {
    const el = preview.querySelector<HTMLElement>(`[data-rollmark-id="${block.id}"]`);
    if (!el) continue;

    if (block.type === "chart" && block.spec) {
      const chart = echarts.init(el, darkQuery.matches ? "dark" : undefined);
      chart.setOption(compileToECharts(block.spec));
      liveCharts.push(chart);
    } else if (block.type === "mermaid") {
      const renderId = `rollmark-mmd-${mermaidCounter++}`;
      try {
        const { svg } = await mermaid.render(renderId, block.source);
        el.innerHTML = svg;
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        el.outerHTML = renderMermaidFallback(block.source, reason);
        // On parse failure mermaid leaves an orphaned "d<id>" element in <body>.
        document.getElementById(`d${renderId}`)?.remove();
      }
    }
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(render, 250);
});

window.addEventListener("resize", () => {
  for (const chart of liveCharts) chart.resize();
});

darkQuery.addEventListener("change", () => {
  initMermaid();
  void render();
});

initMermaid();
input.value = exampleDoc;
void render();
