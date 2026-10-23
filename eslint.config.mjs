import js from "@eslint/js";
import { globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default tseslint.config([
  globalIgnores([
    ".next/**",
    "coverage/**",
    "dist/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
]);
