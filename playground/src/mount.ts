import mermaid from "mermaid";
import { mountRollmarkDocument } from "rollmark";
import type { MountedRollmark } from "rollmark";

export const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export type MountedDocument = MountedRollmark;

/** Thin wrapper over the package's mounting helper — what any consumer writes. */
export async function renderDocumentInto(
  container: HTMLElement,
  source: string,
): Promise<MountedRollmark> {
  return mountRollmarkDocument(container, source, { theme: "auto", mermaid });
}
