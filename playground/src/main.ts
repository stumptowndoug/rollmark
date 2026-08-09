import exampleDoc from "../../examples/weekly-analytics.md?raw";
import { darkQuery, initMermaid, renderDocumentInto } from "./mount.js";
import type { MountedDocument } from "./mount.js";

const input = document.getElementById("input") as HTMLTextAreaElement;
const preview = document.getElementById("preview") as HTMLDivElement;

let mounted: MountedDocument | undefined;

async function render(): Promise<void> {
  mounted?.dispose();
  mounted = await renderDocumentInto(preview, input.value);
}

let timer: ReturnType<typeof setTimeout> | undefined;
input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(render, 250);
});

window.addEventListener("resize", () => mounted?.resize());

darkQuery.addEventListener("change", () => {
  initMermaid();
  void render();
});

initMermaid();
input.value = exampleDoc;
void render();
