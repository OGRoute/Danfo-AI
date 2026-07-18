/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@0glabs/0g-ts-sdk", "@0glabs/0g-serving-broker"],
  },
};
module.exports = nextConfig;