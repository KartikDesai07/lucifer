import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// D4 (F8, fix I1): only the deploy build skips the tests. `next build` sets NODE_ENV=production at CLI
// start, before it spawns its lint worker (NEXT_PHASE is set only after linting, so it cannot be the key).
// `npm run lint` / `eslint .` leaves NODE_ENV unset and still lints every file; `NODE_ENV=production eslint .`
// skips the tests on purpose, exactly as the build does.
const buildOnlyIgnores =
  process.env.NODE_ENV === "production"
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
