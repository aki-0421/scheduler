import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const tauriConfig = JSON.parse(
  readFileSync(join(desktopDir, "src-tauri", "tauri.conf.json"), "utf8"),
);
const initialWindow = tauriConfig.app?.windows?.[0];

const screenRoutes = [
  {
    route: "/",
    output: "index.html",
    marker: "プロジェクトを開いています",
  },
  {
    route: "/projects",
    output: "projects/index.html",
    marker: "Gitプロジェクトを追加",
  },
  {
    route: "/tasks",
    output: "tasks/index.html",
    marker: "タスクを読み込んでいます",
  },
  {
    route: "/tasks/new",
    output: "tasks/new/index.html",
    marker: ">新規タスク</h1>",
  },
  {
    route: "/runs",
    output: "runs/index.html",
    marker: "実行を読み込んでいます",
  },
  {
    route: "/settings",
    output: "settings/index.html",
    marker: "診断情報をエクスポート",
  },
];

const documentMarkers = [
  "<!DOCTYPE html>",
  '<html lang="ja"',
  "<title>Clockhand</title>",
];
const forbiddenMarkers = ['id="__next_error__"', "NEXT_REDIRECT"];

for (const screen of screenRoutes) {
  const outputPath = join(desktopDir, "out", screen.output);
  let html;
  try {
    html = readFileSync(outputPath, "utf8");
  } catch (error) {
    throw new Error(
      `Static screen output is missing for ${screen.route}: ${screen.output}`,
      { cause: error },
    );
  }

  for (const marker of documentMarkers) {
    if (!html.includes(marker)) {
      throw new Error(
        `Static screen output for ${screen.route} is not a Clockhand HTML document: missing ${marker}`,
      );
    }
  }

  for (const marker of forbiddenMarkers) {
    if (html.includes(marker)) {
      throw new Error(
        `Static screen output for ${screen.route} contains a Next.js error marker: ${marker}`,
      );
    }
  }

  if (!html.includes(screen.marker)) {
    throw new Error(
      `Static screen output for ${screen.route} is missing its render marker: ${screen.marker}`,
    );
  }
}

if (initialWindow?.url !== "projects/") {
  throw new Error('The Tauri main window must open the static "projects/" route.');
}

console.log("Verified all static screen routes and the Tauri initial route.");
