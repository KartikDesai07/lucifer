import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Honour the `_`-prefix convention for intentionally-unused identifiers (seam
    // stubs whose params document a contract a later F3 step fills).
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
    // F3.2/F3.4 grep gate: plaintext credentials AND the TOTP seed flow through
    // these modules — none may console-log. Belt-and-braces with the source-scan
    // tests (lib/vault.test.ts). F3.4 adds the TOTP + owner-auth + gate path.
    // F3.5 adds the provider clients (SRV URIs with passwords, bearer/API
    // tokens, env-var values flow through them).
    files: [
      "lib/vault.ts",
      "lib/vault-core.ts",
      "models/Secret.ts",
      "lib/totp.ts",
      "lib/totp-secret.ts",
      "lib/totp-rotate.ts",
      "lib/owner-totp.ts",
      "lib/auth.ts",
      "lib/panel-gate.ts",
      "lib/panel-gate-core.ts",
      "lib/provider-retry.ts",
      "lib/atlas-plan.ts",
      "lib/atlas.ts",
      "lib/vercel.ts",
      "lib/imagestore.ts",
      // F3.6 adds the provisioner: SRV URIs, tokens, and env-var values flow
      // through the state machine, its steps, and the registry/vault ports.
      "lib/provisioner-plan.ts",
      "lib/provisioner-registry.ts",
      "lib/provisioner-steps.ts",
      "lib/provisioner.ts",
      // F3.7 adds the ingest HMAC path: HUB_INGEST_SECRET flows through both.
      "lib/heartbeat-hmac.ts",
      "lib/ingest-gate.ts",
      // F3.8 adds the hot-add machine: SRV URIs and the Atlas SA flow through
      // the plan module, its ports, its step bodies, and the pump loop.
      "lib/hotadd-plan.ts",
      "lib/hotadd-ports.ts",
      "lib/hotadd-steps.ts",
      "lib/hotadd.ts",
      "lib/hotadd-status.ts",
    ],
    rules: {
      "no-console": "error",
    },
  },
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
