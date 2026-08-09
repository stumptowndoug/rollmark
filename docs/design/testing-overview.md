# Recommendation: Prototype Rollmark Separately First

I would prototype this as **Rollmark first**, with Springroll treated as its first intended consumer.

Not necessarily as a polished standalone product yet. Think of Rollmark as an incubation project with its own small spec, renderer, playground, and LLM evaluation suite.

## Why separate it from Springroll initially

There are really two different questions:

1. Can Springroll render charts and richer Markdown output?
2. Can a wide variety of LLMs reliably generate the format?

The first problem is relatively straightforward. The second is the more important experiment.

A standalone Rollmark prototype makes it easier to test:

- Which syntax models generate most reliably
- JSON vs YAML inside fenced blocks
- How complicated the chart schema should be
- Whether models choose appropriate chart types
- How often generated specs fail validation
- Whether a repair attempt reliably fixes invalid output
- Whether Flint helps simplify generation
- Whether different rendering engines matter
- How well smaller and cheaper models perform
- Whether additional blocks like metrics, status, and timelines are worthwhile

The architecture becomes:

```text
LLM
  ↓
Rollmark document
  ↓
Rollmark parser + validator
  ↓
Rollmark renderer
  ↓
Springroll / playground / exports / other consumers
```

Springroll can then consume Rollmark without needing to own all of its implementation details.

## Keep the initial language small

I would start with:

```text
Standard Markdown
+
chart blocks (line and bar only, inline data, version inside the JSON, optional summary)
+
Mermaid
```

The `chart` block should exist from day one rather than starting Mermaid-only: Mermaid's `xychart-beta` syntax is explicitly beta and has shifted before, so it is not a stable foundation for quantitative reports.

The chart schema should include an optional `summary` field — a short natural-language description of what the chart shows. It serves as the text fallback for email and plain-text export, the accessible description for screen readers, the graceful degradation path when validation fails, and an extra fidelity check for evals (do the summary's claims match the data?).

**Streaming should be an explicit v1 decision, stated in SPEC.md.** Most AI output is streamed, and a streamed document means incomplete fences and half-parsed JSON payloads. For Springroll, v1 can reasonably be non-streaming (scheduled-run reports arrive complete), but the spec should say so, and the design should not foreclose streaming-aware rendering later (placeholder while a fence is open, upgrade on close, error fallback on truncation).

For example:

````markdown
# Weekly acquisition report

Traffic increased **14%** this week.

```chart
{
  "version": 1,
  "type": "line",
  "title": "Daily visitors",
  "summary": "Daily visitors grew steadily from 1,240 to 1,510 over the first three days of August.",
  "x": {
    "field": "date",
    "type": "temporal"
  },
  "series": [
    {
      "field": "visitors",
      "label": "Visitors"
    }
  ],
  "data": [
    {"date": "2026-08-01", "visitors": 1240},
    {"date": "2026-08-02", "visitors": 1380},
    {"date": "2026-08-03", "visitors": 1510}
  ]
}
```

Organic search was responsible for most of the increase.
````

That is enough to validate the core concept before expanding the language.

## Make LLM evaluation a first-class part of the project

The most important part of the prototype may be the evaluation suite.

For each model and task, measure things such as:

| Measure | What it tells us |
|---|---|
| Markdown validity | Can the document still be parsed normally? |
| Block detection | Is the `chart` fence formed correctly? |
| JSON validity | Does the chart payload parse? |
| Schema validity | Does the output conform to Rollmark's schema? |
| Data fidelity | Did the model preserve the original numbers? |
| Chart appropriateness | Did it choose a sensible visualization? |
| Label quality | Are titles, axes, units, and series understandable? |
| First-pass success | Does it work without correction? |
| Repair success | Can the model fix a validation error? |
| Render success | Does the final chart actually render correctly? |

**Data fidelity should be especially important.**

If the supplied values are:

```text
January: 142
February: 188
March: 173
```

the generated chart should still contain exactly:

```text
142, 188, 173
```

A visually attractive chart that changes the source data is a serious failure.

## Test multiple generation approaches

At minimum, compare these two strategies.

### Direct Rollmark generation

```text
Input data
   ↓
LLM
   ↓
Markdown + chart block
```

The model writes the entire report directly.

This is probably the most natural experience for Springroll.

### Structured chart generation

```text
Input data
   ↓
LLM structured output
   ↓
Validated chart object
   ↓
Rollmark serializer
   ↓
Markdown document
```

This could prove more reliable, especially with models or APIs that support structured output.

The persisted result can still be Markdown even if the model did not directly construct every character of the fenced JSON block.

That is worth testing rather than assuming one approach is better.

Publishing the chart schema as **JSON Schema** collapses these two strategies into one artifact: the same schema powers direct generation (pasted into a prompt), structured generation (passed to a structured-output API), and validation. The repository should ship a **prompt kit** as a first-class deliverable — the system-prompt snippet, the JSON Schema, and few-shot examples — because for a format designed to be generated, documentation for models is as important as documentation for humans.

## Keep Flint as an implementation detail

Rollmark should own the persisted format:

```text
Rollmark chart spec
```

Then internally you can choose:

```text
Rollmark
   ↓
Flint
   ↓
Vega-Lite
```

or:

```text
Rollmark
   ↓
Vega-Lite directly
```

or:

```text
Rollmark
   ↓
ECharts
```

This is important because Flint is interesting, but the Rollmark document format should not depend on a specific visualization library.

Flint should stay **out of the v1 critical path entirely**. It is a new dependency with Microsoft's abstraction rather than Rollmark's, and a small v1 schema maps to ECharts or Vega-Lite in a few hundred lines of adapter code. Let the eval results decide whether Flint earns its way in (that is the point of eval question about Flint below).

Conceptually:

```ts
interface ChartCompiler {
  compile(spec: RollmarkChartSpec): RenderableChartSpec;
}
```

Flint could simply be one compiler implementation.

## Suggested project structure

A standalone repository could eventually look something like:

```text
rollmark/
├── packages/
│   ├── core/
│   │   ├── parser
│   │   ├── schemas
│   │   ├── validation
│   │   └── normalization
│   │
│   ├── markdown-it/
│   │   └── markdown-it integration
│   │
│   ├── react/
│   │   └── React renderers
│   │
│   └── evals/
│       ├── prompts
│       ├── datasets
│       ├── model adapters
│       └── scoring
│
├── prompt-kit/
│   ├── system prompt snippet
│   ├── chart schema (JSON Schema)
│   └── few-shot examples
│
├── playground/
│   └── generate or paste Rollmark and render it
│
├── examples/
│   ├── weekly-analytics.md
│   ├── service-monitor.md
│   └── morning-brief.md
│
└── SPEC.md
```

This does not need to begin as several published packages. It can initially be one TypeScript workspace with logical boundaries.

## Connecting it to Springroll

Keep the Springroll integration thin during experimentation.

Springroll should ideally need something roughly equivalent to:

```tsx
import { Rollmark } from "@rollmark/react";

<Rollmark content={run.output} />
```

During development, Rollmark could be consumed through:

- A workspace or local package
- A Git dependency
- Prerelease npm versions
- Another lightweight development dependency

That allows real Springroll testing without tightly coupling the two projects.

## When to integrate it more deeply

I would look for evidence such as:

- High first-pass validity across several model families
- Near-perfect source-data preservation
- Reliable recovery from malformed chart blocks
- Predictable handling of unsupported visualizations
- Good light and dark mode rendering
- A sufficiently stable v1 chart schema
- Successful generation from smaller and cheaper models
- Clear evidence that charts materially improve actual scheduled reports

Only then would I make Rollmark a core Springroll capability.

## Repository recommendation

There are two reasonable approaches.

### Separate Rollmark repository

Best if this has a reasonable chance of becoming:

- Open source
- Reusable outside Springroll
- Its own specification
- Something with significant LLM evaluation work

This creates a clean boundary and gives the experiment freedom to change significantly.

### `packages/rollmark` inside Springroll

Best if the goal is simply to test the idea with as little overhead as possible.

It is easier operationally, but creates more temptation to couple Rollmark directly to Springroll's UI and assumptions.

## Recommendation

Given the need to test this across a wide variety of LLMs before committing to it, I would start with a **small separate Rollmark repository**.

Treat it as an incubator rather than immediately building a polished open-source project around it.

The framing would be:

> **Rollmark is an experimental Markdown-based document format and renderer for AI-generated visual reports. Springroll is its first intended consumer.**

This gives the project room to change syntax, replace rendering libraries, simplify the schema, or even fail entirely without destabilizing Springroll.