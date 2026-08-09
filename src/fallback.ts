import type { ChartPartial, ValidationIssue } from "./types.js";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Fallback content for a chart block that failed validation (SPEC.md §4):
 * title and summary if parseable, a human-readable reason, and the original
 * source behind a disclosure. Works without JavaScript.
 */
export function renderChartFallback(
  source: string,
  errors: ValidationIssue[],
  partial: ChartPartial,
): string {
  const reason = errors[0]?.message ?? "unknown error";
  const parts: string[] = [`<div class="rollmark-fallback" data-rollmark-block="chart">`];
  if (partial.title) {
    parts.push(`<p class="rollmark-fallback-title">${escapeHtml(partial.title)}</p>`);
  }
  if (partial.summary) {
    parts.push(`<p class="rollmark-fallback-summary">${escapeHtml(partial.summary)}</p>`);
  }
  parts.push(
    `<p class="rollmark-fallback-reason">Chart could not be rendered: ${escapeHtml(reason)}</p>`,
    `<details class="rollmark-fallback-source"><summary>View chart specification</summary>`,
    `<pre><code>${escapeHtml(source)}</code></pre></details>`,
    `</div>`,
  );
  return parts.join("\n") + "\n";
}

/** Fallback for a mermaid block that failed to render client-side (SPEC.md §4). */
export function renderMermaidFallback(source: string, reason: string): string {
  return (
    `<div class="rollmark-fallback" data-rollmark-block="mermaid">\n` +
    `<p class="rollmark-fallback-reason">Diagram could not be rendered: ${escapeHtml(reason)}</p>\n` +
    `<pre><code>${escapeHtml(source)}</code></pre>\n` +
    `</div>\n`
  );
}
