# Rollmark

**Rollmark is a Markdown-based document format — and renderer — for AI-generated reports with charts.**

An LLM writes an ordinary Markdown report. Where the report needs a chart, the model writes a small fenced block; where it needs a diagram, it writes a Mermaid block. Rollmark parses the document, validates every chart against a strict semantic contract, and renders the charts with its own opinionated SVG renderer. Anywhere Rollmark isn't installed — GitHub, a text editor, an email client — the same document still reads cleanly, with each chart appearing as a labeled table.

````markdown
# Weekly acquisition report

Traffic increased **14%** this week, driven primarily by organic search.

```chart
bar
title: Visitors by channel
summary: Organic search led with 4,890 visitors, well ahead of every other channel.

channel | Visitors
Organic search | 4890
Social | 2310
Direct | 1750
Referral | 1150
```
````

That block renders as a themed bar chart in Rollmark, and as the readable text above everywhere else.

Status: **v1, incubating.** Springroll is the first intended consumer. APIs may still move.

## Why this exists

Getting an LLM to produce a report with charts has a shape problem: full charting languages (Vega-Lite, ECharts configs) are verbose, easy for models to get subtly wrong, and hand the model control over presentation it shouldn't have; raw HTML/SVG output is unauditable and a security liability. Rollmark's answer is a deliberately tiny **semantic** chart language plus a hard rule:

> **Models set data, chart type, labels, and intent. The renderer sets everything visual.**

There are no color, font, size, or styling options in the format — the renderer owns presentation, so every chart is consistent, theme-aware, and accessible, and the model's only job is to state the data faithfully.

The design is evidence-driven: the repo ships an eval harness that measures, across model families from 8B up, whether models can actually generate the format — validity, **exact data fidelity**, chart-type choice, and whether the prose `summary` tells the truth about the data (LLM-judged). Current baseline: **100% schema validity across all nine tested models, 100% data fidelity, and correct pie/scatter/stacked choices at every tier.** Failure modes discovered by the evals are fed back into the prompt kit; see [`evals/FINDINGS.md`](./evals/FINDINGS.md) for the full history and numbers.

## How it works

```text
Markdown source (model output)
        │
        ▼
markdown-it + rollmarkPlugin      recognizes ```chart and ```mermaid fences
        │
        ▼
Chart DSL parser + validator      → ChartSpec (or a structured error)
        │
        ▼
renderChartSVG(spec, theme)       Rollmark's own renderer: d3 micro-modules
        │                         for the math, Rollmark for the opinions
        ▼
Static SVG                        same code path in browser and on server
```

Key properties:

- **Every document is valid Markdown.** Unsupported viewers degrade to readable code blocks.
- **Failure is local.** An invalid chart renders as a fallback card (title + summary + reason + collapsible source); the rest of the document is untouched.
- **Untrusted by default.** Raw HTML is escaped, Mermaid runs with `securityLevel: strict`, chart payloads are declarative data with hard size limits, and the parser is fuzz-tested to never throw.
- **The renderer is DOM-free.** `renderChartSVG` returns an SVG string, so server-side rendering — email, PDF, static export — is the identical call.

## Quick start

Not yet on npm; consume it as a file/git dependency (`"rollmark": "file:../rollmark"` or a git URL), or work in this repo directly.

```ts
import { renderRollmark, renderChartSVG } from "rollmark";

const { html, blocks } = renderRollmark(markdownSource);
// html: the document, with a placeholder div per visual block:
//   <div data-rollmark-block="chart" data-rollmark-id="0"></div>
// blocks: each block's validated ChartSpec (or its errors), by id.

for (const block of blocks) {
  if (block.type === "chart" && block.spec) {
    element(block.id).innerHTML = renderChartSVG(block.spec, { theme: "dark" });
  } else if (block.type === "mermaid") {
    // render block.source with mermaid ({ securityLevel: "strict" })
  }
}
```

Invalid charts never reach `block.spec` — the plugin renders their fallback card directly into `html`, so a broken chart degrades gracefully with zero client-side work. See [`playground/src/mount.ts`](./playground/src/mount.ts) for a complete reference integration.

To make a *model* produce Rollmark, use the ready-made system-prompt snippet and few-shot examples in [`prompt-kit/`](./prompt-kit/) — the rules in it are load-bearing (each one prevents a failure mode observed in evals).

## The chart language

Five types — `line`, `bar`, `area`, `scatter`, `pie` — plus `stack: true` for stacked bars/areas. The first table column is the x-axis, every other column is a series, headers are the labels, empty cells are gaps, ISO dates automatically produce a time axis, and `summary:` is the always-present honest description of what the chart shows.

Full guide: [`docs/chart-dsl.md`](./docs/chart-dsl.md). Normative spec: [`SPEC.md`](./SPEC.md). A JSON payload shape is also accepted (for structured-output pipelines): [`schemas/chart.v1.json`](./schemas/chart.v1.json).

## API surface

| Export | What it does |
|---|---|
| `renderRollmark(source, md?)` | Markdown → `{ html, blocks }`; the one-call entry point |
| `rollmarkPlugin` | The markdown-it plugin, for use with your own markdown-it instance |
| `renderChartSVG(spec, { theme?, width?, height? })` | ChartSpec → static SVG string (browser or server) |
| `validateChartPayload(source)` | Validate a fence payload (DSL or JSON) → `ChartSpec` or structured errors |
| `parseChartDsl(source)` / `validateChart(source)` / `validateChartValue(value)` | The individual syntax/semantic layers |
| `renderChartFallback` / `renderMermaidFallback` | The SPEC §4 failure cards as HTML |
| `LIMITS`, types (`ChartSpec`, `RollmarkBlock`, …) | Contract constants and TypeScript types |

## Playground and eval viewer

```sh
npm run build                      # playground consumes the built package
npm --prefix playground install    # first time only
npm run playground                 # live editor: Markdown left, rendered report right
npm run viewer                     # eval results browser (see below)
```

## Evals

The eval harness is a first-class part of the project — the format's reliability claims are measured, not asserted.

```sh
export OPENROUTER_API_KEY=sk-or-...
npm run eval                                   # 15 tasks × models in evals/models.json
npm run eval -- --adapter mock                 # offline smoke test of the harness
npm run eval -- --judge google/gemini-3-flash-preview     # + summary-honesty judge
npm run eval -- --formats json,dsl             # A/B payload syntaxes
npm run eval -- --mode both                    # direct vs structured-output generation
npm run eval -- --list-models qwen             # check current OpenRouter model ids
```

Per model it measures the validity chain (fence → parse → schema → render), **data fidelity** (were the source numbers preserved exactly?), chart-type appropriateness, chart restraint (a task where the right answer is *no* chart), first-pass vs. after-repair success (validation errors are fed back once; hidden metrics never leak into the repair prompt), and summary-vs-data consistency via an LLM judge.

Reports land in `evals/results/`; `npm run viewer` gives a model × task matrix where every cell renders the model's actual output, with attempt-1 vs. after-repair tabs and a compare-all-models view per task. Accumulated conclusions: [`evals/FINDINGS.md`](./evals/FINDINGS.md).

## Repository layout

| Path | Contents |
|---|---|
| `SPEC.md` | The normative v1 format specification |
| `src/` | The package: markdown-it plugin, DSL parser, validator, SVG renderer, fallbacks |
| `docs/` | `chart-dsl.md` authoring guide; `design/` holds the original design explorations |
| `prompt-kit/` | System-prompt snippet + few-shot examples for producing models |
| `schemas/` | JSON Schema for the JSON payload alternate |
| `examples/` | Example reports, validated in CI |
| `evals/` | Model eval harness, tasks, findings |
| `playground/` | Live editor + eval results viewer (Vite) |
| `TODO.md` | Project board |

## Development

```sh
npm install
npm test           # vitest: 88 tests incl. SVG snapshots and parser fuzzing
npm run typecheck
npm run build      # tsc → dist/
```

## Scope and roadmap

Deliberately **in** v1: the five chart types, stacking, temporal inference, static themed SVG, graceful fallback, the eval harness.

Deliberately **out** (until evidence demands them): interactivity/tooltips beyond native `<title>` hover, streaming-aware rendering (v1 is non-streaming by spec; the design doesn't foreclose it), presentation options of any kind, additional block types (`metrics`, `status`, `timeline`, `progress` are reserved), external data references, and a `vega-lite` escape-hatch fence for power users.

The growth rule: nothing enters the format without passing the eval gate on the cheap-model tier.
