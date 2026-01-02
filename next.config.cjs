/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true, // 개발 중 오류 감지 강화
  swcMinify: true,       // 빌드 최적화
  experimental: {
    appDir: true          // app/ 디렉토리 기반 라우팅 사용 시 필요
  },
  images: {
    domains: ['localhost', 'cdn.jm-i.com'], // 이미지 로딩 허용 도메인
  },
  typescript: {
    ignoreBuildErrors: false, // 타입스크립트 에러 무시 여부 (true로 하면 빠르게 진행 가능하지만 비추천)
  },
  eslint: {
    ignoreDuringBuilds: true, // 빌드 중 ESLint 무시
  },
};

module.exports = nextConfig;
