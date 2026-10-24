import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * Lint policy (Phase 0 baseline — see docs/adr/0001-lint-ratchet.md):
 *  - `error` rules are hard gates in CI.
 *  - `warn` rules are a ratchet: the count must never grow, and rules are
 *    promoted to `error` as they are paid down (target: v1.8, zero warnings).
 */
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "release/**", "test-results/**"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, chrome: "readonly" },
    },
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts"],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // TypeScript's compiler owns undefined-variable checking.
      "no-undef": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Hard gates.
      "no-restricted-syntax": [
        "warn",
        {
          selector: "TSNonNullExpression",
          message:
            "Non-null assertions are banned; use an explicit guard instead.",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/require-await": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],

      // Ratchet (warn today, promote to error as they are paid down).
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/restrict-plus-operands": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/prefer-promise-reject-errors": "warn",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn",
      "@typescript-eslint/no-confusing-void-expression": "warn",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/consistent-type-definitions": "off",

      // Off until Phase 1: the chrome.* typings are any-heavy and these rules
      // produce noise rather than signal on this codebase today.
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/only-throw-error": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/prefer-optional-chain": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  {
    files: ["tests/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // Layering: shared.ts is the leaf every context may import; UI/content
    // must not import the background bundle; the data layer must not import UI.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/background", "**/background.*", "./background"],
              message:
                "UI/content code must not import the background service worker; share code via shared.ts.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["./**", "../**"],
              message:
                "shared.ts is the protocol leaf; it must not import other project modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/db.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "./panel*",
                "./gallery*",
                "./options*",
                "./dock*",
                "./troubleshoot*",
              ],
              message: "The data layer must not import UI modules.",
            },
          ],
        },
      ],
    },
  },
);
