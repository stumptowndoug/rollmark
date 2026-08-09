/**
 * Renders an iteration gallery of every chart type across representative
 * variants, in both themes, to one self-contained HTML page for visual
 * review. Output: ./gallery.html (gitignored).
 *
 *   npx tsx scripts/gallery.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseChartDsl } from "../src/parse-dsl.js";
import { renderChartSVG } from "../src/render-svg.js";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

interface Variant {
  name: string;
  dsl: string;
}

const month = Array.from({ length: 30 }, (_, i) => {
  const d = String(i + 1).padStart(2, "0");
  return `2026-07-${d} | ${40 + ((i * 37) % 23) + (i % 7 === 5 ? 25 : 0)}`;
}).join("\n");

const GROUPS: Record<string, Variant[]> = {
  line: [
    {
      name: "single series, temporal",
      dsl: `line\ntitle: Daily visitors\nsummary: s\n\ndate | Visitors\n2026-08-03 | 1240\n2026-08-04 | 1380\n2026-08-05 | 1350\n2026-08-06 | 1470\n2026-08-07 | 1510\n2026-08-08 | 1610\n2026-08-09 | 1540`,
    },
    {
      name: "three series with a gap",
      dsl: `line\ntitle: Requests by region\nsummary: s\n\ndate | US | EU | APAC\n2026-08-04 | 91 | 64 | 30\n2026-08-05 | 84 |  | 34\n2026-08-06 | 95 | 71 | 31\n2026-08-07 | 99 | 69 | 38`,
    },
    { name: "30 points (tick thinning)", dsl: `line\ntitle: Daily signups, July\nsummary: s\n\ndate | Signups\n${month}` },
  ],
  bar: [
    {
      name: "single series",
      dsl: `bar\ntitle: Visitors by channel\nsummary: s\n\nchannel | Visitors\nOrganic search | 4890\nSocial | 2310\nDirect | 1750\nReferral | 1150`,
    },
    {
      name: "grouped, two series",
      dsl: `bar\ntitle: Tickets by area\nsummary: s\n\narea | Opened | Resolved\nBilling | 34 | 29\nOnboarding | 21 | 22\nAPI | 45 | 31`,
    },
    {
      name: "grouped, three series",
      dsl: `bar\ntitle: Quarterly revenue by line\nsummary: s\n\nquarter | Hardware | Software | Services\nQ1 | 420 | 310 | 150\nQ2 | 390 | 360 | 175\nQ3 | 455 | 410 | 190\nQ4 | 510 | 465 | 230`,
    },
    {
      name: "stacked",
      dsl: `bar\nstack: true\ntitle: Quarterly revenue by line\nsummary: s\n\nquarter | Hardware | Software | Services\nQ1 | 420 | 310 | 150\nQ2 | 390 | 360 | 175\nQ3 | 455 | 410 | 190\nQ4 | 510 | 465 | 230`,
    },
    {
      name: "stacked with negatives",
      dsl: `bar\nstack: true\ntitle: Net flow by month\nsummary: s\n\nmonth | Inflow | Outflow\nJan | 40 | -22\nFeb | 35 | -41\nMar | 52 | -18\nApr | 44 | -30`,
    },
    {
      name: "twelve categories, long labels",
      dsl:
        `bar\ntitle: Storage by team\nsummary: s\n\nteam | GB\n` +
        [
          "Platform Engineering",
          "Data Science",
          "Mobile",
          "Web Frontend",
          "Infrastructure",
          "Security",
          "QA Automation",
          "Machine Learning",
          "Design Systems",
          "Growth",
          "Support Tooling",
          "Internal Tools",
        ]
          .map((t, i) => `${t} | ${412 - i * 27}`)
          .join("\n"),
    },
  ],
  area: [
    {
      name: "single series",
      dsl: `area\ntitle: Queue depth\nsummary: s\n\ntime | Depth\n00:00 | 12\n01:00 | 30\n02:00 | 24\n03:00 | 55\n04:00 | 41\n05:00 | 18`,
    },
    {
      name: "stacked, three series",
      dsl: `area\nstack: true\ntitle: Requests by service\nsummary: s\n\nhour | API | Auth | Jobs\n00:00 | 91 | 22 | 8\n02:00 | 84 | 19 | 9\n04:00 | 78 | 17 | 21\n06:00 | 95 | 24 | 10`,
    },
  ],
  scatter: [
    {
      name: "single series",
      dsl: `scatter\ntitle: Price vs rating\nsummary: s\n\nprice | Rating\n9.99 | 3.8\n14.5 | 4.1\n19.99 | 4.0\n24.5 | 4.4\n34.0 | 4.6\n49.99 | 4.5`,
    },
    {
      name: "two series",
      dsl: `scatter\ntitle: Sleep vs energy, by month\nsummary: s\n\nsleep | July | August\n6.1 | 4 | 5\n6.8 | 6 | 6\n7.2 | 6 | 7\n7.5 | 7 | 8\n8.2 | 8 | 8`,
    },
  ],
  pie: [
    {
      name: "three slices",
      dsl: `pie\ntitle: Subscribers by plan\nsummary: s\n\nplan | Subscribers\nFree | 9120\nPro | 2480\nTeam | 640`,
    },
    {
      name: "six slices",
      dsl: `pie\ntitle: Traffic sources\nsummary: s\n\nsource | Sessions\nOrganic | 4890\nSocial | 2310\nDirect | 1750\nReferral | 1150\nEmail | 720\nPaid | 410`,
    },
    {
      name: "twelve slices (Other bucketing)",
      dsl:
        `pie\ntitle: Sales by region\nsummary: s\n\nregion | Sales\n` +
        Array.from({ length: 12 }, (_, i) => `Region ${String.fromCharCode(65 + i)} | ${900 - i * 61}`).join("\n"),
    },
  ],
};

const PALETTE_SAMPLE = GROUPS.bar![2]!.dsl; // grouped, three series
const PALETTE_SAMPLE_LINE = GROUPS.line![1]!.dsl; // three series with a gap

const sections: string[] = [];

// Palette dimension: one bar + one line sample per named palette, both themes.
{
  const { PALETTES } = await import("../src/palettes.js");
  const cards = Object.keys(PALETTES)
    .flatMap((name) => {
      return [PALETTE_SAMPLE, PALETTE_SAMPLE_LINE].map((dsl, i) => {
        const parsed = parseChartDsl(dsl);
        if (!parsed.ok) throw new Error(`palette sample: ${parsed.errors[0]!.message}`);
        const palette = name as import("../src/palettes.js").PaletteName;
        const light = renderChartSVG(parsed.spec, { theme: "light", palette });
        const dark = renderChartSVG(parsed.spec, { theme: "dark", palette });
        return `<div class="card"><h3>palette: ${name} — ${i === 0 ? "bars" : "lines"}</h3>
<div class="pair"><div class="light">${light}</div><div class="dark">${dark}</div></div></div>`;
      });
    })
    .join("\n");
  sections.push(`<section><h2>palettes</h2>${cards}</section>`);
}

for (const [group, variants] of Object.entries(GROUPS)) {
  const cards = variants
    .map((v) => {
      const parsed = parseChartDsl(v.dsl);
      if (!parsed.ok) throw new Error(`${group}/${v.name}: ${parsed.errors[0]!.message}`);
      const light = renderChartSVG(parsed.spec, { theme: "light" });
      const dark = renderChartSVG(parsed.spec, { theme: "dark" });
      return `<div class="card"><h3>${group} — ${v.name}</h3>
<div class="pair"><div class="light">${light}</div><div class="dark">${dark}</div></div></div>`;
    })
    .join("\n");
  sections.push(`<section><h2>${group}</h2>${cards}</section>`);
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Rollmark chart gallery</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; background: #f3f4f6; color: #111; }
h1 { font-size: 1.3rem; } h2 { margin-top: 2.5rem; text-transform: capitalize; }
h3 { font-size: 0.9rem; font-weight: 500; color: #444; margin: 0 0 0.5rem; }
.card { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 1rem; margin: 1rem 0; }
.pair { display: flex; gap: 1rem; flex-wrap: wrap; }
.pair > div { flex: 1; min-width: 340px; border-radius: 8px; padding: 0.5rem; }
.light { background: #ffffff; } .dark { background: #16181d; }
svg { width: 100%; height: auto; display: block; }
</style></head><body>
<h1>Rollmark chart gallery — every type, light &amp; dark</h1>
<p>Generated by <code>scripts/gallery.ts</code> from the real renderer.</p>
${sections.join("\n")}
</body></html>`;

const outPath = join(repoRoot, "gallery.html");
writeFileSync(outPath, html);
console.log(`wrote ${outPath}`);
