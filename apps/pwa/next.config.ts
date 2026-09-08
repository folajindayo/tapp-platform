import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root to the MONOREPO root, not this app.
  //
  // Two things force it there. First, the parent directory of the repo
  // (/Users/mac) carries its own package.json, package-lock.json and
  // yarn.lock, so left to infer, Turbopack walks up and picks that.
  // Second -- and the reason this must be the repo root rather than
  // apps/pwa -- pnpm keeps the real packages in the workspace's
  // node_modules/.pnpm and leaves only symlinks here. Rooting at
  // apps/pwa puts every one of those real files "outside the project
  // directory", which Turbopack refuses to compile; it then cannot
  // resolve next/package.json and the dev server exits.
  //
  //   https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
  turbopack: {
    root: path.resolve(__dirname, "..", ".."),
  },
};

export default nextConfig;
