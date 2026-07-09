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

## PV / Grid energy split (the subtle part)

Lives in `onPoll()` in [drivers/evcharger-device.js](drivers/evcharger-device.js). This tracks how
much charging energy came from solar vs. grid and splits the meter counters accordingly.

### `pgrid` semantics
- `status.pgrid` is the **net household grid power**: `+` = importing from grid, `-` = exporting
  (the export is the PV surplus available for the charger to use).
- `pgrid` is the correct/authoritative signal. **`ppv` is optional on go-e chargers and is
  intentionally not used** — do not reintroduce it into the ratio.
- This app is the **sole writer** of `pgrid` (and the rest of `ids`), via
  `onCapability_SET_PV_SURPLUS_INFO` (the `set_pv_surplus_info` flow action). An external
  controller/HEMS is expected to push it every few seconds, tracking live consumption.

### The ratio
```
pvRatio = 1 − clamp(pGrid, 0, evPower) / evPower      // evPower = nrg[11]
```
- `0` = all grid, `1` = all solar. The `clamp` makes the imported watts exactly the non-solar part
  of the car's draw (solar is assumed to serve other household loads first), so
  PV power = `evPower − gridImport` and grid power = `gridImport`.
- The instantaneous value is smoothed into `stablePvRatio` — an **energy-weighted** average over a
  rolling 1-minute window (`PV_RATIO_WINDOW_MS`) — before being applied to energy deltas.
- `stablePvRatio` is also surfaced directly via the `goe_solargrid_ratio` sensor capability.

### Freshness gating (why PV attribution can be 0 even with a `pgrid` value)
- A stale `pgrid` reads as "no import ⇒ all solar", which silently mis-credits grid energy as PV
  (e.g. an overnight grid session still reporting the previous day's surplus).
- PV is therefore attributed **only when `pgrid` is fresh**: a push must have arrived within
  `PV_SURPLUS_STALE_MS` (tied to `PV_RATIO_WINDOW_MS` so both reason over the same minute). The push
  timestamp is `this.lastPvSurplusInfoTs`, stamped on each successful `onCapability_SET_PV_SURPLUS_INFO`.
- `ids` is pushed in **any** charger mode (skipped only when `plugged_out`); trust is decided by
  freshness, not by charger mode. Do not re-add a charger-mode gate to the ratio.
- `pgrid ≈ 0` is the **normal steady state of working surplus charging** (a good HEMS drives net
  grid to zero). Never treat `pgrid == 0` itself as "stale/no PV" — only elapsed time since the last
  push tells staleness apart from a genuinely balanced grid.

### Counter invariant
- `meter_power[.session|.N]_pv` / `_grid` split counters **only ever increase, or are reset by the
  `button.reset_subcounters` action** (PV → 0, grid → current master total). They are never
  auto-zeroed.
- In the split loop: skip the definition on a **missing/invalid source reading** (non-finite or
  `<= 0`, e.g. a partial status right after connect) and on a **flat/negative delta** (transient dip
  or a charger-side meter reset). Never zero the counters from a bad reading — the master baseline
  re-syncs on the next poll. (A genuine charger-side `eto` reset therefore leaves `pv+grid` above the
  master until the user presses the reset button; that is the intended trade-off.)
- Session counters are additionally reset to `0` on a `plugged_out → connected` transition.

### Homey SDK gotcha
- A `number` capability with `units: "%"` and a `0–1` value (e.g. `goe_solargrid_ratio`) is rendered
  as a percentage by Homey — store the raw `0–1` fraction, do **not** multiply by 100.
