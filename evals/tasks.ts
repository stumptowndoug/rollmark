/**
 * Eval tasks: each presents input data and a request, and declares what a
 * correct Rollmark document must contain. Data fidelity is checked against
 * `expected` — the exact values a chart must preserve (SPEC.md §2.6).
 */

export interface ExpectedSeries {
  /** y values keyed by position in `xValues`; null = gap allowed/expected. */
  values: (number | null)[];
}

export interface EvalExpectation {
  /** What kind of visual block the task calls for. */
  blockType: "chart" | "mermaid" | "none";
  /** Acceptable chart types, when blockType is "chart". */
  chartTypes?: ("line" | "bar")[];
  /** Whether the x axis is temporal (dates normalized before comparison). */
  temporal?: boolean;
  /** Normalized x values in order (ISO dates when temporal; category labels otherwise). */
  xValues?: (string | number)[];
  /** Expected series, order-flexible (matched by identical value sequences). */
  series?: ExpectedSeries[];
  /** Minimum number of chart blocks (default 1 for chart tasks). */
  minCharts?: number;
}

export interface EvalTask {
  id: string;
  description: string;
  /** What we ask the model to do. */
  request: string;
  /** The source data, exactly as shown to the model. */
  input: string;
  expected: EvalExpectation;
}

function jsonInput(rows: Record<string, unknown>[]): string {
  return "```json\n" + JSON.stringify(rows, null, 2) + "\n```";
}

// 30 deterministic daily values for the month-long task.
const monthRows = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-07-${String(i + 1).padStart(2, "0")}`,
  signups: 40 + ((i * 37) % 23) + (i % 7 === 5 ? 25 : 0),
}));

export const TASKS: EvalTask[] = [
  {
    id: "ts-basic",
    description: "Five-day time series from JSON input",
    request:
      "Write a short Markdown report on this week's site traffic. Include a chart showing the full daily series.",
    input: jsonInput([
      { date: "2026-08-03", visitors: 1240 },
      { date: "2026-08-04", visitors: 1380 },
      { date: "2026-08-05", visitors: 1350 },
      { date: "2026-08-06", visitors: 1470 },
      { date: "2026-08-07", visitors: 1510 },
    ]),
    expected: {
      blockType: "chart",
      chartTypes: ["line"],
      temporal: true,
      xValues: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
      series: [{ values: [1240, 1380, 1350, 1470, 1510] }],
    },
  },
  {
    id: "ts-month",
    description: "Thirty-day time series (tests larger inline data)",
    request:
      "Write a short Markdown report on daily signups for July. Include a chart showing every day of the series.",
    input: jsonInput(monthRows),
    expected: {
      blockType: "chart",
      chartTypes: ["line", "bar"],
      temporal: true,
      xValues: monthRows.map((r) => r.date),
      series: [{ values: monthRows.map((r) => r.signups) }],
    },
  },
  {
    id: "cat-basic",
    description: "Category comparison from JSON input",
    request:
      "Write a short Markdown report on visitors by channel. Include a chart comparing the channels.",
    input: jsonInput([
      { channel: "Organic search", visitors: 4890 },
      { channel: "Social", visitors: 2310 },
      { channel: "Direct", visitors: 1750 },
      { channel: "Referral", visitors: 1150 },
    ]),
    expected: {
      blockType: "chart",
      chartTypes: ["bar"],
      xValues: ["organic search", "social", "direct", "referral"],
      series: [{ values: [4890, 2310, 1750, 1150] }],
    },
  },
  {
    id: "cat-multi",
    description: "Two-series category comparison",
    request:
      "Write a short Markdown report on this week's support tickets. Include a chart comparing opened and resolved tickets by product area.",
    input: jsonInput([
      { area: "Billing", opened: 34, resolved: 29 },
      { area: "Onboarding", opened: 21, resolved: 22 },
      { area: "API", opened: 45, resolved: 31 },
    ]),
    expected: {
      blockType: "chart",
      chartTypes: ["bar"],
      xValues: ["billing", "onboarding", "api"],
      series: [{ values: [34, 21, 45] }, { values: [29, 22, 31] }],
    },
  },
  {
    id: "ts-gap",
    description: "Time series with a missing value (null gap, not zero)",
    request:
      "Write a short Markdown report on this week's API request volume. Include a chart of the full series. Wednesday's value was not recorded — show it as a gap, not as zero.",
    input: jsonInput([
      { date: "2026-08-03", requests: 90210 },
      { date: "2026-08-04", requests: 93480 },
      { date: "2026-08-05", requests: null },
      { date: "2026-08-06", requests: 91775 },
      { date: "2026-08-07", requests: 95120 },
    ]),
    expected: {
      blockType: "chart",
      chartTypes: ["line"],
      temporal: true,
      xValues: ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
      series: [{ values: [90210, 93480, null, 91775, 95120] }],
    },
  },
  {
    id: "csv-input",
    description: "Category data provided as CSV text",
    request:
      "Write a short Markdown report on storage usage by team. Include a chart comparing the teams.",
    input: "```csv\nteam,gigabytes\nPlatform,412\nData,388\nMobile,171\nWeb,96\n```",
    expected: {
      blockType: "chart",
      chartTypes: ["bar"],
      xValues: ["platform", "data", "mobile", "web"],
      series: [{ values: [412, 388, 171, 96] }],
    },
  },
  {
    id: "prose-input",
    description: "Values embedded in prose (tests extraction fidelity)",
    request:
      "Write a short Markdown report summarizing these results. Include a chart of monthly revenue.",
    input:
      "Revenue in January came in at $142,000. February improved to $188,000, " +
      "and March eased slightly to $173,000. April set a record at $201,500.",
    expected: {
      blockType: "chart",
      chartTypes: ["line", "bar"],
      // No x expectation: months-as-categories ("January") and months-as-dates
      // ("2026-01-01", temporal) are both legitimate encodings. Fidelity is
      // checked on the y sequence in row order.
      xValues: [],
      series: [{ values: [142000, 188000, 173000, 201500] }],
    },
  },
  {
    id: "decimals-negatives",
    description: "Decimal and negative values",
    request:
      "Write a short Markdown report on overnight temperatures. Include a chart of the full series.",
    input: jsonInput([
      { date: "2026-01-12", celsius: 1.5 },
      { date: "2026-01-13", celsius: -0.5 },
      { date: "2026-01-14", celsius: -3.2 },
      { date: "2026-01-15", celsius: -1.8 },
      { date: "2026-01-16", celsius: 2.4 },
    ]),
    expected: {
      blockType: "chart",
      chartTypes: ["line", "bar"],
      temporal: true,
      xValues: ["2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"],
      series: [{ values: [1.5, -0.5, -3.2, -1.8, 2.4] }],
    },
  },
  {
    id: "comma-numbers",
    description: "Numbers written with thousands separators in the input",
    request:
      "Write a short Markdown report on weekly downloads. Include a chart of the full series.",
    input:
      "```text\nWeek of Jul 6: 12,480 downloads\nWeek of Jul 13: 1,9020 downloads (data-entry glitch: actual value 19,020)\nWeek of Jul 20: 22,350 downloads\nWeek of Jul 27: 18,905 downloads\n```",
    expected: {
      blockType: "chart",
      chartTypes: ["line", "bar"],
      xValues: [],
      series: [{ values: [12480, 19020, 22350, 18905] }],
    },
  },
  {
    id: "mermaid-flow",
    description: "Process description that calls for a diagram, not a chart",
    request:
      "Write a short Markdown explanation of this deploy pipeline, including a diagram of the flow.",
    input:
      "Commits trigger CI. CI runs the test suite. Passing builds deploy to staging. " +
      "After manual approval, staging deploys to production. Failures notify the team in Slack.",
    expected: { blockType: "mermaid" },
  },
  {
    id: "no-chart",
    description: "A single value that does not warrant a chart",
    request:
      "Write a one-paragraph Markdown status note based on this. Only add a chart if it genuinely helps.",
    input: "Storage used: 412 GB of 500 GB (82%). Growth last month: 9 GB.",
    expected: { blockType: "none" },
  },
  {
    id: "multi-chart",
    description: "Two datasets that should become two charts",
    request:
      "Write a short Markdown report covering both datasets. Include one chart of the daily series and a second chart comparing the plans.",
    input:
      "Daily active users:\n" +
      jsonInput([
        { date: "2026-08-04", users: 4340 },
        { date: "2026-08-05", users: 4290 },
        { date: "2026-08-06", users: 4510 },
      ]) +
      "\n\nSubscribers by plan:\n" +
      jsonInput([
        { plan: "Free", subscribers: 9120 },
        { plan: "Pro", subscribers: 2480 },
        { plan: "Team", subscribers: 640 },
      ]),
    expected: {
      blockType: "chart",
      minCharts: 2,
      xValues: [],
      series: [{ values: [4340, 4290, 4510] }, { values: [9120, 2480, 640] }],
    },
  },
];

export function getTasks(ids?: string[]): EvalTask[] {
  if (!ids || ids.length === 0) return TASKS;
  const byId = new Map(TASKS.map((t) => [t.id, t]));
  return ids.map((id) => {
    const task = byId.get(id);
    if (!task) throw new Error(`unknown task "${id}"; known: ${TASKS.map((t) => t.id).join(", ")}`);
    return task;
  });
}
