# To-dos

## 📋 Backlog

- [ ] Phase 2: Springroll integration behind thin API (`<Rollmark content={...} />`)
- [ ] Phase 2: streaming-aware rendering (skeleton while fence open, upgrade on close)
- [ ] Phase 2: static export adapter (SVG/PNG) for PDF and email
- [ ] Phase 2: evaluate Flint as an alternate `ChartCompiler` against the eval suite
- [ ] Phase 2: additional chart types as evals justify (pie, area, scatter)
- [ ] Phase 2: `vega-lite` escape-hatch fence
- [ ] Phase 2: decide on Rollmark document tree (Option B) if placeholder-mounting proves awkward
- [ ] Phase 3: split into published packages (`@rollmark/core`, `@rollmark/react`, `@rollmark/markdown-it`)
- [ ] Phase 3: additional semantic blocks if justified (`metrics`, `status`, `timeline`, `progress`)
- [ ] Phase 3: artifact/data references for large datasets (`dataRef`)
- [ ] Phase 3: publish eval results publicly ("model X: N% first-pass validity")
- [ ] Phase 3: versioned schema migration path (v1 → v2 normalization)
- [ ] Phase 3: llms.txt-style machine-readable docs

## 🚧 In Progress

## ✅ Done

- [x] Eval: compare direct generation vs. structured output + serializer
  - [x] verdict: direct is near-ceiling and stays the default; structured helps weak models with syntax but degrades summary honesty (see `evals/FINDINGS.md`)
- [x] Eval: summary-vs-data consistency scoring (LLM judge, `--judge`)
  - [x] caught real dishonesty in 5 models ("steady increase" over dipping data); noisy — treat as review flag
- [x] Eval: full clean baseline run (both arms + judge) for citable numbers
  - [x] 9 models: 7/9 at 100% direct first-pass, 100% final for all but gemini (one chart-judgment miss); fidelity 100% direct-arm
  - [x] provider strict-mode compatibility lessons captured in `evals/FINDINGS.md`

- [x] Eval: run against real models via OpenRouter (9 models × 12 tasks, 2026-08-08)
  - [x] baseline: 6/9 models 100% first-pass; all failures diagnosed from saved documents
  - [x] fixed eval artifact: prose months-as-dates is a legitimate encoding (prose-input xValues dropped)
  - [x] prompt-kit fix from findings: "never wrap the whole response in a code fence" (cured mistral-small)
  - [x] after fixes: all 9 models pass everything except gpt-4o-mini (2 tasks recovered via repair loop)
  - [x] reports in `evals/results/` (run-2026-08-09T05-03-44, re-run 05-05-15)

- [x] Playground page (`playground/`, `npm run dev`) — live edit, echarts + mermaid mounting, verified in browser
  - [x] Mermaid rendered with `securityLevel: strict`
  - [x] light/dark theme (prefers-color-scheme drives echarts + mermaid themes and page CSS)
  - [x] error states: invalid chart shows SPEC §4 fallback inline, document keeps rendering
- [x] Eval harness: 12 report tasks with known input data (`evals/`, `npm run eval`)
  - [x] metrics: validity chain, data fidelity, chart appropriateness, first-pass + repair success
  - [x] OpenRouter adapter (+ `--list-models`) and offline mock adapters; harness covered by `test/eval-harness.test.ts`
  - [x] repair loop (validation errors fed back once; hidden metrics like fidelity never leak into the repair prompt)

- [x] Publish the chart schema as JSON Schema
  - [x] `schemas/chart.v1.json` — strict producer contract (`additionalProperties: false`); runtime validator stays lenient per SPEC §2.3
- [x] Build the prompt kit
  - [x] `prompt-kit/system-prompt.md` — system-prompt snippet
  - [x] `prompt-kit/examples.md` — 4 few-shot examples incl. a "no chart needed" case
- [x] Create example documents in `examples/`
  - [x] weekly-analytics, service-monitor, morning-brief — validated by `test/examples.test.ts`
- [x] Scaffold TypeScript workspace (single package, `npm test` / `npm run build` green)
- [x] markdown-it fence interceptor for `chart` and `mermaid` (Option A: placeholders + `env.rollmark.blocks` registry)
- [x] Chart payload parse + validate (`validateChart`, SPEC §2.3 rules 1–8; unknown props → warnings)
- [x] One chart adapter behind a `ChartCompiler` interface (`compileToECharts`, emits plain option JSON, no echarts dep)
- [x] Error fallback path: failed chart → title + summary + reason + collapsible source, rendered inline
- [x] Payload guardrails (8 series / 1,000 rows / title 200 / summary 500 limits enforced)
- [x] README.md

- [x] Draft SPEC.md
  - [x] Markdown base + `chart` v1 (line/bar, inline data, `version`, optional `summary`) + `mermaid`
  - [x] spec principle: models set intent, renderer sets everything visual
  - [x] explicit streaming decision (v1 non-streaming)
  - [x] error/fallback behavior and unknown-fence forward compatibility

- [x] Design exploration doc (`springroll-markdown-visual-reports.md`)
- [x] Recommendation doc (`testing-overview.md`)
- [x] Incorporate review feedback into both docs (streaming, prompt kit, `summary` field, Flint out of v1, schema discipline principle)
