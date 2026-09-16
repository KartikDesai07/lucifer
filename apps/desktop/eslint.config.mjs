import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["out/**", "dist/**", "node_modules/**", "resources/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "error", "@typescript-eslint/no-explicit-any": "error" },
  },
  {
    files: ["assets/**/*.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
    rules: { "no-console": "error" },
  },
);
