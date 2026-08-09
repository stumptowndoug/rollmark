# Rollmark

**Rollmark is an experimental Markdown-based document format and renderer for AI-generated visual reports.** [Springroll](https://github.com/) is its first intended consumer.

A Rollmark document is ordinary Markdown in which two specially labeled fenced blocks carry semantic meaning — `chart` for quantitative data and `mermaid` for diagrams. A Rollmark renderer upgrades them into visual components; every other Markdown viewer (GitHub, a text editor) shows readable code blocks instead. See [SPEC.md](./SPEC.md) for the format definition.

Charts use a small Markdown-native DSL (JSON is accepted as an alternate), and Rollmark ships its own opinionated SVG renderer — d3 micro-modules provide the math, Rollmark provides the opinions:

````markdown
```chart
bar
title: Visitors by channel
summary: Organic search led with 4,890 visitors.

channel | Visitors
Organic search | 4890
Social | 2310
Direct | 1750
```
````

Status: **incubating**. The syntax, schema, and APIs may change without notice.

## Usage

```ts
import { renderRollmark, renderChartSVG } from "rollmark";

const { html, blocks } = renderRollmark(markdownSource);

// html contains the document with placeholder divs:
//   <div data-rollmark-block="chart" data-rollmark-id="0"></div>
// blocks[] holds each visual block's validated spec (or errors) by id.

for (const block of blocks) {
  if (block.type === "chart" && block.spec) {
    const svg = renderChartSVG(block.spec, { theme: "light" }); // static SVG string
    // works in the browser AND on the server — email/PDF export is the same call
  }
  // block.type === "mermaid": render block.source with mermaid
  // (securityLevel: "strict" — documents are untrusted input)
}
```

An ECharts compiler (`compileToECharts`) remains available as an alternate `ChartCompiler` behind the same `ChartSpec` boundary.

Invalid chart blocks never reach `blocks[].spec`; the plugin renders their fallback (title, summary, reason, and collapsible source) directly into the HTML, so a broken chart degrades gracefully without any client-side work.

Bring your own `markdown-it` instance to control options or add plugins:

```ts
import MarkdownIt from "markdown-it";
import { rollmarkPlugin, renderRollmark } from "rollmark";

const md = new MarkdownIt({ html: false }).use(rollmarkPlugin);
const { html, blocks } = renderRollmark(source, md);
```

## Repository layout

| Path | Contents |
|---|---|
| `SPEC.md` | The Rollmark v1 specification |
| `schemas/chart.v1.json` | JSON Schema for the `chart` payload (producer contract; works with structured-output APIs) |
| `prompt-kit/` | System-prompt snippet and few-shot examples for models that generate Rollmark |
| `src/` | markdown-it plugin, chart DSL parser, validator, SVG renderer, fallback rendering |
| `evals/` | Model evaluation harness (see Evals below) |
| `playground/` | Live editor: paste Rollmark, see charts/diagrams/fallbacks render |
| `examples/` | Example documents, validated in CI |
| `springroll-markdown-visual-reports.md`, `testing-overview.md` | Design docs |
| `TODO.md` | Project board |

## Development

```sh
npm install
npm test        # vitest
npm run build   # tsc → dist/
```

### Playground

```sh
npm run build                      # playground consumes the built package
npm --prefix playground install    # first time only
npm run playground                 # editor at /index.html
npm run viewer                     # eval viewer, opens /results.html
```

Left pane is the Markdown source, right pane renders it live: ECharts for `chart` blocks, Mermaid (`securityLevel: strict`) for diagrams, the SPEC §4 fallback card for invalid charts, with light/dark following the system theme.

The same dev server hosts the **eval viewer** at `/results.html`: pick a run from `evals/results/`, get a model × task matrix (✓ first try, ↻ after repair, ⚠ summary flagged by the judge, ✗ failed), and click any cell to see that model's actual document rendered — metric chips, judge verdicts, and attempt-1 vs. after-repair tabs included. Run `npm run eval` first; new result files appear after a dev-server restart.

## Evals

The eval suite measures whether models can reliably generate Rollmark: fence formation, JSON/schema validity, **data fidelity** (exact preservation of source values), chart-type appropriateness, presence of `summary`, first-pass success, and recovery via a one-shot repair loop. Twelve tasks cover JSON/CSV/prose inputs, temporal and categorical data, multi-series, null gaps, negatives/decimals, thousands-separator parsing, a diagram task, a "no chart warranted" task, and a two-chart document.

```sh
# Offline smoke test of the whole harness (mock models):
npm run eval -- --adapter mock

# Against real models via OpenRouter:
export OPENROUTER_API_KEY=sk-or-...
npm run eval                                  # model list from evals/models.json
npm run eval -- --models openai/gpt-4o-mini,qwen/qwen3-8b
npm run eval -- --tasks ts-basic,prose-input --no-repair

# Generation strategies: direct Markdown (default), structured output +
# serializer, or both side by side. Optional LLM judge scores whether each
# chart's summary is consistent with its data:
npm run eval -- --mode both --judge google/gemini-3-flash-preview

# Model ids drift; check what's available:
npm run eval -- --list-models qwen
```

Each run prints a per-model results table and writes JSON + Markdown reports to `evals/results/`.

## Design principles (short version)

1. Every Rollmark document is valid Markdown; unsupported viewers degrade to code blocks.
2. Models set data, chart type, labels, and intent; the renderer sets everything visual.
3. The persisted format never depends on a rendering library.
4. Failure is local and graceful — a bad block never breaks the document.
5. Generation reliability is measured, not assumed (eval suite: planned).
