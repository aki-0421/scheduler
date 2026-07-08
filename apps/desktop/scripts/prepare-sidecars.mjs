import { execFileSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const tauriDir = resolve(scriptDir, "..", "src-tauri");
const binariesDir = join(tauriDir, "binaries");
const sidecars = ["codex-schedulerd", "codex-schedule"];
const placeholderMarker =
  "This placeholder is only for cargo check/test. Run pnpm --filter desktop sidecars:prepare before bundling.";

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

function sidecarSourcePath(sidecar) {
  return join(
    targetDir(),
    targetTriple === host ? "debug" : join(targetTriple, "debug"),
    `${sidecar}${exe}`,
  );
}

function readFilePrefix(path, byteLength = 256) {
  const buffer = Buffer.alloc(byteLength);
  const fd = openSync(path, "r");
  try {
    const bytesRead = readSync(fd, buffer, 0, byteLength, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function isPlaceholder(path) {
  return existsSync(path) && readFilePrefix(path).includes(placeholderMarker);
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

for (const sidecar of sidecars) {
  const source = sidecarSourcePath(sidecar);
  if (isPlaceholder(source)) {
    unlinkSync(source);
  }
}

execFileSync("cargo", buildArgs, {
  cwd: repoRoot,
  stdio: "inherit",
});

mkdirSync(binariesDir, { recursive: true });

for (const sidecar of sidecars) {
  const source = sidecarSourcePath(sidecar);
  const destination = join(binariesDir, `${sidecar}-${targetTriple}${exe}`);

  const sourceStats = statSync(source);
  if (sourceStats.size === 0 || isPlaceholder(source)) {
    throw new Error(`Cargo produced an invalid sidecar binary: ${source}`);
  }

  copyFileSync(source, destination);
  console.log(`Prepared Tauri sidecar: ${destination}`);
}
