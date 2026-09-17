export default {
  entry: ["core/**/*.test.ts", "core/*.config.{ts,js}"],
  project: ["core/**/*.{js,mjs,ts}"],
  ignoreWorkspaces: ["lib/md-html"],
  includeEntryExports: true,
  vitest: { config: ["core/vitest.config.ts"] },
  eslint: { config: ["core/eslint.config.js"] },
  include: ["files", "exports", "nsExports", "types", "nsTypes", "duplicates", "unresolved"],
};
