import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "lib/db/migrations/**"],
  },
  {
    // The demo fast-forward depends on a single clock. tests/no-raw-date.test.ts is
    // the hard gate; this rule is the fast feedback loop in the editor.
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["lib/clock/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name=\"Date\"][callee.property.name=\"now\"]",
          message: "Use clockNow() from lib/clock — the demo fast-forward depends on it.",
        },
        {
          selector: "NewExpression[callee.name=\"Date\"][arguments.length=0]",
          message: "Use clockNow() from lib/clock — the demo fast-forward depends on it.",
        },
      ],
    },
  },
];

export default eslintConfig;
