# Capability to API Mappings

This document describes how Homey capabilities map to go-e API keys and runtime behavior in this project.

Primary sources:

- [drivers/evcharger-device.js](drivers/evcharger-device.js)
- [lib/mappings.js](lib/mappings.js)
- [lib/go-eCharger-API-v2.js](lib/go-eCharger-API-v2.js)
- [lib/flows/actions.js](lib/flows/actions.js)
- [.homeycompose/drivers/templates/go-eCharger.json](.homeycompose/drivers/templates/go-eCharger.json)
- [.homeycompose/drivers/templates/go-eCharger-local.json](.homeycompose/drivers/templates/go-eCharger-local.json)
- [.homeycompose/drivers/templates/go-eCharger-cloud.json](.homeycompose/drivers/templates/go-eCharger-cloud.json)

## Runtime Flow

1. On init, status filter keys are built from active capabilities via `getStatusAttributes()`.
2. Polling fetches charger status with a filtered `status?filter=...` request.
3. Status values are converted to Homey capability values via `mapStatusToCapabilities()` plus device-level enrichments.
4. Changed Homey control values are converted back to API writes via `mapHomeyToApiValues()` and `applyApiValues()`.
5. API command ordering prioritizes: `ids`, `lmo`, `fup`, `psm`, `pgt`, `frm`, `spl3`, `trx`, `frc`, `amp`.

## Capability Matrix

| Homey capability                                      | Direction    | API keys used                           | Mapping behavior                                                                                                                 | Notes                                                                           |
| ----------------------------------------------------- | ------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `evcharger_charging`                                  | Read + write | `alw` (read), `frc`, `trx` (write path) | Read from `Boolean(alw)`. Write false -> `frc=1`; write true -> `frc=2` and if `trx` is missing in last status then also `trx=0` | Listener may override `frc` to `0` for Eco/Trip modes                           |
| `evcharger_charging_state`                            | Read         | `car`                                   | `car`: `1->plugged_out`, `2->plugged_in_charging`, `3->plugged_in_paused`, `4->plugged_in`; `5` maps to `null`                   | `car===5` also sets `alarm_problem=true`                                        |
| `alarm_problem`                                       | Read         | `car`                                   | `true` when `car===5`                                                                                                            | Fault indicator                                                                 |
| `meter_power`                                         | Read         | `eto`                                   | `eto` Wh -> kWh, only if positive else `null`                                                                                    | Source counter for total split counters                                         |
| `meter_power.pv` / `meter_power.grid`                 | Local read   | `eto`, `nrg`, `pgrid`                   | Split from `meter_power` deltas using rolling PV ratio                                                                           | Stateful counters in capabilities                                               |
| `meter_power.session`                                 | Read         | `wh`                                    | `wh` Wh -> kWh                                                                                                                   | Session source counter                                                          |
| `meter_power.session_pv` / `meter_power.session_grid` | Local read   | `wh`, `nrg`, `pgrid`                    | Split from session deltas using same rolling PV ratio                                                                            | Session reset handling differs from total                                       |
| `goe_solargrid_ratio`                                 | Local read   | `nrg`, `pgrid`                          | Rolling PV ratio (`0` = all grid, `1` = all solar), same window as split counters                                                | `0` when no PV data (`pgrid` absent) or not charging                            |
| `measure_temperature`                                 | Read         | `tma`                                   | Average of non-zero `tma[]` values                                                                                               | Returns `0` if all zero/missing                                                 |
| `measure_power`                                       | Read         | `nrg`                                   | Uses `nrg[11]`                                                                                                                   | Defaults to `0` if invalid                                                      |
| `measure_current`                                     | Read         | `nrg`                                   | Average of non-zero `nrg[4..6]` phase currents                                                                                   | Returns `0` when no active phases                                               |
| `measure_voltage`                                     | Read         | `nrg`, `pha`                            | Phase-aware input voltage calculation                                                                                            | 3-phase uses `sqrt(3)` scaling                                                  |
| `measure_voltage.output`                              | Read         | `nrg`, `pha`                            | Phase-aware output voltage calculation                                                                                           | Returns `0` when no output phases                                               |
| `measure_power.max`                                   | Local read   | none                                    | Tracks session max of `measure_power` while connected                                                                            | Reset to `0` when previous state is `plugged_out`                               |
| `target_power`                                        | Read + write | `amp`, `psm`                            | Read: `psm===1 ? amp*230 : amp*690`. Write: `<0` rejected, `0` -> no write, `>0` -> `{psm, amp}`                                 | `amp` is floored and clamped `6..maxAmps` (`maxAmps` defaults to `16` if unset) |
| `goe_charger_mode`                                    | Read + write | `lmo`, `fup`, `awe` (+ write extras)    | Maps mode combinations to enum and back                                                                                          | Write adds `psm`; PV-surplus modes also add `pgt=-200`, `frm=2`, `spl3=4140`    |
| `goe_transaction`                                     | Read + write | `trx`, dynamic `c0i..c9i`, `c0n..c9n`   | Read maps `trx` to dynamic enum value IDs. Write accepts `anonymous` or configured card IDs and writes numeric `trx`             | `no_auth` is read-only                                                          |
| `goe_transaction_name`                                | Local read   | dynamic `trx` + card name keys          | Resolved from current transaction/card slot                                                                                      | Kept stable while connected; refreshed on connect                               |
| `goe_transaction_start`                               | Local read   | none                                    | Local timestamp (`YYYY-MM-DD HH:mm:ss`) when transaction becomes active                                                          | Uses Homey timezone when available                                              |
| `goe_transaction_end`                                 | Local read   | none                                    | Local timestamp for latest polled active transaction state                                                                       | Updated each poll while transaction active                                      |
| `goe_transaction_duration`                            | Local read   | none                                    | Local `HH:mm:ss` duration from start to latest end time                                                                          | Updated each poll while transaction active                                      |
| `goe_flexible_rate`                                   | Read         | `awcp`                                  | Uses `awcp.marketprice` (or `awcp` numeric fallback) and converts cents to euros                                                 | Read-only market price                                                          |
| `goe_flexible_rate_limit`                             | Read + write | `awp`                                   | Cents <-> euros conversion                                                                                                       | Write rejects negative/non-numeric values                                       |
| `goe_measure_phase_switching`                         | Read         | `psm`                                   | Maps integer `0..2` to string enum IDs                                                                                           | Invalid values ignored                                                          |
| `goe_measure_modelStatus`                             | Read         | `modelStatus`                           | Maps integer `0..41` to string enum IDs                                                                                          | Invalid values ignored                                                          |
| `measure_power.pakku`                                 | Read         | `pakku`                                 | Numeric passthrough, default `0`                                                                                                 | PV optimization telemetry                                                       |
| `measure_power.pgrid`                                 | Read         | `pgrid`                                 | Numeric passthrough, default `0`                                                                                                 | PV optimization telemetry                                                       |
| `measure_power.ppv`                                   | Read         | `ppv`                                   | Numeric passthrough, default `0`                                                                                                 | PV optimization telemetry                                                       |
| `button.reset_subcounters`                            | Write action | none                                    | Maintenance action resets split counters: PV -> `0`, Grid -> master counter                                                      | Applies to total and configured card counters                                   |

## Dynamic RFID Card Capabilities

- Card capabilities are reconciled from `c0i..c9i` on each poll.
- For each configured card `N`, these capabilities are added:
  - `meter_power.N`
  - `meter_power.N_pv`
  - `meter_power.N_grid`
  - `goe_meter_power_name.N`
- When a card is no longer configured, the same capabilities are removed.
- Card energy values map from `c0e..c9e` (Wh -> kWh).
- Card name values map from `c0n..c9n` with fallback naming (`Card N`).
- `goe_transaction` enum options are dynamic: base values (`no_auth`, `anonymous`) plus configured card IDs.

## Charger Mode Mapping

Mode to API values:

- `basic_charging` -> `lmo=3`, `fup=false`, `awe=false`, plus `psm` derived from `target_power` (`<4140 -> 1`, `>=4140 -> 2`, no target -> `0`)
- `eco_pv_surplus` -> `lmo=4`, `fup=true`, `awe=false`, `psm=0`, `pgt=-200`, `frm=2`, `spl3=4140`
- `eco_flexible_price` -> `lmo=4`, `fup=false`, `awe=true`, `psm=0`
- `eco_pv_and_flexible_price` -> `lmo=4`, `fup=true`, `awe=true`, `psm=0`, `pgt=-200`, `frm=2`, `spl3=4140`
- `trip_pv_surplus` -> `lmo=5`, `fup=true`, `awe=false`, `psm=0`, `pgt=-200`, `frm=2`, `spl3=4140`
- `trip_flexible_price` -> `lmo=5`, `fup=false`, `awe=true`, `psm=0`
- `trip_pv_and_flexible_price` -> `lmo=5`, `fup=true`, `awe=true`, `psm=0`, `pgt=-200`, `frm=2`, `spl3=4140`
- `trip_no_pv_no_flexible_price` -> `lmo=5`, `fup=false`, `awe=false`, `psm=0`

## Control Behavior

- Debounced multi-capability listener handles:
  - `evcharger_charging`
  - `goe_charger_mode`
  - `goe_transaction`
  - `target_power`
  - `goe_flexible_rate_limit`
  - `button.reset_subcounters`
- Processing order in listener:
  1. `goe_charger_mode`
  2. `goe_transaction`
  3. `target_power`
  4. `goe_flexible_rate_limit`
  5. `evcharger_charging`
- `evcharger_charging=true` sets `frc=0` for Eco/Trip modes and `frc=2` for `basic_charging`.
- `evcharger_charging=false` sets `frc=1`.
- `set_pv_surplus_info` flow action writes `ids` in any charger mode (skipped only when charging state is `plugged_out`) and stamps the push time used for PV-ratio freshness.
- `set_charger_mode`, `set_transaction`, and `set_flexible_rate_limit` flow actions map to their corresponding device handlers.
- `is_charger_mode` flow condition compares current `goe_charger_mode` enum value.

## Polling, Availability, and Status Filtering

- Poll interval is dynamic:
  - `5000 ms` while charging (`car===2` or capability state `plugged_in_charging`)
  - `30000 ms` otherwise
- Poll errors set device unavailable with `Connection issue: ...`; next successful poll restores availability.
- Firmware changes (`fwv`) update settings and rebuild status filter keys.
- Status filter key generation:
  - Always includes `frc`, `ama`, `fwv`
  - Adds keys required by active capabilities
  - Adds transaction/card key groups depending on card configuration awareness
- API client prunes unsupported filter keys if payload indicates missing keys (including partial HTTP 400 payload behavior).

## PV/Grid Split Logic

- PV share ratio uses only:
  - EV power `nrg[11]`
  - Grid power `pgrid` (`+` import, `-` export)
- PV is attributed only while `pgrid` is fresh: a `set_pv_surplus_info` push must have arrived within `PV_SURPLUS_STALE_MS`, which is aligned with the 1-minute PV-ratio window (`PV_RATIO_WINDOW_MS`). The controller is expected to push every few seconds (tracking live household consumption); if the feed stops, `pgrid` is considered stale and the ratio is `0` (all grid), regardless of charger mode.
- Instant ratio is stabilized using a rolling `1-minute` sample window (`PV_RATIO_WINDOW_MS = 60000`).
- The stabilized ratio is both used to split the meter counters and surfaced directly via the `goe_solargrid_ratio` sensor capability (`0` = all grid, `1` = all solar).
- Samples are added only during continuous active charging (`plugged_in_charging` with positive power and a previous charging poll).
- Split counters are incremented from source delta energy, not absolute ratios.
- Split counters only ever increase or are reset by `button.reset_subcounters`; they are never auto-zeroed.
- Invalid/missing source readings (non-finite or `<= 0`, e.g. a partial status right after connect) are skipped so counters are left untouched.
- Flat or negative source deltas (transient dip or a charger-side meter reset) are skipped; the master baseline re-syncs on the next poll instead of wiping the counters.
- Session counters are additionally reset to `0` when `evcharger_charging_state` changes from `plugged_out` to any connected state.
- `button.reset_subcounters` sets PV split counters to `0` and Grid split counters to current source totals.

## Maintenance Rules

This file must be updated whenever behavior changes in any of these files:

- [drivers/evcharger-device.js](drivers/evcharger-device.js)
- [lib/mappings.js](lib/mappings.js)
- [lib/go-eCharger-API-v2.js](lib/go-eCharger-API-v2.js)
- [lib/flows/actions.js](lib/flows/actions.js)
- [.homeycompose/drivers/templates/go-eCharger.json](.homeycompose/drivers/templates/go-eCharger.json)
- [.homeycompose/drivers/templates/go-eCharger-local.json](.homeycompose/drivers/templates/go-eCharger-local.json)
- [.homeycompose/drivers/templates/go-eCharger-cloud.json](.homeycompose/drivers/templates/go-eCharger-cloud.json)

Update this file when:

- A capability is added, removed, or renamed.
- An API key mapping changes.
- Read/write conversion logic changes.
- Dynamic RFID card capability behavior changes.
- Control semantics change for `trx`, `frc`, `amp`, `psm`, `ids`, `awp`, or mode writes.
- Polling behavior, filter behavior, or availability handling changes.

## Development Checklist

Before committing mapping-related changes:

1. Update this document.
2. Verify capability names match compose templates and dynamic runtime additions.
3. Verify API key dependencies match mapping and listener code paths.
4. Keep commits small and focused.
