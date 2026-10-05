/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // The dashboard is always rendered fresh — it is a view of live data.
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    },
  ],
};
