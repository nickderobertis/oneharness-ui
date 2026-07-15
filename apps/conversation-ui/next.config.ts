import type { NextConfig } from "next";

const config: NextConfig = {
  images: { unoptimized: true },
  output: "export",
  poweredByHeader: false,
  reactStrictMode: true,
  trailingSlash: true,
};

export default config;
