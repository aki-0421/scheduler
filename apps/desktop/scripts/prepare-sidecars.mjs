import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const tauriDir = resolve(scriptDir, "..", "src-tauri");
const binariesDir = join(tauriDir, "binaries");
const sidecars = ["codex-schedulerd", "codex-schedule"];

function hostTriple() {
  const output = execFileSync("rustc", ["-vV"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const host = output
    .split("\n")
    .find((line) => line.startsWith("host: "))
    ?.slice("host: ".length)
    .trim();

  if (!host) {
    throw new Error("Could not determine Rust host target triple.");
  }

  return host;
}

function targetDir() {
  const configured = process.env.CARGO_TARGET_DIR;
  if (!configured) {
    return join(repoRoot, "target");
  }

  return isAbsolute(configured) ? configured : resolve(repoRoot, configured);
}

const host = hostTriple();
const targetTriple = process.env.TAURI_TARGET_TRIPLE ?? process.env.TARGET_TRIPLE ?? host;
const exe = targetTriple.includes("windows") ? ".exe" : "";
const buildArgs = [
  "build",
  "--manifest-path",
  join(repoRoot, "Cargo.toml"),
  "--bin",
  "codex-schedulerd",
  "--bin",
  "codex-schedule",
];

if (targetTriple !== host) {
  buildArgs.push("--target", targetTriple);
}

execFileSync("cargo", buildArgs, {
  cwd: repoRoot,
  stdio: "inherit",
});

mkdirSync(binariesDir, { recursive: true });

for (const sidecar of sidecars) {
  const source = join(
    targetDir(),
    targetTriple === host ? "debug" : join(targetTriple, "debug"),
    `${sidecar}${exe}`,
  );
  const destination = join(binariesDir, `${sidecar}-${targetTriple}${exe}`);

  statSync(source);
  copyFileSync(source, destination);
  console.log(`Prepared Tauri sidecar: ${destination}`);
}
