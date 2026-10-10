import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The chat route reads the system prompt file at runtime. Next.js only copies files it can
  // see imported, so say explicitly that this folder must be deployed with the route.
  outputFileTracingIncludes: { "/api/chat": ["./src/lib/prompts/**/*"] },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
