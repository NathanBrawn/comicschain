import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
  images: {
    unoptimized: true,
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




