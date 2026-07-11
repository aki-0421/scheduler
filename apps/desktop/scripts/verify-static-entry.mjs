import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertDesktopNavigationContract } from "./static-navigation-contract.mjs";

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
  '<meta charSet="utf-8"',
  '<meta name="color-scheme" content="light dark"',
  "<title>Clockhand</title>",
];
const forbiddenMarkers = ['id="__next_error__"', "NEXT_REDIRECT"];

assertDesktopNavigationContract({
  desktopDir,
  internalRoutes: screenRoutes.map(({ route }) => route),
});

const themeInitSource = readFileSync(
  join(desktopDir, "public", "theme-init.js"),
  "utf8",
);
const exportedThemeInitSource = readFileSync(
  join(desktopDir, "out", "theme-init.js"),
  "utf8",
);
if (exportedThemeInitSource !== themeInitSource) {
  throw new Error("The pre-paint theme initializer was not copied unchanged.");
}
for (const marker of [
  '"codex-scheduler-theme"',
  'classList.toggle("dark"',
  "style.colorScheme",
]) {
  if (!themeInitSource.includes(marker)) {
    throw new Error(
      `The pre-paint theme initializer is incomplete: missing ${marker}.`,
    );
  }
}

const csp = tauriConfig.app?.security?.csp;
const scriptSourceDirective =
  typeof csp === "string"
    ? csp
        .split(";")
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith("script-src "))
    : undefined;
if (!scriptSourceDirective?.includes("'self'")) {
  throw new Error(
    "The Tauri script-src CSP must allow the same-origin theme initializer.",
  );
}
if (scriptSourceDirective.includes("'unsafe-inline'")) {
  throw new Error(
    "The pre-paint theme initializer must not weaken script-src with unsafe-inline.",
  );
}

const compiledCss = readdirSync(
  join(desktopDir, "out", "_next", "static", "css"),
  { withFileTypes: true },
)
  .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
  .map((entry) =>
    readFileSync(
      join(desktopDir, "out", "_next", "static", "css", entry.name),
      "utf8",
    ),
  )
  .join("\n");
for (const marker of ["color-scheme:light", "color-scheme:dark"]) {
  if (!compiledCss.includes(marker)) {
    throw new Error(`Compiled theme CSS is missing ${marker}.`);
  }
}

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

  if (!html.startsWith("<!DOCTYPE html>")) {
    throw new Error(
      `Static screen output for ${screen.route} does not start as an HTML document.`,
    );
  }

  const themeScriptIndex = html.indexOf(
    '<script src="/theme-init.js"></script>',
  );
  const bodyIndex = html.indexOf("<body>");
  if (themeScriptIndex === -1 || bodyIndex === -1 || themeScriptIndex > bodyIndex) {
    throw new Error(
      `Static screen output for ${screen.route} must synchronously initialize the theme in <head>.`,
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

  if (/<a\b[^>]*href=["'][^"']*\.txt(?:[?"'])/i.test(html)) {
    throw new Error(
      `Static screen output for ${screen.route} links to a React Server Component payload.`,
    );
  }
}

if (initialWindow?.url !== "projects/") {
  throw new Error('The Tauri main window must open the static "projects/" route.');
}

console.log(
  "Verified all static screen routes, document-only navigation, pre-paint theming, and the Tauri initial route.",
);
