# Eval findings — baseline, August 2026

Nine OpenRouter models × 12 tasks, direct and structured arms, with
`google/gemini-3-flash-preview` judging summary-vs-data consistency.
Raw reports live in `results/` (untracked); this file records the numbers
and lessons worth keeping.

## Direct arm (model writes the whole Markdown document)

| Model | First-pass | Final (with repair) | Data fidelity | Summary consistent |
|---|---:|---:|---:|---:|
| deepseek-v4-flash | 100% | 100% | 100% | 100% |
| xiaomi/mimo-v2.5 | 100% | 100% | 100% | 90% |
| gpt-5.6-luna | 100% | 100% | 100% | 100% |
| gpt-4o-mini | 83% | 100% | 100% | 100% |
| gemini-3-flash-preview | 92% | 92% | 100% | 100% |
| claude-sonnet-5 | 100% | 100% | 100% | 100% |
| grok-4.5 | 100% | 100% | 100% | 100% |
| mistral-small-2603 | 100% | 100% | 100% | 90% |
| qwen3-8b | 92% | 100% | 100% | 70% |

## Structured arm (strict json_schema → serializer; 10 chart tasks)

| Model | First-pass | Data fidelity | Summary consistent |
|---|---:|---:|---:|
| deepseek-v4-flash | 100% | 100% | 100% |
| xiaomi/mimo-v2.5 | 100% | 100% | 100% |
| gpt-5.6-luna | 100% | 100% | 100% |
| gpt-4o-mini | 100% | 100% | 80% |
| gemini-3-flash-preview | 100% | 100% | 90% |
| claude-sonnet-5 | 100% | 100% | 100% |
| grok-4.5 | 100% | 100% | 90% |
| mistral-small-2603 | 100% | 100% | 50% |
| qwen3-8b | 90% | 90% | 89% |

## Lessons

1. **Direct Markdown generation is already near-ceiling.** Every model
   reaches 100% final validity except gemini-3-flash, whose one miss was
   emitting a chart on the "no chart warranted" task — a judgment error,
   not a format error. Data fidelity is 100% across the direct arm,
   including the thousands-separator trap and the null-gap task.
2. **Structured output helps weak models with syntax, not judgment.**
   gpt-4o-mini went 83% → 100% first-pass under the structured arm. But
   summary consistency *dropped* for several models when writing JSON
   (mistral-small 90% → 50%) — narrating data honestly seems harder when
   detached from prose flow. Since direct generation already works,
   structured generation is not worth its portability cost as the default;
   keep it as a fallback strategy for models that can't form fences.
3. **Provider strict-mode schemas are a compatibility minefield** (matters
   if Springroll ever uses structured generation):
   - OpenAI/Azure and Google require `additionalProperties: false` on
     every object — dynamic field-name keys are unrepresentable.
   - Anthropic rejects `maxItems` on arrays.
   - Parallel arrays (`x_values` + per-series `values`) sidestep both and
     also remove the field-name bookkeeping models otherwise get wrong
     (xiaomi failed 6 tasks purely on `x.field` vs row-key mismatches).
4. **The prompt kit matters measurably.** Adding one line — "never wrap
   your whole response in a code fence" — took mistral-small from 83% to
   100% first-pass in the direct arm.
5. **The judge earns its keep but is noisy.** It caught real dishonesty
   ("steady increase" over data with a dip, wrong-extreme claims, a
   hallucinated weekday) across five models — failures invisible to
   mechanical scoring. Some verdicts look like judge arithmetic errors,
   so treat sub-100% consistency as a flag for human review, not a score.
6. **Repair works when the model can see the problem.** Every repair
   attempt on validation-visible errors succeeded (gpt-4o-mini 2/2,
   qwen 1/1). Hidden metrics (fidelity, chart choice) are deliberately
   never fed back, so they stay honest measures of first-shot quality.

## Method notes

- Scoring leniencies that exist on purpose: months may be encoded as
  categories or temporal dates; series order may differ from the input;
  date-time x values match date expectations; unknown JSON properties
  warn rather than fail.
- The judge model also appears as a candidate (gemini-3-flash judging
  itself); acceptable for a consistency check, but don't read its own
  summary-consistency cell as independent.
- Costs: a full 9-model direct+structured run with judge is roughly
  400 API calls.
