import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "max-lines": [
        "warn",
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: { "max-lines": "off" },
  },
);
