import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outputFileTracingRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "export",
  outputFileTracingRoot,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
