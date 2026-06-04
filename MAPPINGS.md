# Capability to API Mappings

This document describes how Homey capabilities map to go-e API keys and behavior in this project.

Primary sources:

- [drivers/evcharger-device.js](drivers/evcharger-device.js)
- [lib/mappings.js](lib/mappings.js)
- [lib/go-eCharger-API-v2.js](lib/go-eCharger-API-v2.js)
- [lib/flows/actions.js](lib/flows/actions.js)
- [.homeycompose/drivers/templates/go-eCharger.json](.homeycompose/drivers/templates/go-eCharger.json)

## Runtime Flow

1. The device initializes API key filtering from active capabilities.
2. Polling fetches charger status every 5 seconds.
3. Status values are converted to capability values.
4. Capability writes are converted back to API key/value commands.
5. API command ordering prioritizes `ids`, `lmo`, `fup`, `psm`, `pgt`, `frm`, `spl3`, `fst`, `trx`, `frc`, `amp`.

## Capability Matrix

| Homey capability            | Direction    | API keys used        | Mapping behavior                                                    | Notes                                                             |
| --------------------------- | ------------ | -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| evcharger_charging          | Read + write | alw (read), trx, frc | Read: `alw` bool. Write true -> `trx=0` when null; false -> `frc=1` | `alw` is read-only in API; transaction enables anonymous charging |
| evcharger_charging_state    | Read         | car                  | car state mapped to enum values                                     | When `car === 5`, state becomes null and `alarm_problem` is true  |
| alarm_problem               | Read         | car                  | true when `car === 5`                                               | Fault indicator                                                   |
| meter_power                 | Read         | eto                  | Wh to kWh conversion with rounding                                  | Returns null if value is not positive                             |
| meter_power.session         | Read         | wh                   | Session Wh to kWh conversion with rounding                          | Capability options are defined in compose template                |
| measure_temperature         | Read         | tma                  | Averages non-zero temperatures from array                           | 0 when all values are zero or missing                             |
| measure_power               | Read         | nrg                  | Uses `nrg[11]` total power                                          | Rounded to 2 decimals                                             |
| measure_current             | Read         | nrg                  | Average of non-zero phase currents (`nrg[4..6]`)                    | 0 when no active phases                                           |
| measure_voltage             | Read         | nrg, pha             | Phase-aware input voltage calculation                               | 3-phase uses sqrt(3) scaling                                      |
| measure_voltage.output      | Read         | nrg, pha             | Phase-aware output voltage calculation                              | 0 if no output phases active                                      |
| goe_pv_surplus_enabled      | Read + write | fup                  | Read mirrors `fup`; write true sets automatic PV parameters         | Write true sets `lmo=4`; write false sets `lmo=3`, `fup=false`    |
| target_power_mode           | Read + write | fup                  | Read from `fup`; write `device` sets automatic PV parameters        | `device` sets `lmo=4`; `homey` sets `lmo=3`, `fup=false`          |
| goe_measure_phase_switching | Read         | psm                  | Enum capability for automatic / 1-phase / 3-phase status            | Capability ids are stringified `0`, `1`, `2`                      |
| goe_measure_modelStatus     | Read         | modelStatus          | Enum capability reflecting charger model status reason code         | Capability id is the stringified status code                      |
| measure_power.pakku         | Read         | pakku                | Reads charger PV optimization average battery power                 | Rounded to 2 decimals                                             |
| measure_power.pgrid         | Read         | pgrid                | Reads charger PV optimization average grid power                    | Rounded to 2 decimals                                             |
| measure_power.ppv           | Read         | ppv                  | Reads charger PV optimization average PV power                      | Rounded to 2 decimals                                             |

Additional mode/power mappings:

- `goe_pv_surplus_enabled`: uses `fup` for read/write; enabling applies `lmo=4`, `fup=true`, `psm=0`, `pgt=-200`, `frm=2`, `spl3=4140`; disabling applies `lmo=3`, `fup=false`.
- `target_power`: read-only status capability derived from `amp`, `pnp`, and `nrg` phase voltages.
  1-phase: uses the single active phase voltage.
  3-phase: uses combined phase voltage with `sqrt(3)` line-voltage conversion.
- `target_power_mode`: reads from `fup` (`true` => device/automatic, `false` => homey/manual).

## Control Behavior

- Listener handles control capabilities in one debounced batch:
  - `target_power_mode`
  - `evcharger_charging`
  - `goe_pv_surplus_enabled`
- If `goe_pv_surplus_enabled` is included in a batch, it is processed first and the listener returns immediately.
- If `target_power_mode` is set to `device`, app enables charger automatic mode via `lmo=4`, `fup=true`, enforces `psm=0`, sets `pgt=-200`, `frm=2`, and sets `spl3` threshold.
- If `target_power_mode` is set to `homey`, app returns charger basic mode via `lmo=3` and disables surplus control with `fup=false`.
- If the changed batch explicitly sets `target_power_mode=device`, the listener returns after applying mode changes and does not process `evcharger_charging` in that same batch.
- If charging is turned off, command flow sends force-off behavior (`frc=1`).
- If charging is turned on, command flow sends `frc=2`; if `trx` is null it also sets `trx=0` for anonymous charging.
- `target_power` is read-only and does not generate charger commands.
- Inverter/grid/battery telemetry can be sent via the `set_pv_surplus_info` flow action, which calls `onCapability_SET_PV_SURPLUS_INFO` and writes the `ids` payload.
- The `set_pv_surplus_enabled` flow action passes `enabled` through to `onCapability_SET_PV_SURPLUS_ENABLED`; device-side normalization accepts booleans and string booleans.
- After a UI toggle of `evcharger_charging`, one mismatching poll value is ignored to prevent temporary switch bounce.

## Dynamic Limits

- `target_power` max is still adjusted from `ama` (charger amp limit) for UI consistency.

## Polling and Availability

- Poll interval is 5000 ms.
- Poll failures set device unavailable with connection issue text.
- Recovery sets device available on next successful poll.
- Firmware version changes update settings and API key filtering.

## Maintenance Rules

This file must be updated whenever behavior changes in any of these files:

- [drivers/evcharger-device.js](drivers/evcharger-device.js)
- [lib/mappings.js](lib/mappings.js)
- [lib/go-eCharger-API-v2.js](lib/go-eCharger-API-v2.js)
- [.homeycompose/drivers/templates/go-eCharger.json](.homeycompose/drivers/templates/go-eCharger.json)

Update this file when:

- A capability is added, removed, or renamed.
- An API key mapping changes.
- Read or write conversion logic changes.
- Control semantics change for `trx`, `frc`, `amp`, or `psm`.
- Runtime constraints such as power limits or polling behavior change.

## Development Checklist

Before committing mapping-related changes:

1. Update this document.
2. Verify capability names match compose templates.
3. Verify API key dependencies match mapping code.
4. Run lint: `npm run lint`.
5. Keep commits small and focused.
