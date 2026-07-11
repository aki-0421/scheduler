import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "../..");
const args = process.argv.slice(2);
const supportedTargets = new Set([
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
]);

function argumentValue(name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

const knownArgs = new Set(["--target"]);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (!knownArgs.has(argument)) {
    throw new Error(`Unknown release build argument: ${argument}`);
  }
  index += 1;
}

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

function platformForTarget(target) {
  if (target.includes("apple-darwin")) return "darwin";
  if (target.includes("windows")) return "win32";
  if (target.includes("linux")) return "linux";
  throw new Error(`Unsupported release target: ${target}`);
}

function bundlesForTarget(target) {
  const platform = platformForTarget(target);
  if (platform === "darwin") return "app";
  if (platform === "win32") return "nsis";
  return "appimage,deb";
}

function runPnpm(pnpmArgs, env) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    execFileSync(process.execPath, [npmExecPath, ...pnpmArgs], {
      cwd: desktopDir,
      env,
      stdio: "inherit",
    });
    return;
  }

  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(command, pnpmArgs, {
    cwd: desktopDir,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

const host = hostTriple();
const target =
  argumentValue("--target") ??
  process.env.TAURI_TARGET_TRIPLE ??
  process.env.TARGET_TRIPLE ??
  host;
if (!supportedTargets.has(target)) {
  throw new Error(`Target ${target} is not part of the Clockhand release contract.`);
}
const targetPlatform = platformForTarget(target);
if (targetPlatform !== process.platform) {
  throw new Error(
    `Release target ${target} must be built on its native OS (${targetPlatform}), not ${process.platform}.`,
  );
}

const env = {
  ...process.env,
  TARGET_TRIPLE: target,
  TAURI_TARGET_TRIPLE: target,
};
const tauriArgs = [
  "tauri",
  "build",
  "--ci",
  "--bundles",
  bundlesForTarget(target),
];
if (target !== host) {
  tauriArgs.push("--target", target);
}

execFileSync(process.execPath, [resolve(scriptDir, "verify-release-version.mjs")], {
  cwd: desktopDir,
  env,
  stdio: "inherit",
});
runPnpm(tauriArgs, env);
execFileSync(
  process.execPath,
  [resolve(scriptDir, "package-github-release.mjs"), "--target", target],
  { cwd: desktopDir, env, stdio: "inherit" },
);
