/** Size limits from SPEC.md §2.2. Renderers MUST enforce these (§7). */
export const LIMITS = {
  maxSeries: 8,
  maxDataRows: 1000,
  maxTitleLength: 200,
  maxSummaryLength: 500,
} as const;
