import type MarkdownIt from "markdown-it";
import type { Options } from "markdown-it";
import type Renderer from "markdown-it/lib/renderer.mjs";
import type { RenderRule } from "markdown-it/lib/renderer.mjs";
import type Token from "markdown-it/lib/token.mjs";

import { renderChartFallback } from "./fallback.js";
import { validateChartPayload } from "./parse-dsl.js";
import type { RollmarkBlock } from "./types.js";

export interface RollmarkEnvState {
  blocks: RollmarkBlock[];
}

/** Block names this plugin upgrades. Unregistered fences stay code blocks (SPEC.md §1.3). */
const VISUAL_BLOCKS = new Set(["chart", "mermaid"]);

function ensureState(env: Record<string, unknown>): RollmarkEnvState {
  if (!env.rollmark) {
    env.rollmark = { blocks: [] } satisfies RollmarkEnvState;
  }
  return env.rollmark as RollmarkEnvState;
}

function placeholder(type: "chart" | "mermaid", id: number): string {
  return `<div class="rollmark-block" data-rollmark-block="${type}" data-rollmark-id="${id}"></div>\n`;
}

/**
 * markdown-it plugin implementing SPEC.md §1.3 (Option A: placeholders).
 *
 * Valid `chart` and all `mermaid` fences render as placeholder divs and are
 * registered on `env.rollmark.blocks` for the host application to mount.
 * Invalid `chart` fences render their fallback content immediately, so the
 * failure is visible even with no client-side mounting. Every other fence
 * falls through to the default code-block renderer.
 */
export function rollmarkPlugin(md: MarkdownIt): void {
  const defaultFence: RenderRule =
    md.renderer.rules.fence ??
    ((tokens: Token[], idx: number, options: Options, _env: unknown, self: Renderer) =>
      self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (
    tokens: Token[],
    idx: number,
    options: Options,
    env: Record<string, unknown>,
    self: Renderer,
  ) => {
    const token = tokens[idx]!;
    // Block name: first whitespace-delimited word of the info string,
    // case-sensitive; remaining info-string content is reserved and ignored
    // (SPEC.md §1.3).
    const name = token.info.trim().split(/\s+/)[0] ?? "";
    if (!VISUAL_BLOCKS.has(name)) {
      return defaultFence(tokens, idx, options, env, self);
    }

    const state = ensureState(env);
    const id = state.blocks.length;
    const source = token.content;

    if (name === "mermaid") {
      state.blocks.push({ id, type: "mermaid", source });
      return placeholder("mermaid", id);
    }

    const result = validateChartPayload(source);
    if (result.ok) {
      state.blocks.push({ id, type: "chart", source, spec: result.spec, warnings: result.warnings });
      return placeholder("chart", id);
    }
    state.blocks.push({ id, type: "chart", source, errors: result.errors, warnings: result.warnings });
    return renderChartFallback(source, result.errors, result.partial);
  };
}
