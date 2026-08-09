# Rollmark

**Markdown that carries charts — built for reports written by AI.**

An AI assistant writes a report in ordinary Markdown. Where the report needs a chart, it writes a small text block — readable on its own, like a labeled table. Rollmark turns those blocks into clean, consistent charts:

```chart
line
title: Daily visitors
summary: Daily visitors grew from 1,240 on Monday to a peak of 1,610 on Saturday.

date | Visitors
2026-08-03 | 1240
2026-08-04 | 1380
2026-08-05 | 1350
2026-08-06 | 1470
2026-08-07 | 1510
2026-08-08 | 1610
2026-08-09 | 1540
```

…becomes:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/hero-dark.svg">
  <img alt="A line chart of daily visitors rendered by Rollmark" src="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/hero-light.svg" width="720">
</picture>

*(Every chart image in this README is real output from Rollmark's renderer.)*

And in any place that doesn't know Rollmark — GitHub, a text editor, an email preview — the same document stays exactly as readable as the text block above. Nothing ever shows up broken; it just shows up plainer.

## Why this exists

AI assistants and agents are increasingly the ones writing status reports, analytics summaries, and morning briefs. Text-only reports undersell the data — but every existing way to let a model produce charts fails somewhere:

- **Full charting languages** (Vega-Lite, ECharts configs) are verbose and easy for a model to get subtly wrong — and they hand the model control over colors, fonts, and layout, so every report looks different.
- **Letting the model write HTML or SVG** means unauditable numbers, inconsistent output, and a security problem, since you're injecting model-generated markup into your app.
- **Screenshots or generated images** can't be checked, edited, re-themed, or read by a screen reader.

Rollmark's answer is to make the chart language as small as it can possibly be — small enough that models from 8B parameters up produce it near-perfectly — and to put every visual decision in the renderer instead.

## The philosophy

1. **Models state facts, not styles.** A chart block contains data, a chart type, labels, and a one-sentence summary. There is no way to express a color, font, or size — the renderer owns all of that, so every chart in your product looks like it belongs there, in light and dark mode, automatically.
2. **It's still just Markdown.** Every Rollmark document is a valid Markdown document. Where Rollmark isn't installed, charts degrade to readable labeled tables — never to garbage.
3. **A broken chart never breaks the report.** An invalid chart shows a small card with the chart's own summary sentence and what went wrong; the rest of the document renders normally.
4. **The numbers must be checkable.** Chart data lives as plain text in the document, so it can be validated, audited, exported — and the format is designed so models preserve source numbers *exactly* (and this is measured, see below).
5. **Trust nothing.** Documents are treated as untrusted input: raw HTML is neutralized, diagrams render in Mermaid's strict security mode, and the parser is fuzz-tested to never crash.

## What models can write

Five chart types, one small text format — plus [Mermaid](https://mermaid.js.org/) blocks for diagrams and flows:

| | |
|---|---|
| **Comparisons** — `bar`<br><br><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/bar-dark.svg"><img alt="Grouped bar chart" src="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/bar-light.svg"></picture> | **Parts of a whole over time** — `bar` + `stack: true`<br><br><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/stacked-dark.svg"><img alt="Stacked bar chart" src="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/stacked-light.svg"></picture> |
| **Shares** — `pie`<br><br><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/donut-dark.svg"><img alt="Donut chart" src="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/donut-light.svg"></picture> | **Relationships** — `scatter`<br><br><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/scatter-dark.svg"><img alt="Scatter plot" src="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/scatter-light.svg"></picture> |
| **Magnitude over time** — `area` + `stack: true`<br><br><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/area-dark.svg"><img alt="Stacked area chart" src="https://raw.githubusercontent.com/stumptowndoug/rollmark/master/docs/images/area-light.svg"></picture> | **Trends** — `line` (see above)<br><br>Dates written as `2026-08-01` become a proper time axis automatically. Empty cells become gaps, never zeroes. |

The rules a model needs fit in one short prompt snippet — shipped ready to paste in [`prompt-kit/`](./prompt-kit/), including a `summary:` line on every chart. That summary is what appears in email and plain-text versions, what screen readers describe, and what shows if a chart can't render — so a Rollmark report never loses its meaning, only its pixels.

## How it works

1. **A model writes the report** — ordinary Markdown, with chart blocks where charts belong, guided by the prompt snippet.
2. **Rollmark parses and validates** — every chart block is checked against the format's rules (types, limits, the data actually containing what the chart references). Invalid ones become graceful fallback cards, not broken pages.
3. **Rollmark renders** — its own SVG renderer draws every chart with one consistent editorial style: typography, spacing, palette, light/dark themes, accessibility labels. The same renderer runs in the browser and on a server, so a PDF or email export is the identical output.

## Does it actually work with real models?

Measured, not assumed — the repo includes an evaluation harness that runs real models (nine of them, from 8B-parameter to frontier tier) through report-writing tasks and scores the results. Current baseline:

- **100% of chart blocks parse and validate**, across all nine models.
- **100% data fidelity** — no model altered, rounded, invented, or dropped a single number, including deliberately messy inputs.
- Models **choose the right chart type** — pies for shares, scatter for relationships, stacked bars from a prose description — at every size tier.
- An LLM judge checks every chart's summary sentence against its data, and catches models claiming "steady increase" over data with a dip.

Every failure mode the evals have found became a rule in the prompt kit — the numbers and the full story live in [`evals/FINDINGS.md`](./evals/FINDINGS.md).

## For developers

```ts
import mermaid from "mermaid"; // optional, for diagram blocks
import { mountRollmarkDocument } from "rollmark";

await mountRollmarkDocument(container, markdownFromYourModel, {
  theme: "auto",   // follows the user's light/dark preference
  mermaid,
});
```

That's the whole browser integration. On a server, `renderRollmark()` and `renderChartSVG()` give you the HTML and SVG strings directly — no DOM required.

Not yet on npm; consume as a git dependency: `"rollmark": "github:stumptowndoug/rollmark"`.

| To go deeper | |
|---|---|
| Write chart blocks (or prompt a model to) | [`docs/chart-dsl.md`](./docs/chart-dsl.md) |
| The prompt snippet + few-shot examples | [`prompt-kit/`](./prompt-kit/) |
| The formal format specification | [`SPEC.md`](./SPEC.md) |
| Example reports | [`examples/`](./examples/) |
| Eval results and lessons | [`evals/FINDINGS.md`](./evals/FINDINGS.md) |
| Live editor + eval browser | `npm run playground` / `npm run viewer` |
| Design history | [`docs/design/`](./docs/design/) |

Development: `npm install && npm test` (93 tests incl. SVG snapshots and fuzzing), `npm run build`, `npm run build:images` regenerates the README charts from source.

## Status

**v1, incubating.** The format is deliberately small and grows slowly: nothing is added unless real models can produce it reliably (the eval gate), and presentation options are never added at all. Reserved for the future: more block types (`metrics`, `timeline`, `status`), a Vega-Lite escape hatch for power users, and streaming-aware rendering.

MIT licensed.
