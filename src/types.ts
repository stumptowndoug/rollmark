/** The x-axis encoding of a chart block (SPEC.md §2.2). */
export interface ChartAxis {
  field: string;
  label?: string;
  type?: "category" | "temporal";
}

/** One line or bar group (SPEC.md §2.2). */
export interface ChartSeries {
  field: string;
  label?: string;
}

/** A validated Rollmark `chart` payload, version 1 (SPEC.md §2). */
export interface ChartSpec {
  version: 1;
  type: "line" | "bar";
  title?: string;
  summary?: string;
  x: ChartAxis;
  series: ChartSeries[];
  data: Record<string, unknown>[];
}

/** A single validation error or warning. */
export interface ValidationIssue {
  code: string;
  message: string;
}

/**
 * Fields salvaged from an invalid payload for fallback display (SPEC.md §4:
 * the fallback shows title and summary "if parseable").
 */
export interface ChartPartial {
  title?: string;
  summary?: string;
}

export type ChartValidationResult =
  | { ok: true; spec: ChartSpec; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[]; partial: ChartPartial };

/** A visual block extracted from a document, in document order. */
export type RollmarkBlock =
  | {
      id: number;
      type: "chart";
      source: string;
      /** Present when the payload validated. */
      spec?: ChartSpec;
      warnings: ValidationIssue[];
      /** Present when the payload was invalid. */
      errors?: ValidationIssue[];
    }
  | {
      id: number;
      type: "mermaid";
      source: string;
    };

/**
 * Compiles a validated chart spec into a renderer-native representation.
 * The persisted document format never depends on the compiler chosen
 * (SPEC.md design goal 3).
 */
export interface ChartCompiler<T> {
  compile(spec: ChartSpec): T;
}
