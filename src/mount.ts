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
  /**
   * Instant styled hover tooltips on chart marks (default true). Content
   * derives entirely from the chart data — nothing for producers to
   * declare. Native <title> hover remains the fallback when disabled.
   */
  tooltips?: boolean;
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

/**
 * One delegated tooltip per mounted document: a single fixed-position div
 * that follows the pointer across chart marks, themed to match, clamped to
 * the viewport. Returns a cleanup function.
 */
function attachTooltips(container: HTMLElement, theme: "light" | "dark"): () => void {
  const tip = document.createElement("div");
  tip.className = "rollmark-tooltip";
  Object.assign(tip.style, {
    position: "fixed",
    display: "none",
    pointerEvents: "none",
    zIndex: "1000",
    padding: "6px 10px",
    borderRadius: "6px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "12px",
    lineHeight: "1.45",
    maxWidth: "280px",
    background: theme === "dark" ? "#23262c" : "#ffffff",
    color: theme === "dark" ? "#e5e7eb" : "#1f2733",
    border: `1px solid ${theme === "dark" ? "#3a3f47" : "#d0d4da"}`,
    boxShadow: "0 2px 10px rgba(0, 0, 0, 0.25)",
  });
  document.body.appendChild(tip);

  const position = (x: number, y: number): void => {
    const r = tip.getBoundingClientRect();
    const left = Math.max(4, Math.min(x + 12, window.innerWidth - r.width - 6));
    const top = y + 14 + r.height > window.innerHeight ? y - r.height - 10 : y + 14;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  };

  const over = (e: Event): void => {
    const target = (e.target as Element | null)?.closest?.("[data-rm-v]");
    if (!target) {
      tip.style.display = "none";
      return;
    }
    const x = target.getAttribute("data-rm-x") ?? "";
    const seriesName = target.getAttribute("data-rm-s");
    const value = target.getAttribute("data-rm-v") ?? "";
    const color = target.getAttribute("fill") ?? "currentColor";
    tip.innerHTML =
      `<div style="display:flex;align-items:center;gap:6px">` +
      `<span style="width:9px;height:9px;border-radius:2px;background:${escapeHtml(color)};flex:none"></span>` +
      `<strong>${escapeHtml(seriesName ?? x)}</strong></div>` +
      `<div style="opacity:0.85">${escapeHtml(seriesName ? `${x} · ${value}` : value)}</div>`;
    tip.style.display = "block";
    const me = e as MouseEvent;
    position(me.clientX ?? 0, me.clientY ?? 0);
  };
  const move = (e: Event): void => {
    if (tip.style.display !== "none") {
      const me = e as MouseEvent;
      position(me.clientX ?? 0, me.clientY ?? 0);
    }
  };
  const out = (e: Event): void => {
    const to = (e as MouseEvent).relatedTarget as Element | null;
    if (!to?.closest?.("[data-rm-v]")) tip.style.display = "none";
  };

  container.addEventListener("pointerover", over);
  container.addEventListener("pointermove", move);
  container.addEventListener("pointerout", out);
  return () => {
    container.removeEventListener("pointerover", over);
    container.removeEventListener("pointermove", move);
    container.removeEventListener("pointerout", out);
    tip.remove();
  };
}

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

  let detachTooltips: (() => void) | undefined;
  if (options.tooltips ?? true) {
    const marks = container.querySelectorAll("[data-rm-v]");
    if (marks.length > 0) {
      // The styled tooltip replaces native <title> hover on marks (both at
      // once would double up); tick-label titles keep their hover text.
      container.querySelectorAll("[data-rm-v] > title").forEach((t) => t.remove());
      detachTooltips = attachTooltips(container, theme);
    }
  }

  return {
    blocks,
    theme,
    dispose() {
      detachTooltips?.();
      container.innerHTML = "";
    },
  };
}
