import mermaid from "mermaid";
import { renderChartSVG, renderMermaidFallback, renderRollmark } from "rollmark";

export const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

let mermaidCounter = 0;

export function initMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    // Rollmark documents are untrusted input (SPEC.md §3).
    securityLevel: "strict",
    theme: darkQuery.matches ? "dark" : "default",
  });
}

export interface MountedDocument {
  dispose(): void;
  resize(): void;
}

/**
 * Render a Rollmark document into a container: HTML via the package (raw
 * HTML escaped), charts via Rollmark's own SVG renderer, diagrams via
 * Mermaid mounted into the placeholders.
 */
export async function renderDocumentInto(
  container: HTMLElement,
  source: string,
): Promise<MountedDocument> {
  const { html, blocks } = renderRollmark(source);
  container.innerHTML = html;

  for (const block of blocks) {
    const el = container.querySelector<HTMLElement>(`[data-rollmark-id="${block.id}"]`);
    if (!el) continue;

    if (block.type === "chart" && block.spec) {
      el.innerHTML = renderChartSVG(block.spec, {
        theme: darkQuery.matches ? "dark" : "light",
      });
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

  return {
    dispose() {
      container.innerHTML = "";
    },
    // SVG charts scale via viewBox; nothing to do on resize.
    resize() {},
  };
}
