import tsParser from "@typescript-eslint/parser";

const testIgnores = [
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
  "src/test/**",
];

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/.otto/**",
      "**/.worktrees/**",
      "**/coverage/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
  },
  // File/function size + complexity guardrails (core libs)
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    ignores: testIgnores,
    rules: {
      "max-lines": [
        "error",
        { max: 1000, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
      complexity: ["error", { max: 20 }],
      "max-depth": ["error", { max: 4 }],
      "max-params": ["error", { max: 5 }],
    },
  },
  // File/function size + complexity guardrails (UI layer)
  {
    files: ["packages/ui-opentui/src/**/*.{ts,tsx}"],
    ignores: testIgnores,
    rules: {
      "max-lines": [
        "error",
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
      complexity: ["error", { max: 15 }],
      "max-depth": ["error", { max: 4 }],
      "max-params": ["error", { max: 5 }],
    },
  },
];
