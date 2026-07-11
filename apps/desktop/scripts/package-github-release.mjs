import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "../..");
const tauriDir = join(desktopDir, "src-tauri");
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
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

if (args.length !== 2 || args[0] !== "--target") {
  throw new Error("Usage: package-github-release.mjs --target <Rust target triple>");
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
  if (!host) throw new Error("Could not determine Rust host target triple.");
  return host;
}

function targetDirectory() {
  const configured = process.env.CARGO_TARGET_DIR;
  if (!configured) return join(repoRoot, "target");
  return isAbsolute(configured) ? configured : resolve(repoRoot, configured);
}

function targetDetails(target) {
  const architecture = target.startsWith("aarch64-") ? "arm64" : "x64";
  if (target.includes("apple-darwin")) {
    return { platform: "macos", architecture, executableExtension: "" };
  }
  if (target.includes("windows")) {
    return { platform: "windows", architecture, executableExtension: ".exe" };
  }
  if (target.includes("linux")) {
    return { platform: "linux", architecture, executableExtension: "" };
  }
  throw new Error(`Unsupported release target: ${target}`);
}

function findFiles(directory, predicate) {
  if (!existsSync(directory)) return [];
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findFiles(path, predicate));
    } else if (entry.isFile() && predicate(path)) {
      matches.push(path);
    }
  }
  return matches;
}

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`${label} was not found or is empty: ${path}`);
  }
}

function requireSingleFile(directory, predicate, label) {
  const matches = findFiles(directory, predicate);
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${label} under ${directory}, found ${matches.length}: ${matches.join(", ")}`,
    );
  }
  return matches[0];
}

function assertBinaryArchitecture(path, target) {
  if (target.includes("apple-darwin")) {
    const output = execFileSync("lipo", ["-archs", path], {
      encoding: "utf8",
    }).trim();
    const expected = target.startsWith("aarch64-") ? "arm64" : "x86_64";
    if (output !== expected) {
      throw new Error(`${path} has architecture ${output}; expected ${expected}.`);
    }
    return;
  }

  const bytes = Buffer.alloc(4096);
  const descriptor = openSync(path, "r");
  let bytesRead;
  try {
    bytesRead = readSync(descriptor, bytes, 0, bytes.length, 0);
  } finally {
    closeSync(descriptor);
  }

  if (target.includes("windows")) {
    if (bytesRead < 64 || bytes.toString("ascii", 0, 2) !== "MZ") {
      throw new Error(`${path} is not a PE executable.`);
    }
    const peOffset = bytes.readUInt32LE(0x3c);
    if (peOffset + 6 > bytesRead) {
      throw new Error(`${path} has an invalid PE header offset.`);
    }
    const signature = bytes.toString("ascii", peOffset, peOffset + 4);
    const machine = bytes.readUInt16LE(peOffset + 4);
    if (signature !== "PE\0\0" || machine !== 0x8664) {
      throw new Error(`${path} is not an x64 PE executable.`);
    }
    return;
  }

  if (bytesRead < 20 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error(`${path} is not an ELF executable.`);
  }
  const expectedMachine = target.startsWith("aarch64-") ? 183 : 62;
  const machine = bytes.readUInt16LE(18);
  if (machine !== expectedMachine) {
    throw new Error(`${path} has ELF machine ${machine}; expected ${expectedMachine}.`);
  }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function writeChecksum(path) {
  const checksumPath = `${path}.sha256`;
  const digest = await sha256(path);
  writeFileSync(checksumPath, `${digest}  ${basename(path)}\n`, "utf8");
  return checksumPath;
}

const target = argumentValue("--target");
if (!supportedTargets.has(target)) {
  throw new Error(`Target ${target} is not part of the Clockhand release contract.`);
}
const host = hostTriple();
const details = targetDetails(target);
const packageJson = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));
const tauriConfig = JSON.parse(
  readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"),
);
if (packageJson.version !== tauriConfig.version) {
  throw new Error(
    `Desktop package version ${packageJson.version} does not match Tauri version ${tauriConfig.version}.`,
  );
}

const releaseRoot = join(
  targetDirectory(),
  target === host ? "release" : join(target, "release"),
);
const bundleRoot = join(releaseRoot, "bundle");
const distDir = join(repoRoot, "dist");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

for (const binary of ["codex-scheduler-desktop", "codex-schedulerd", "codex-schedule"]) {
  const path =
    binary === "codex-scheduler-desktop"
      ? join(releaseRoot, `${binary}${details.executableExtension}`)
      : join(
          tauriDir,
          "binaries",
          `${binary}-${target}${details.executableExtension}`,
        );
  requireFile(path, `${binary} binary`);
  assertBinaryArchitecture(path, target);
}

const assets = [];
if (details.platform === "macos") {
  const appPath = join(bundleRoot, "macos", "Clockhand.app");
  if (!existsSync(appPath) || !statSync(appPath).isDirectory()) {
    throw new Error(`Clockhand app bundle was not found: ${appPath}`);
  }
  for (const binary of ["codex-scheduler-desktop", "codex-schedulerd", "codex-schedule"]) {
    const path = join(appPath, "Contents", "MacOS", binary);
    requireFile(path, `bundled ${binary}`);
    if ((statSync(path).mode & 0o111) === 0) {
      throw new Error(`Bundled executable is not executable: ${path}`);
    }
    assertBinaryArchitecture(path, target);
  }
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const archive = join(
    distDir,
    `Clockhand-${packageJson.version}-macos-${details.architecture}-adhoc.zip`,
  );
  execFileSync(
    "ditto",
    ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, archive],
    { cwd: repoRoot, stdio: "inherit" },
  );
  const extractedDirectory = mkdtempSync(join(tmpdir(), "clockhand-release-"));
  try {
    execFileSync("ditto", ["-x", "-k", archive, extractedDirectory], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    execFileSync(
      "codesign",
      [
        "--verify",
        "--deep",
        "--strict",
        "--verbose=2",
        join(extractedDirectory, "Clockhand.app"),
      ],
      { cwd: repoRoot, stdio: "inherit" },
    );
  } finally {
    rmSync(extractedDirectory, { recursive: true, force: true });
  }
  assets.push(archive);
} else if (details.platform === "windows") {
  const installer = requireSingleFile(
    join(bundleRoot, "nsis"),
    (path) => path.toLowerCase().endsWith(".exe"),
    "NSIS installer",
  );
  const destination = join(
    distDir,
    `Clockhand-${packageJson.version}-windows-${details.architecture}-setup.exe`,
  );
  copyFileSync(installer, destination);
  assets.push(destination);
} else {
  const appImage = requireSingleFile(
    join(bundleRoot, "appimage"),
    (path) => path.endsWith(".AppImage"),
    "AppImage",
  );
  assertBinaryArchitecture(appImage, target);
  const deb = requireSingleFile(
    join(bundleRoot, "deb"),
    (path) => path.endsWith(".deb"),
    "Debian package",
  );
  const appImageDestination = join(
    distDir,
    `Clockhand-${packageJson.version}-linux-${details.architecture}.AppImage`,
  );
  const debDestination = join(
    distDir,
    `Clockhand-${packageJson.version}-linux-${details.architecture}.deb`,
  );
  copyFileSync(appImage, appImageDestination);
  copyFileSync(deb, debDestination);
  assets.push(appImageDestination, debDestination);
}

const manifestAssets = [];
for (const asset of assets) {
  requireFile(asset, "release artifact");
  const checksum = await writeChecksum(asset);
  manifestAssets.push({ file: basename(asset), checksum: basename(checksum) });
  console.log(`Packaged release artifact: ${relative(repoRoot, asset)}`);
  console.log(`Wrote SHA-256: ${relative(repoRoot, checksum)}`);
}

const manifestPath = join(distDir, `release-manifest-${target}.json`);
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      version: packageJson.version,
      target,
      platform: details.platform,
      architecture: details.architecture,
      assets: manifestAssets,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`Wrote release manifest: ${relative(repoRoot, manifestPath)}`);
