import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const entryHtml = readFileSync(join(desktopDir, "out", "index.html"), "utf8");
const tauriConfig = JSON.parse(
  readFileSync(join(desktopDir, "src-tauri", "tauri.conf.json"), "utf8"),
);
const initialWindow = tauriConfig.app?.windows?.[0];

for (const forbiddenMarker of ['id="__next_error__"', "NEXT_REDIRECT"]) {
  if (entryHtml.includes(forbiddenMarker)) {
    throw new Error(
      `Static entry contains a server redirect error marker: ${forbiddenMarker}`,
    );
  }
}

if (!entryHtml.includes("プロジェクトを開いています")) {
  throw new Error("Static entry does not contain the client navigation fallback.");
}

if (initialWindow?.url !== "projects/") {
  throw new Error('The Tauri main window must open the static "projects/" route.');
}

console.log("Verified static entry and Tauri initial route.");
