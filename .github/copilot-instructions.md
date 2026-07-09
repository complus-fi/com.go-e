# General rules

> See also [CLAUDE.md](../CLAUDE.md) for hard-won domain knowledge (notably the PV/grid energy split and its invariants).

## Project Overview

- Homey app for go-e chargers (Home+, Gemini, CORE, PRO) using the V2 API.
- Support both local network connections wIth mDNS discovery and Cloud API devices.
- API V2 is used for both types, only base url changes and a Bearer token is needed with Cloud API
- Main runtime files are in `drivers/` and `lib/`.

## Repository Rules

- Never edit `app.json` directly; it is generated.
- Edit Homey Compose source files instead:
  - `.homeycompose/**`
  - `drivers/*/*.compose.json`

## Development Conventions

- Keep changes minimal and focused on the requested task.
- Preserve existing coding style and naming patterns.
- Avoid unrelated refactors.
- JSDoc every function and method.

# JavaScript Style Guidelines

- **Input Sanitization**: Always validate and cast external API inputs (like numbers from JSON payloads) at the entry point or top of the function.
- **Avoid Defensive Clutter**: Do not aggressively repeat `Number.isFinite()` or `typeof === 'number'` checks on variables that have already been initialized or sanitized within the same block context.
- **Avoid Single Use Helper**: Do not create unnecessary helper functions when they will only be used one time. Simpler inline logic is preferred for single-use cases. Complex logic should be extracted into a helper function only if it is reused or if it improves readability.
- **Defaults**: Prefer concise inline expressions like `const value = Number(raw) || 0;` to handle fallback values cleanly.
- **No Formatting or Linting**: Do not attempt to style, lint, format, or beautify code chunks. Write raw, dense, functional logic. Trust that VS Code's local formatting extensions (like Prettier or ESLint) will handle formatting on save.

# Driver Notes

- Prefer reusable Homey Compose templates when multiple drivers share config.
- Shared pairing/device logic is in `drivers/evcharger-driver.js` and `drivers/evcharger-device.js`.
- Keep `MAPPINGS.md` synchronized with mapping behavior in `lib/mappings.js`, `lib/go-eCharger-API-v2.js`, and capability usage in `drivers/evcharger-device.js` whenever related code changes.
- Driver-specific manifests and settings are in each driver folder under `drivers/`.
- Prefix all custom capabilities with `goe_`.
- Treat charger polling as the source of truth for charger state; if the go-e mobile app or another controller changes settings, let the next poll update Homey capabilities instead of caching local state as authoritative.

# Homey Cloud Rules

- **Target Platforms via Compose Sources**: When adding or changing Cloud support, set `platforms` in compose sources (such as `.homeycompose/**`, `drivers/*/driver.compose.json`, and flow compose files). Do not edit generated `app.json` directly.
- **SDK Requirement**: Keep the app on Homey SDK v3 for Homey Cloud compatibility.
- **Multi-Tenancy Safety**: Do not use mutable module/global state for runtime instance data. Store state on `this` (`App`, `Driver`, `Device`) so instances do not leak data across tenants.
- **Lifecycle Cleanup Required**: Release resources in `onUninit()` (`App#onUninit()`, `Driver#onUninit()`, `Device#onUninit()`) to avoid leaks when instances are destroyed.
- **Use Homey Timers**: Never use raw `setInterval()` or `setTimeout()` in app runtime code; use `this.homey.setInterval()` and `this.homey.setTimeout()` so timers are auto-cleared on teardown.
- **No Unhandled Promises**: Homey Cloud treats unhandled rejections as crash-worthy. Always handle Promise-returning calls (for ignored results use `.catch(this.error)`).
- **Unsupported on Homey Cloud**: Do not implement or depend on App Web API, app-to-app communication permissions (`homey:app:<appId>`), `homey:manager:api`/`ManagerApi`, custom app settings views, or local LAN discovery assumptions (mDNS/SSDP/MAC, `ManagerCloud#getLocalAddress()`).
- **Path Portability**: Use relative paths and `__dirname`-based joins (for example `require('./assets/foo')`, `path.join(__dirname, '...')`). Do not assume `/` points to the app directory.
- **Cloud Driver Connectivity Metadata**: For Cloud-capable drivers, ensure `connectivity` metadata is accurate in `driver.compose.json` and avoid unsupported network assumptions for Homey Bridge.
