import next from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  {
    ignores: [".next/**", ".vercel/**", "next-env.d.ts"],
  },
  ...next,
  ...nextTypescript,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // `catch (e: any)` is the house idiom for Supabase/auth errors, and the
      // call sites already access it defensively (`e?.code`, `err?.message`).
      // Warn so new `any`s stay visible without failing the lint run.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default config;
