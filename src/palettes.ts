/**
 * Built-in series palettes, selectable by name via the renderer's
 * `palette` option. Every palette defines a light-background and a
 * dark-background variant (they may share colors when the set works on
 * both). Consumer-supplied `colors.series` always wins over a named
 * palette.
 *
 * This is consumer API only — the chart DSL has no color vocabulary and
 * never will (SPEC.md design goal: models state facts, not styles).
 */

export type PaletteName = "default" | "okabe-ito" | "muted" | "monochrome";

export interface PaletteDef {
  light: string[];
  dark: string[];
}

// The classic Tableau 10 subset Rollmark has shipped with from the start:
// distinguishable, balanced, works on both backgrounds.
const DEFAULT = [
  "#4E79A7",
  "#F28E2B",
  "#59A14F",
  "#E15759",
  "#B07AA1",
  "#76B7B2",
  "#EDC949",
  "#9C755F",
];

// Okabe–Ito: the standard colorblind-safe palette. The black/white slot is
// ordered last and swaps per theme.
const OKABE_ITO_LIGHT = [
  "#0072B2",
  "#E69F00",
  "#009E73",
  "#D55E00",
  "#CC79A7",
  "#56B4E9",
  "#F0E442",
  "#000000",
];
const OKABE_ITO_DARK = [
  "#56B4E9",
  "#E69F00",
  "#009E73",
  "#D55E00",
  "#CC79A7",
  "#0072B2",
  "#F0E442",
  "#FFFFFF",
];

// Softer, lower-saturation editorial set (seaborn "muted" lineage).
const MUTED = [
  "#4878D0",
  "#EE854A",
  "#6ACC64",
  "#D65F5F",
  "#956CB4",
  "#8C613C",
  "#DC7EC0",
  "#797979",
];

// Single-hue blue ramp: first series darkest-on-light / lightest-on-dark,
// so low series counts stay high-contrast on either background.
const MONO_LIGHT = [
  "#123F66",
  "#1D5A8A",
  "#2E75A9",
  "#4790C2",
  "#66AAD6",
  "#8EC2E6",
  "#B7D9F0",
  "#DCECF8",
];
const MONO_DARK = [
  "#E3F0FA",
  "#BCD9F0",
  "#93C1E4",
  "#6DA9D6",
  "#4B90C5",
  "#2E77AD",
  "#1D5F92",
  "#124A75",
];

export const PALETTES: Record<PaletteName, PaletteDef> = {
  default: { light: DEFAULT, dark: DEFAULT },
  "okabe-ito": { light: OKABE_ITO_LIGHT, dark: OKABE_ITO_DARK },
  muted: { light: MUTED, dark: MUTED },
  monochrome: { light: MONO_LIGHT, dark: MONO_DARK },
};
