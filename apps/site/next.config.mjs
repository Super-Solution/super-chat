/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.PAGES_BASE_PATH ?? "",
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: ["@supersolutions/super-chat-core", "@supersolutions/super-chat-client", "@supersolutions/super-chat-ui-core", "@supersolutions/super-chat-react", "@supersolutions/super-chat-ui"],
  experimental: { externalDir: true },
};

export default nextConfig;
