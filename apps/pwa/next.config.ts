import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to this repo so multi-lockfile
  // setups (e.g. when /Users/mac has its own package-lock.json) don't
  // trigger the inferred-root warning. See:
  //   https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
