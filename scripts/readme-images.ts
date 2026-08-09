/**
 * Renders the README showcase charts to docs/images/ in both themes,
 * using the real renderer — the images in the README are genuine output.
 *
 *   npm run build:images
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseChartDsl } from "../src/parse-dsl.js";
import { renderChartSVG } from "../src/render-svg.js";

const outDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "docs", "images");
mkdirSync(outDir, { recursive: true });

const CHARTS: Record<string, string> = {
  hero: `line
title: Daily visitors
summary: Daily visitors grew from 1,240 on Monday to a peak of 1,610 on Saturday before easing on Sunday.

date | Visitors
2026-08-03 | 1240
2026-08-04 | 1380
2026-08-05 | 1350
2026-08-06 | 1470
2026-08-07 | 1510
2026-08-08 | 1610
2026-08-09 | 1540`,
  bar: `bar
title: Tickets opened vs. resolved by area
summary: API had the most activity with 45 opened and 31 resolved.

area | Opened | Resolved
Billing | 34 | 29
Onboarding | 21 | 22
API | 45 | 31`,
  stacked: `bar
stack: true
title: Quarterly revenue by product line
summary: Every line grew through the year; software closed most of the gap to hardware by Q4.

quarter | Hardware | Software | Services
Q1 | 420 | 310 | 150
Q2 | 390 | 360 | 175
Q3 | 455 | 410 | 190
Q4 | 510 | 465 | 230`,
  donut: `pie
title: Subscribers by plan
summary: Free accounts make up about three quarters of subscribers.

plan | Subscribers
Free | 9120
Pro | 2480
Team | 640`,
  scatter: `scatter
title: Price vs. rating
summary: Higher-priced products loosely track higher ratings.

price | Rating
9.99 | 3.8
14.5 | 4.1
19.99 | 4.0
24.5 | 4.4
34.0 | 4.6
49.99 | 4.5`,
  area: `area
stack: true
title: Overnight requests by service (thousands)
summary: The API carried most overnight traffic; jobs spiked during the 04:00 batch window.

hour | API | Auth | Jobs
00:00 | 91 | 22 | 8
02:00 | 84 | 19 | 9
04:00 | 78 | 17 | 21
06:00 | 95 | 24 | 10`,
};

for (const [name, dsl] of Object.entries(CHARTS)) {
  const result = parseChartDsl(dsl);
  if (!result.ok) {
    throw new Error(`${name}: ${result.errors.map((e) => e.message).join("; ")}`);
  }
  for (const theme of ["light", "dark"] as const) {
    const svg = renderChartSVG(result.spec, { theme });
    writeFileSync(join(outDir, `${name}-${theme}.svg`), svg + "\n");
  }
  console.log(`rendered ${name}`);
}
