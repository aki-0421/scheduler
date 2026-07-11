import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "../..");
const packageVersion = JSON.parse(
  readFileSync(join(desktopDir, "package.json"), "utf8"),
).version;
const tauriVersion = JSON.parse(
  readFileSync(join(desktopDir, "src-tauri", "tauri.conf.json"), "utf8"),
).version;
const cargoManifests = [
  "crates/scheduler-core/Cargo.toml",
  "crates/schedulerd/Cargo.toml",
  "crates/schedule-cli/Cargo.toml",
  "crates/codex-runner/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.toml",
];

function cargoPackageVersion(path) {
  const contents = readFileSync(join(repoRoot, path), "utf8");
  const packageSection = contents.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1];
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error(`Could not read [package].version from ${path}.`);
  return version;
}

const versions = new Map([
  ["apps/desktop/package.json", packageVersion],
  ["apps/desktop/src-tauri/tauri.conf.json", tauriVersion],
  ...cargoManifests.map((path) => [path, cargoPackageVersion(path)]),
]);
const mismatches = [...versions].filter(([, version]) => version !== packageVersion);
if (mismatches.length > 0) {
  throw new Error(
    `Release versions do not match ${packageVersion}: ${mismatches
      .map(([path, version]) => `${path}=${version}`)
      .join(", ")}`,
  );
}

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (tag && tag !== `v${packageVersion}`) {
  throw new Error(`Tag ${tag} does not match application version ${packageVersion}.`);
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${packageVersion}\n`, "utf8");
}
console.log(`Verified Clockhand ${packageVersion} across tag and package manifests.`);
