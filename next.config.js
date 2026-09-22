/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@0glabs/0g-ts-sdk", "@0glabs/0g-serving-broker"],
  },
  async rewrites() {
    // Clerk's production instance proxies its Frontend API through this app
    // (see app/api/clerk-proxy). App Router hides folders starting with "_",
    // hence the rewrite rather than an app/__clerk route.
    return [{ source: "/__clerk/:path*", destination: "/api/clerk-proxy/:path*" }];
  },
};
module.exports = nextConfig;