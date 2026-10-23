/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.PAGES_BASE_PATH ?? "",
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: ["@super-solution/super-chat-core", "@super-solution/super-chat-react", "@super-solution/super-chat-ui"],
  experimental: { externalDir: true },
};

export default nextConfig;
