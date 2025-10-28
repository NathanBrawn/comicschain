import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/comicschain",
  assetPrefix: "/comicschain/",
  reactStrictMode: true,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: "/comicschain",
  },
  experimental: {
    turbo: {
      rules: {},
    },
  },
  // Skip dynamic routes during static export
  // They will be handled client-side via 404.html fallback
};

export default nextConfig;




