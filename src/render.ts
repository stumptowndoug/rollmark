import MarkdownIt from "markdown-it";

import { rollmarkPlugin } from "./markdown-it-plugin.js";
import type { RollmarkBlock } from "./types.js";

export interface RenderResult {
  /** Document HTML with placeholder divs for valid visual blocks. */
  html: string;
  /** Visual blocks in document order; ids match data-rollmark-id attributes. */
  blocks: RollmarkBlock[];
}

let defaultMd: MarkdownIt | undefined;

function getDefaultMd(): MarkdownIt {
  if (!defaultMd) {
    // Untrusted model output: raw HTML renders as escaped text (SPEC.md §1.2).
    defaultMd = new MarkdownIt({ html: false, linkify: true });
    defaultMd.use(rollmarkPlugin);
  }
  return defaultMd;
}

/**
 * Render a Rollmark document to HTML plus its visual-block registry.
 *
 * Pass a preconfigured MarkdownIt instance (already `.use(rollmarkPlugin)`)
 * to control Markdown options or add plugins.
 */
export function renderRollmark(source: string, md: MarkdownIt = getDefaultMd()): RenderResult {
  const env: Record<string, unknown> = {};
  const html = md.render(source, env);
  const blocks = (env.rollmark as { blocks: RollmarkBlock[] } | undefined)?.blocks ?? [];
  return { html, blocks };
}
