import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const releaseDir = resolve(process.argv[2] ?? "dist");
const expectedVersion = process.argv[3];
const expectedTargets = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
];

function requireFile(path) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`Expected non-empty release file: ${path}`);
  }
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const manifestPaths = readdirSync(releaseDir)
  .filter((name) => name.startsWith("release-manifest-") && name.endsWith(".json"))
  .map((name) => join(releaseDir, name));
if (manifestPaths.length !== expectedTargets.length) {
  throw new Error(
    `Expected ${expectedTargets.length} release manifests, found ${manifestPaths.length}.`,
  );
}

const manifests = manifestPaths.map((path) => JSON.parse(readFileSync(path, "utf8")));
const targets = manifests.map((manifest) => manifest.target).sort();
if (targets.join("\n") !== [...expectedTargets].sort().join("\n")) {
  throw new Error(`Release target set is incomplete: ${targets.join(", ")}`);
}
const versions = new Set(manifests.map((manifest) => manifest.version));
if (versions.size !== 1) {
  throw new Error(`Release manifests contain multiple versions: ${[...versions].join(", ")}`);
}
if (expectedVersion && !versions.has(expectedVersion)) {
  throw new Error(
    `Release manifest version ${[...versions][0]} does not match expected ${expectedVersion}.`,
  );
}

const expectedAssetCount = new Map([
  ["aarch64-apple-darwin", 1],
  ["x86_64-apple-darwin", 1],
  ["x86_64-pc-windows-msvc", 1],
  ["x86_64-unknown-linux-gnu", 2],
  ["aarch64-unknown-linux-gnu", 2],
]);

function expectedAssetNames(version, target) {
  const architecture = target.startsWith("aarch64-") ? "arm64" : "x64";
  if (target.includes("apple-darwin")) {
    return [`Clockhand-${version}-macos-${architecture}-adhoc.zip`];
  }
  if (target.includes("windows")) {
    return [`Clockhand-${version}-windows-${architecture}-setup.exe`];
  }
  return [
    `Clockhand-${version}-linux-${architecture}.AppImage`,
    `Clockhand-${version}-linux-${architecture}.deb`,
  ];
}

const releaseNames = new Set();
for (const manifest of manifests) {
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported release manifest schema for ${manifest.target}.`);
  }
  if (manifest.assets.length !== expectedAssetCount.get(manifest.target)) {
    throw new Error(`Unexpected asset count for ${manifest.target}.`);
  }
  const actualAssetNames = manifest.assets.map((asset) => asset.file).sort();
  const requiredAssetNames = expectedAssetNames(manifest.version, manifest.target).sort();
  if (actualAssetNames.join("\n") !== requiredAssetNames.join("\n")) {
    throw new Error(`Unexpected asset names for ${manifest.target}: ${actualAssetNames.join(", ")}`);
  }
  for (const asset of manifest.assets) {
    if (asset.checksum !== `${asset.file}.sha256`) {
      throw new Error(`Unexpected checksum filename for ${asset.file}.`);
    }
    if (releaseNames.has(asset.file) || releaseNames.has(asset.checksum)) {
      throw new Error(`Duplicate release filename: ${asset.file}`);
    }
    releaseNames.add(asset.file);
    releaseNames.add(asset.checksum);
    const assetPath = join(releaseDir, asset.file);
    const checksumPath = join(releaseDir, asset.checksum);
    requireFile(assetPath);
    requireFile(checksumPath);
    const expectedLine = `${await sha256(assetPath)}  ${basename(assetPath)}\n`;
    const actualLine = readFileSync(checksumPath, "utf8");
    if (actualLine !== expectedLine) {
      throw new Error(`Checksum mismatch for ${asset.file}.`);
    }
  }
}

const actualReleaseNames = readdirSync(releaseDir).filter((name) => name.startsWith("Clockhand-"));
if (
  actualReleaseNames.length !== releaseNames.size ||
  actualReleaseNames.some((name) => !releaseNames.has(name))
) {
  throw new Error(`Unexpected release files: ${actualReleaseNames.join(", ")}`);
}

console.log(
  `Verified ${releaseNames.size / 2} cross-platform artifacts and checksums for Clockhand ${[
    ...versions,
  ][0]}.`,
);
