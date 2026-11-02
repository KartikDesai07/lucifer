import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// D4 (F8): only `next build` (which sets NEXT_PHASE before it lints) skips the tests;
// `npm run lint` / `eslint .` still lints every file.
const buildOnlyIgnores =
  process.env.NEXT_PHASE === "phase-production-build"
    ? ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs", "**/*.fixtures.ts"]
    : [];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Honour the `_`-prefix convention for intentionally-unused identifiers — used
    // by interface/seam stubs whose params document a contract a later phase fills
    // (e.g. lib/db.ts getConnection(role), lib/tenant.ts customDomainLookup(host)).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      ...buildOnlyIgnores,
    ],
  },
];

export default eslintConfig;
