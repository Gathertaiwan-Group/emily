import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The storefront reproduces a WordPress theme: links are plain <a> (full page loads so the
    // theme behaviours re-initialise like on the old site), stylesheets are the theme's own CSS
    // files, and DB rows are loosely typed JSON.
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-css-tags": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
