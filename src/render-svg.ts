import { extent, max, min, range } from "d3-array";
import { format } from "d3-format";
import { scaleBand, scaleLinear, scalePoint, scaleUtc } from "d3-scale";
import type { ScaleBand, ScaleContinuousNumeric, ScalePoint } from "d3-scale";
import { arc, area as d3area, line as d3line, pie as d3pie, stack, stackOffsetDiverging } from "d3-shape";
import { utcFormat } from "d3-time-format";

import { PALETTES } from "./palettes.js";
import type { PaletteName } from "./palettes.js";
import type { ChartSpec } from "./types.js";

/**
 * Rollmark's own chart renderer: ChartSpec in, static SVG string out.
 * d3 micro-modules provide the math (scales, shapes, formatting); Rollmark
 * owns every visual opinion — layout, palette, typography, axes, legends.
 * DOM-free, so it runs identically in the browser and on the server
 * (email/PDF export is this same function).
 *
 * Color is consumer-configurable (named palettes, or full overrides) but
 * never model-configurable — the chart DSL has no color vocabulary. All
 * colors are baked into the SVG so output works in every context.
 *
 * v1 output is deliberately non-interactive: native <title> tooltips only;
 * richer hover behavior lives in the mount layer.
 */

/** Consumer color overrides. Anything omitted falls back to the theme/palette. */
export interface ChartColors {
  /** Series palette, in order; wins over the `palette` option. */
  series?: string[];
  text?: string;
  muted?: string;
  grid?: string;
  axis?: string;
}

export interface RenderSvgOptions {
  theme?: "light" | "dark";
  /** Named built-in series palette (default "default"). */
  palette?: PaletteName;
  /** Custom colors; `colors.series` wins over `palette`. */
  colors?: ChartColors;
  width?: number;
  height?: number;
}

const THEMES = {
  light: { text: "#1f2733", muted: "#6b7280", grid: "#e5e7eb", axis: "#d1d5db" },
  dark: { text: "#e5e7eb", muted: "#9ca3af", grid: "#30363d", axis: "#4b5563" },
} as const;

interface ResolvedColors {
  text: string;
  muted: string;
  grid: string;
  axis: string;
  series: string[];
}

function resolveColors(options: RenderSvgOptions): ResolvedColors {
  const theme = options.theme ?? "light";
  const base = THEMES[theme];
  const paletteSeries = PALETTES[options.palette ?? "default"][theme];
  const c = options.colors ?? {};
  const series = c.series && c.series.length > 0 ? c.series : paletteSeries;
  return {
    text: c.text ?? base.text,
    muted: c.muted ?? base.muted,
    grid: c.grid ?? base.grid,
    axis: c.axis ?? base.axis,
    series,
  };
}

const FONT = "system-ui, -apple-system, sans-serif";

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fmtCompact = format(".3~s");
const fmtPlain = format(",~");

function fmtValue(v: number): string {
  return Math.abs(v) >= 10000 ? fmtCompact(v).replace("G", "B") : fmtPlain(v);
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

interface Frame {
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
  innerW: number;
  innerH: number;
  theme: ResolvedColors;
  parts: string[];
}

function openSvg(
  spec: ChartSpec,
  options: RenderSvgOptions,
  legendCount: number,
  bottom = 40,
): Frame {
  const width = options.width ?? 640;
  const height = options.height ?? 360;
  const theme = resolveColors(options);
  const hasTitle = Boolean(spec.title);
  const hasLegend = legendCount > 1 && spec.type !== "pie";
  const top = 16 + (hasTitle ? 28 : 0) + (hasLegend ? 24 : 0);
  const left = 56;
  const right = 16;
  const label = [spec.title, spec.summary].filter(Boolean).join(". ") || "Chart";
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="rollmark-chart-svg" role="img" aria-label="${esc(label)}" font-family="${FONT}">`,
  ];
  if (hasTitle) {
    parts.push(
      `<text x="16" y="28" font-size="15" font-weight="600" fill="${theme.text}">${esc(spec.title!)}</text>`,
    );
  }
  if (hasLegend) {
    let x = 16;
    const y = hasTitle ? 48 : 24;
    spec.series.forEach((s, i) => {
      const name = s.label ?? s.field;
      parts.push(
        `<rect x="${x}" y="${y - 9}" width="10" height="10" rx="2" fill="${theme.series[i % theme.series.length]}"/>`,
        `<text x="${x + 15}" y="${y}" font-size="12" fill="${theme.muted}">${esc(name)}</text>`,
      );
      x += 15 + name.length * 6.6 + 18;
    });
  }
  return {
    width,
    height,
    top,
    left,
    right,
    bottom,
    innerW: width - left - right,
    innerH: height - top - bottom,
    theme,
    parts,
  };
}

function yAxis(frame: Frame, scale: ScaleContinuousNumeric<number, number>): void {
  const ticks = scale.ticks(6);
  for (const t of ticks) {
    const y = frame.top + scale(t);
    frame.parts.push(
      `<line x1="${frame.left}" y1="${y}" x2="${frame.left + frame.innerW}" y2="${y}" stroke="${frame.theme.grid}" stroke-width="1"/>`,
      `<text x="${frame.left - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="${frame.theme.muted}">${esc(fmtValue(t))}</text>`,
    );
  }
}

function xBaseline(frame: Frame): void {
  const y = frame.top + frame.innerH;
  frame.parts.push(
    `<line x1="${frame.left}" y1="${y}" x2="${frame.left + frame.innerW}" y2="${y}" stroke="${frame.theme.axis}" stroke-width="1"/>`,
  );
}

// Approximate glyph width at font-size 11, used to decide label rotation.
const TICK_CHAR_W = 6.2;
// The "reasonable maximum": labels longer than this are truncated with an
// ellipsis (the full text stays available as native hover via <title>).
const TICK_MAX_CHARS = 18;
const TICK_ANGLE = -35;

function xTickText(
  frame: Frame,
  x: number,
  label: string,
  rotated = false,
  maxChars = TICK_MAX_CHARS,
): void {
  const full = `<title>${esc(label)}</title>`;
  if (rotated) {
    const y = frame.top + frame.innerH + 14;
    frame.parts.push(
      `<text x="${x}" y="${y}" font-size="11" text-anchor="end" transform="rotate(${TICK_ANGLE}, ${x}, ${y})" fill="${frame.theme.muted}">${full}${esc(truncate(label, maxChars))}</text>`,
    );
  } else {
    const y = frame.top + frame.innerH + 18;
    frame.parts.push(
      `<text x="${x}" y="${y}" font-size="11" text-anchor="middle" fill="${frame.theme.muted}">${full}${esc(truncate(label, maxChars))}</text>`,
    );
  }
}

interface TickLayout {
  rotated: boolean;
  bottom: number;
  step: number;
  maxChars: number;
}

/**
 * Category-axis layout decision, made before the frame exists so the
 * bottom margin can grow to fit rotated labels: rotate to -35° when the
 * widest (truncated) label would overflow its slot. The character cap is
 * clamped so the leftmost rotated label cannot extend past the SVG's
 * left edge and get clipped.
 */
function categoryTickLayout(labels: string[], options: RenderSvgOptions): TickLayout {
  const width = options.width ?? 640;
  const left = 56;
  const innerW = width - left - 16;
  const step = Math.max(1, Math.ceil(labels.length / 12));
  const shown = labels.filter((_, i) => i % step === 0);
  const slot = innerW / Math.max(1, shown.length);
  const longest = Math.max(0, ...shown.map((s) => s.length));

  const cos = Math.cos((Math.abs(TICK_ANGLE) * Math.PI) / 180);
  const sin = Math.sin((Math.abs(TICK_ANGLE) * Math.PI) / 180);
  // Horizontal room from the first tick's center back to the edge.
  const firstTickX = left + slot / 2;
  const edgeCap = Math.floor((firstTickX - 4) / (cos * TICK_CHAR_W));
  const maxChars = Math.max(8, Math.min(TICK_MAX_CHARS, edgeCap));

  const rotated = Math.min(longest, maxChars) * TICK_CHAR_W > slot - 8;
  const bottom = rotated
    ? 28 + Math.ceil(sin * Math.min(longest, maxChars) * TICK_CHAR_W)
    : 40;
  return { rotated, bottom, step, maxChars: rotated ? maxChars : TICK_MAX_CHARS };
}

// ISO 8601 payload dates are UTC; format them in UTC so output is
// deterministic across machines (a "2026-08-01" chart must never show
// "Jul 31" to a viewer west of UTC).
function timeTickFormatter(span: number): (d: Date) => string {
  const day = 86_400_000;
  if (span > 300 * day) return utcFormat("%b %Y");
  if (span > 3 * day) return utcFormat("%b %-d");
  return utcFormat("%H:%M");
}

// ---------------------------------------------------------------------------

export function renderChartSVG(spec: ChartSpec, options: RenderSvgOptions = {}): string {
  if (spec.type === "pie") return renderPie(spec, options);
  return renderXY(spec, options);
}

interface SeriesData {
  label: string;
  color: string;
  values: (number | null)[];
}

function renderXY(spec: ChartSpec, options: RenderSvgOptions): string {
  const rows = spec.data;
  const temporal = spec.x.type === "temporal";
  const xRaw = rows.map((r) => r[spec.x.field]);
  const numericScatter = spec.type === "scatter" && typeof xRaw[0] === "number";

  // Category axes decide label rotation (and the bottom margin it needs)
  // up front; temporal/numeric axes use short formatted ticks and never rotate.
  let categoryLabels: string[] | undefined;
  let tickLayout: TickLayout = { rotated: false, bottom: 40, step: 1, maxChars: TICK_MAX_CHARS };
  if (spec.type === "bar") {
    const fmtDate = temporal ? utcFormat("%b %-d") : undefined;
    categoryLabels = xRaw.map((v) => (fmtDate ? fmtDate(new Date(String(v))) : String(v)));
    tickLayout = categoryTickLayout(categoryLabels, options);
  } else if (!temporal && !numericScatter) {
    categoryLabels = xRaw.map(String);
    tickLayout = categoryTickLayout(categoryLabels, options);
  }

  const frame = openSvg(spec, options, spec.series.length, tickLayout.bottom);
  const series: SeriesData[] = spec.series.map((s, i) => ({
    label: s.label ?? s.field,
    color: frame.theme.series[i % frame.theme.series.length]!,
    values: rows.map((r) => {
      const v = r[s.field];
      return v === undefined || v === null ? null : (v as number);
    }),
  }));

  // y domain (always includes zero except for scatter).
  let lo: number;
  let hi: number;
  if (spec.stack) {
    const stacked = stackedLayout(series);
    lo = min(stacked.flat(2)) ?? 0;
    hi = max(stacked.flat(2)) ?? 1;
  } else {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    lo = min(all) ?? 0;
    hi = max(all) ?? 1;
  }
  if (spec.type !== "scatter") {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const yScale = scaleLinear().domain([lo, hi]).nice().range([frame.innerH, 0]);
  yAxis(frame, yScale);

  // x scale + ticks.
  let xPos: (index: number) => number;
  let bandwidth = 0;
  if (spec.type === "bar") {
    const domain = xRaw.map(String);
    const scale: ScaleBand<string> = scaleBand<string>()
      .domain(domain)
      .range([0, frame.innerW])
      .paddingInner(0.25)
      .paddingOuter(0.15);
    bandwidth = scale.bandwidth();
    xPos = (i) => frame.left + (scale(domain[i]!) ?? 0);
    domain.forEach((_, i) => {
      if (i % tickLayout.step !== 0) return;
      xTickText(frame, xPos(i) + bandwidth / 2, categoryLabels![i]!, tickLayout.rotated, tickLayout.maxChars);
    });
  } else if (temporal || numericScatter) {
    const values = temporal ? xRaw.map((v) => new Date(String(v)).getTime()) : (xRaw as number[]);
    const [dLo, dHi] = extent(values) as [number, number];
    const scale = temporal
      ? scaleUtc()
          .domain([new Date(dLo), new Date(dHi)])
          .range([0, frame.innerW])
      : scaleLinear().domain([dLo, dHi]).nice().range([0, frame.innerW]);
    xPos = (i) => frame.left + scale(temporal ? new Date(String(xRaw[i])) : (xRaw[i] as number));
    if (temporal) {
      const fmt = timeTickFormatter(dHi - dLo);
      for (const t of (scale as ReturnType<typeof scaleUtc>).ticks(6)) {
        xTickText(frame, frame.left + scale(t as never), fmt(t as Date));
      }
    } else {
      for (const t of (scale as ReturnType<typeof scaleLinear>).ticks(6)) {
        xTickText(frame, frame.left + scale(t as never), fmtValue(t as number));
      }
    }
  } else {
    const domain = xRaw.map(String);
    const scale: ScalePoint<string> = scalePoint<string>()
      .domain(domain)
      .range([0, frame.innerW])
      .padding(0.5);
    xPos = (i) => frame.left + (scale(domain[i]!) ?? 0);
    domain.forEach((_, i) => {
      if (i % tickLayout.step === 0) {
        xTickText(frame, xPos(i), categoryLabels![i]!, tickLayout.rotated, tickLayout.maxChars);
      }
    });
  }
  xBaseline(frame);

  const fmtX = temporal ? utcFormat("%b %-d, %Y") : undefined;
  const xDisplay = (i: number): string =>
    fmtX ? fmtX(new Date(String(xRaw[i]))) : String(xRaw[i]);
  // Marks carry a native <title> (works in static contexts) plus data
  // attributes the mount layer's tooltip engine reads.
  const mark = (i: number, s: SeriesData, v: number): string =>
    `<title>${esc(`${xDisplay(i)} · ${s.label}: ${fmtValue(v)}`)}</title>`;
  const markAttrs = (i: number, s: SeriesData, v: number): string =>
    ` data-rm-x="${esc(xDisplay(i))}" data-rm-s="${esc(s.label)}" data-rm-v="${esc(fmtValue(v))}"`;

  if (spec.type === "bar" && spec.stack) {
    const layout = stackedLayout(series);
    series.forEach((s, si) => {
      rows.forEach((_, i) => {
        const v = s.values[i];
        if (v === null || v === undefined) return;
        const [y0, y1] = layout[si]![i]!;
        const top = frame.top + yScale(Math.max(y0, y1));
        const h = Math.abs(yScale(y0) - yScale(y1));
        frame.parts.push(
          `<rect x="${xPos(i)}" y="${top}" width="${bandwidth}" height="${h}" fill="${s.color}"${markAttrs(i, s, v)}>${mark(i, s, v)}</rect>`,
        );
      });
    });
  } else if (spec.type === "bar") {
    // Proportional whitespace between grouped bars: a fixed 1px gap
    // antialiases into a dark seam once the SVG scales down.
    const inner = bandwidth / series.length;
    const barWidth = series.length > 1 ? inner * 0.88 : inner;
    series.forEach((s, si) => {
      rows.forEach((_, i) => {
        const v = s.values[i];
        if (v === null || v === undefined) return;
        const top = frame.top + yScale(Math.max(0, v));
        const h = Math.abs(yScale(v) - yScale(0));
        frame.parts.push(
          `<rect x="${xPos(i) + si * inner}" y="${top}" width="${Math.max(1, barWidth)}" height="${h}" fill="${s.color}"${markAttrs(i, s, v)}>${mark(i, s, v)}</rect>`,
        );
      });
    });
  } else if (spec.type === "scatter") {
    series.forEach((s) => {
      rows.forEach((_, i) => {
        const v = s.values[i];
        if (v === null || v === undefined) return;
        frame.parts.push(
          `<circle cx="${xPos(i)}" cy="${frame.top + yScale(v)}" r="4" fill="${s.color}" fill-opacity="0.85"${markAttrs(i, s, v)}>${mark(i, s, v)}</circle>`,
        );
      });
    });
  } else if (spec.type === "area" && spec.stack) {
    // Stacked segments never overlap, so they render fully opaque —
    // translucency here lets gridlines bleed through and muddies colors.
    const layout = stackedLayout(series);
    series.forEach((s, si) => {
      const gen = d3area<number>()
        .x((i) => xPos(i) + bandwidth / 2)
        .y0((i) => frame.top + yScale(layout[si]![i]![0]!))
        .y1((i) => frame.top + yScale(layout[si]![i]![1]!))
        .defined((i) => s.values[i] !== null && s.values[i] !== undefined);
      frame.parts.push(
        `<path d="${gen(range(rows.length)) ?? ""}" fill="${s.color}"><title>${esc(s.label)}</title></path>`,
      );
    });
  } else {
    // line, and unstacked area (fill + line on top).
    series.forEach((s) => {
      const defined = (i: number): boolean => s.values[i] !== null && s.values[i] !== undefined;
      if (spec.type === "area") {
        const gen = d3area<number>()
          .x((i) => xPos(i) + bandwidth / 2)
          .y0(() => frame.top + yScale(0))
          .y1((i) => frame.top + yScale(s.values[i]!))
          .defined(defined);
        frame.parts.push(
          `<path d="${gen(range(rows.length)) ?? ""}" fill="${s.color}" fill-opacity="0.2"/>`,
        );
      }
      const gen = d3line<number>()
        .x((i) => xPos(i) + bandwidth / 2)
        .y((i) => frame.top + yScale(s.values[i]!))
        .defined(defined);
      frame.parts.push(
        `<path d="${gen(range(rows.length)) ?? ""}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"><title>${esc(s.label)}</title></path>`,
      );
      rows.forEach((_, i) => {
        const v = s.values[i];
        if (v === null || v === undefined) return;
        frame.parts.push(
          `<circle cx="${xPos(i) + bandwidth / 2}" cy="${frame.top + yScale(v)}" r="2.5" fill="${s.color}"${markAttrs(i, s, v)}>${mark(i, s, v)}</circle>`,
        );
      });
    });
  }

  frame.parts.push("</svg>");
  return frame.parts.join("\n");
}

/** Per-series [y0, y1] pairs with diverging offset (handles negatives). */
function stackedLayout(series: SeriesData[]): [number, number][][] {
  const keys = series.map((_, i) => String(i));
  const rows = series[0]!.values.map((_, i) => {
    const row: Record<string, number> = {};
    series.forEach((s, si) => {
      row[si] = s.values[i] ?? 0;
    });
    return row;
  });
  const layout = stack<Record<string, number>>().keys(keys).offset(stackOffsetDiverging)(rows);
  return layout.map((s) => s.map((point) => [point[0], point[1]] as [number, number]));
}

// ---------------------------------------------------------------------------

const MAX_SLICES = 8;

function renderPie(spec: ChartSpec, options: RenderSvgOptions): string {
  const frame = openSvg(spec, options, 1);
  const field = spec.series[0]!.field;
  const entries = spec.data
    .map((row) => ({ label: String(row[spec.x.field]), value: row[field] as number }))
    .sort((a, b) => b.value - a.value);

  // Opinionated: donut, at most MAX_SLICES slices, tail bucketed into Other.
  let slices = entries;
  if (entries.length > MAX_SLICES) {
    const head = entries.slice(0, MAX_SLICES - 1);
    const other = entries.slice(MAX_SLICES - 1).reduce((n, e) => n + e.value, 0);
    slices = [...head, { label: "Other", value: other }];
  }
  const total = slices.reduce((n, s) => n + s.value, 0) || 1;

  const cx = frame.left + frame.innerH / 2;
  const cy = frame.top + frame.innerH / 2;
  const radius = frame.innerH / 2;
  const arcs = d3pie<{ label: string; value: number }>()
    .value((d) => d.value)
    .sort(null)(slices);
  const arcGen = arc<(typeof arcs)[number]>()
    .innerRadius(radius * 0.62)
    .outerRadius(radius)
    // A hairline of breathing room between slices keeps adjacent colors
    // from blurring together at small sizes.
    .padAngle(0.012)
    .padRadius(radius);

  arcs.forEach((a, i) => {
    const pctText = `${Math.round((a.data.value / total) * 100)}%`;
    frame.parts.push(
      `<path transform="translate(${cx},${cy})" d="${arcGen(a) ?? ""}" fill="${frame.theme.series[i % frame.theme.series.length]}" data-rm-x="${esc(a.data.label)}" data-rm-v="${esc(`${fmtValue(a.data.value)} (${pctText})`)}"><title>${esc(`${a.data.label}: ${fmtValue(a.data.value)} (${pctText})`)}</title></path>`,
    );
  });

  // Legend column to the right of the donut, one entry per slice.
  const lx = cx + radius + 32;
  arcs.forEach((a, i) => {
    const ly = frame.top + 12 + i * 22;
    const pctText = `${Math.round((a.data.value / total) * 100)}%`;
    frame.parts.push(
      `<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="2" fill="${frame.theme.series[i % frame.theme.series.length]}"/>`,
      `<text x="${lx + 16}" y="${ly}" font-size="12" fill="${frame.theme.text}">${esc(truncate(a.data.label, 22))}</text>`,
      `<text x="${lx + 16 + 150}" y="${ly}" font-size="12" fill="${frame.theme.muted}">${esc(`${fmtValue(a.data.value)} · ${pctText}`)}</text>`,
    );
  });

  frame.parts.push("</svg>");
  return frame.parts.join("\n");
}
