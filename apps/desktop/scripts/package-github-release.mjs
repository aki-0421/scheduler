import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "../..");
const bundlePath = join(
  repoRoot,
  "target",
  "release",
  "bundle",
  "macos",
  "Clockhand.app",
);
const packageJson = JSON.parse(
  readFileSync(join(desktopDir, "package.json"), "utf8"),
);
const tauriConfig = JSON.parse(
  readFileSync(join(desktopDir, "src-tauri", "tauri.conf.json"), "utf8"),
);
if (packageJson.version !== tauriConfig.version) {
  throw new Error(
    `Desktop package version ${packageJson.version} does not match Tauri version ${tauriConfig.version}.`,
  );
}
const architecture = process.arch === "x64" ? "x64" : process.arch;
const artifactName = `Clockhand-${packageJson.version}-macos-${architecture}-adhoc.zip`;
const distDir = join(repoRoot, "dist");
const archivePath = join(distDir, artifactName);
const checksumPath = `${archivePath}.sha256`;

if (process.platform !== "darwin") {
  throw new Error("GitHub release packaging currently requires macOS and ditto.");
}

if (!existsSync(bundlePath) || !statSync(bundlePath).isDirectory()) {
  throw new Error(`Clockhand app bundle was not found: ${bundlePath}`);
}

for (const executable of [
  "codex-scheduler-desktop",
  "codex-schedulerd",
  "codex-schedule",
]) {
  const executablePath = join(bundlePath, "Contents", "MacOS", executable);
  if (!existsSync(executablePath) || !statSync(executablePath).isFile()) {
    throw new Error(`Bundled executable was not found: ${executablePath}`);
  }
  if ((statSync(executablePath).mode & 0o111) === 0) {
    throw new Error(`Bundled executable is not executable: ${executablePath}`);
  }
}

execFileSync(
  "codesign",
  ["--verify", "--deep", "--strict", "--verbose=2", bundlePath],
  { cwd: repoRoot, stdio: "inherit" },
);

mkdirSync(distDir, { recursive: true });
rmSync(archivePath, { force: true });
rmSync(checksumPath, { force: true });

execFileSync(
  "ditto",
  ["-c", "-k", "--sequesterRsrc", "--keepParent", bundlePath, archivePath],
  { cwd: repoRoot, stdio: "inherit" },
);

const hash = createHash("sha256");
for await (const chunk of createReadStream(archivePath)) {
  hash.update(chunk);
}
const digest = hash.digest("hex");
writeFileSync(checksumPath, `${digest}  ${basename(archivePath)}\n`, "utf8");

console.log(`Packaged GitHub artifact: ${relative(repoRoot, archivePath)}`);
console.log(`Wrote SHA-256: ${relative(repoRoot, checksumPath)}`);
