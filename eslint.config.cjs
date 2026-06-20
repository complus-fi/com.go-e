const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: ["node_modules/**", ".git/**", ".homeybuild/**", "tmp/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      "no-console": "off",
      "no-redeclare": ["error", { builtinGlobals: false }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_|^state$" }],
      "preserve-caught-error": "off",
    },
  },
];
