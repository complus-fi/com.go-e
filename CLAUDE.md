# CLAUDE.md

Guidance for working in this repo. General rules live in
[.github/copilot-instructions.md](.github/copilot-instructions.md) — read it first; it is the
source of truth for project layout, style, Homey Compose, and Homey Cloud constraints. The notes
below are additional, hard-won domain knowledge that isn't obvious from the code alone.

## Non-negotiables (recap of the most-broken rules)

- Never edit `app.json` — it is generated. Edit `.homeycompose/**` or `drivers/*/*.compose.json`.
- Keep `MAPPINGS.md` synchronized whenever mapping/capability behavior in `lib/mappings.js`,
  `lib/go-eCharger-API-v2.js`, or `drivers/evcharger-device.js` changes.
- Charger polling is the source of truth for charger state. Don't cache local state as
  authoritative; let the next poll reconcile.
- Prefix custom capabilities with `goe_`. Handle every Promise (`.catch(this.error)`). Use
  `this.homey.setInterval/setTimeout`, never raw timers.
