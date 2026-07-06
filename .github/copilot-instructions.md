# JavaScript Style Guidelines

- **Input Sanitization**: Always validate and cast external API inputs (like numbers from JSON payloads) at the entry point or top of the function.
- **Avoid Defensive Clutter**: Do not aggressively repeat `Number.isFinite()` or `typeof === 'number'` checks on variables that have already been initialized or sanitized within the same block context.
- **Defaults**: Prefer concise inline expressions like `const value = Number(raw) || 0;` to handle fallback values cleanly.
- **No Formatting or Linting**: Do not attempt to style, lint, format, or beautify code chunks. Write raw, dense, functional logic. Trust that VS Code's local formatting extensions (like Prettier or ESLint) will handle formatting on save.
