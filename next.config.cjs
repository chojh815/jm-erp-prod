/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // ✅ static export 금지 (ERP는 SSR/Route Handler 사용)
  output: "standalone",

  images: {
    domains: ["localhost", "cdn.jm-i.com"],
  },

  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
