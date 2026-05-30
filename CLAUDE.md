# com.go-e Claude Instructions

## Project Overview

- Homey app for go-e chargers (Home+, Gemini, CORE, PRO, and Local) using the V2 API.
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
- Prefer reusable Homey Compose templates when multiple drivers share config.
- Test and commit often so changes remain small.
- Keep `MAPPINGS.md` synchronized with mapping behavior in `lib/mappings.js`, `lib/go-eCharger-API-v2.js`, and capability usage in `drivers/evcharger-device.js` whenever related code changes.

## Validation

- Run lint after JavaScript changes:
  - `npm run lint`
- Validate changed JSON/compose files are syntactically correct.

## Driver Notes

- Shared pairing/device logic is in `drivers/evcharger-driver.js` and `drivers/evcharger-device.js`.
- Driver-specific manifests and settings are in each driver folder under `drivers/`.
