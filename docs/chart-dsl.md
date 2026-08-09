# The Rollmark chart DSL

A friendly guide to writing `chart` blocks. The normative rules live in [SPEC.md §2](../SPEC.md); this page is the version you'd hand to a person (or paste into a prompt — see [`prompt-kit/`](../prompt-kit/) for the ready-made snippet).

## Anatomy

A chart block is a fenced code block labeled `chart`, containing three parts: a **type**, optional **meta lines**, and a **data table**.

````markdown
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

- The first line is the chart type.
- `key: value` lines set metadata.
- The table holds the data: **the first column is always the x-axis, every other column is a series, and the header row names them**. That's the whole layout model — there are no field mappings to configure.

In any viewer that doesn't know Rollmark (GitHub, a text editor), the block displays as readable text — effectively a labeled table.

## Chart types

| Type | Use when the question is… | Notes |
|---|---|---|
| `line` | "how does this change over an ordered axis?" | Point markers included; gaps for missing values |
| `bar` | "how do these categories compare?" | Grouped when there are multiple series |
| `area` | "how does magnitude accumulate over time?" | Filled; usually paired with `stack: true` |
| `scatter` | "how do two numeric measures relate?" | X values must be numbers or ISO dates |
| `pie` | "what share of the whole is each part?" | Exactly one value column; rendered as a donut, capped at 8 slices with the tail bucketed into "Other" |

## Meta keys

| Key | Example | Meaning |
|---|---|---|
| `title:` | `title: Revenue by month` | Chart title (≤ 200 chars) |
| `summary:` | `summary: Revenue peaked in April.` | One or two sentences describing what the chart shows. **Always include it** — it's the fallback text for email/plain viewers, the screen-reader description, and what displays if the chart can't render. It must agree with the data. (≤ 500 chars) |
| `stack:` | `stack: true` | Stack series on top of each other. `bar` and `area` only. |
| `x-type:` | `x-type: category` | Override axis-type inference (rarely needed — see below) |
| `x-label:` | `x-label: Week of` | Axis label; defaults to the first column's header |

Unknown keys are ignored, never fatal.

## The data table

```text
date | Visitors | Signups
2026-08-01 | 1240 | 89
2026-08-02 | 1380 |
2026-08-03 | 1510 | 102
```

- **Header row is mandatory** — even for pies. The first row always names the columns.
- **Each row is one x-axis entry** — one date or one category. Categories go *down* the first column, never across the header.
- **Empty cell = gap.** Lines and areas break there; it is never treated as zero.
- **Numbers**: plain (`1240`), decimal (`-3.2`), or with thousands separators (`12,480`). A malformed grouping like `1,9020` is *not* silently fixed — it fails validation so the producer can correct it.
- **Quoting**: wrap a cell in double quotes to keep it a string (`"007"`) or to include a pipe (`"a|b"`).
- GFM-style tables also work — outer pipes and `|---|` separator rows are tolerated, so a chart block can be made from a copy-pasted Markdown table.
- Limits: 1–8 series, 1–1,000 rows.

## Dates and the time axis

Write dates as ISO 8601 — `2026-08-01` or `2026-08-08T14:30:00Z`. When **every** x value is an ISO date, the axis automatically becomes a time axis with proper date ticks. No declaration needed; `x-type: category` opts out if you really want dates treated as labels.

## What you can't control (on purpose)

Colors, fonts, sizes, spacing, gridlines, legends, animation, tooltips. The renderer owns all presentation so every chart in a product looks consistent, themes correctly in light/dark, and stays accessible. Styling keys in the payload are ignored. This is a load-bearing design principle — see SPEC.md design goal 2.

(The *application* embedding Rollmark can choose a named palette or supply brand colors, and hover tooltips appear automatically — but those are renderer options, invisible to the document and to you as its author.)

## The JSON alternate

A payload starting with `{` is parsed as JSON instead — the same semantic model in object form (see SPEC.md §2.2 and [`schemas/chart.v1.json`](../schemas/chart.v1.json)). It exists for machine producers, e.g. structured-output pipelines that generate a validated object and serialize it into a document. When writing by hand or prompting a model, use the DSL.

## Common mistakes (all observed in real model evals)

1. **Transposing categories into the header** — `date | Organic search | Social | ...` with one data row. Categories go down the first column.
2. **Omitting the header row on pies** — `Free | 9120` as the first line makes "Free" a column name and eats the first slice.
3. **Wrapping the whole document in a code fence** — the chart fence inside can then never parse as a fence.
4. **Summaries the data doesn't support** — "steady increase" over data with a dip. The summary must be checkable against the table above it.

The prompt-kit system snippet contains rules preventing all four.

## Failure behavior

An invalid chart never breaks the document. The renderer shows the title and summary (if parseable), a one-line reason ("Chart could not be rendered: field 'x' was not found in the data"), and the original source behind a disclosure — and everything around it renders normally.
