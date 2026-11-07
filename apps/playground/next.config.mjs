/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // The workspace packages ship untranspiled ESM with .js specifiers; Next needs
  // to run them through its own compiler rather than treating them as externals.
  transpilePackages: ["@supersolutions/super-chat-core", "@supersolutions/super-chat-client", "@supersolutions/super-chat-ui-core", "@supersolutions/super-chat-react", "@supersolutions/super-chat-ui"],
  // Some browsers block WebGL/GPU features on `localhost` but not on the loopback
  // IP, so the preview is opened at 127.0.0.1 — which Next treats as cross-origin
  // for /_next/* unless it is declared here.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
