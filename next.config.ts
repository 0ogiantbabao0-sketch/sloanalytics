import type { NextConfig } from "next";
const config: NextConfig = {
  // Keep the development indicator from covering mobile navigation targets.
  devIndicators: false,
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false,
  experimental: { cpus: 2 },
};
export default config;
