import { escapeHtml, renderMermaidFallback } from "./fallback.js";
import { renderChartSVG } from "./render-svg.js";
import type { ChartColors } from "./render-svg.js";
import type { PaletteName } from "./palettes.js";
import { renderRollmark } from "./render.js";
import type { RollmarkBlock } from "./types.js";

/**
 * Browser-side document mounting: everything a consumer needs to turn a
 * Rollmark source string into a live DOM subtree. This is the integration
 * surface — a host application's wrapper should be a few lines around
 * mountRollmarkDocument (see the playground for a reference).
 *
 * Mermaid is intentionally not a dependency of this package (it is large
 * and browser-only). Pass your mermaid instance in `options.mermaid`;
 * without one, mermaid blocks degrade to readable code blocks.
 */

/** The subset of the mermaid API this module uses. */
export interface MermaidLike {
  initialize?(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

export interface MountOptions {
  /** "auto" (default) follows prefers-color-scheme at mount time. */
  theme?: "light" | "dark" | "auto";
  /** Named built-in series palette for charts. */
  palette?: PaletteName;
  /** Custom chart colors; `colors.series` wins over `palette`. */
  colors?: ChartColors;
  /** Consumer-supplied mermaid instance for diagram blocks. */
  mermaid?: MermaidLike;
  /**
   * Initialize the provided mermaid instance with securityLevel "strict"
   * and a theme matching the resolved Rollmark theme (default true).
   * Rollmark documents are untrusted input — disable only if you already
   * initialize mermaid yourself with an equally strict configuration.
   */
  initializeMermaid?: boolean;
}

export interface MountedRollmark {
  /** The document's visual blocks, in order (ids match data-rollmark-id). */
  blocks: RollmarkBlock[];
  /** Resolved theme actually used for rendering. */
  theme: "light" | "dark";
  /** Clear the container. */
  dispose(): void;
}

let mermaidCounter = 0;

function resolveTheme(theme: MountOptions["theme"]): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Render a Rollmark document into a container: Markdown to HTML (raw HTML
 * escaped), charts as Rollmark SVG, mermaid via the provided instance with
 * SPEC §4 fallback on failure.
 */
export async function mountRollmarkDocument(
  container: HTMLElement,
  source: string,
  options: MountOptions = {},
): Promise<MountedRollmark> {
  const theme = resolveTheme(options.theme);
  const { html, blocks } = renderRollmark(source);
  container.innerHTML = html;

  const mermaid = options.mermaid;
  if (mermaid && (options.initializeMermaid ?? true) && mermaid.initialize) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default",
    });
  }

  for (const block of blocks) {
    const el = container.querySelector<HTMLElement>(`[data-rollmark-id="${block.id}"]`);
    if (!el) continue;

    if (block.type === "chart" && block.spec) {
      el.innerHTML = renderChartSVG(block.spec, {
        theme,
        palette: options.palette,
        colors: options.colors,
      });
    } else if (block.type === "mermaid") {
      if (!mermaid) {
        el.outerHTML = `<pre><code>${escapeHtml(block.source)}</code></pre>`;
        continue;
      }
      const renderId = `rollmark-mmd-${mermaidCounter++}`;
      try {
        const { svg } = await mermaid.render(renderId, block.source);
        el.innerHTML = svg;
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        el.outerHTML = renderMermaidFallback(block.source, reason);
        // On parse failure mermaid leaves an orphaned "d<id>" element in <body>.
        if (typeof document !== "undefined") {
          document.getElementById(`d${renderId}`)?.remove();
        }
      }
    }
  }

  return {
    blocks,
    theme,
    dispose() {
      container.innerHTML = "";
    },
  };
}
