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
5. API command ordering prioritizes `ids`, `lmo`, `fup`, `psm`, `pgt`, `frm`, `spl3`, `fst`, `trx`, `frc`, `fsp`, `amp`.

## Capability Matrix

| Homey capability            | Direction    | API keys used        | Mapping behavior                                                    | Notes                                                                                                |
| --------------------------- | ------------ | -------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| evcharger_charging          | Read + write | alw (read), trx, frc | Read: `alw` bool. Write true -> `trx=0` when null; false -> `frc=1` | `alw` is read-only in API; transaction enables anonymous charging                                    |
| evcharger_charging_state    | Read         | car                  | car state mapped to enum values                                     | When `car === 5`, state becomes null and `alarm_problem` is true                                     |
| alarm_problem               | Read         | car                  | true when `car === 5`                                               | Fault indicator                                                                                      |
| meter_power                 | Read         | eto                  | Wh to kWh conversion with rounding                                  | Returns null if value is not positive                                                                |
| meter_power.session         | Read         | wh                   | Session Wh to kWh conversion with rounding                          | Capability options are defined in compose template                                                   |
| measure_temperature         | Read         | tma                  | Averages non-zero temperatures from array                           | 0 when all values are zero or missing                                                                |
| measure_power               | Read         | nrg                  | Uses `nrg[11]` total power                                          | Rounded to 2 decimals                                                                                |
| measure_current             | Read         | nrg                  | Average of non-zero phase currents (`nrg[4..6]`)                    | 0 when no active phases                                                                              |
| measure_voltage             | Read         | nrg, pha             | Phase-aware input voltage calculation                               | 3-phase uses sqrt(3) scaling                                                                         |
| measure_voltage.output      | Read         | nrg, pha             | Phase-aware output voltage calculation                              | 0 if no output phases active                                                                         |
| goe_charger_mode            | Read + write | lmo, fup, awe        | Maps go-e charger mode combinations to enum values                  | Primary charger mode capability                                                                      |
| goe_pv_surplus_enabled      | Read + write | fup                  | Read mirrors `fup`; write true sets automatic PV parameters         | Write true sets `lmo=4`, `fup=true`, `awe=false`; write false sets `lmo=3`, `fup=false`, `awe=false` |
| goe_transaction             | Read + write | trx, c0n..c9i        | Read maps `trx` to `card_none`/`card_0..10`; names use RFID keys    | Writing `card_none` follows legacy behavior and falls back to anonymous transaction `trx=0`          |
| goe_measure_phase_switching | Read         | psm                  | Enum capability for automatic / 1-phase / 3-phase status            | Capability ids are stringified `0`, `1`, `2`                                                         |
| goe_measure_modelStatus     | Read         | modelStatus          | Enum capability reflecting charger model status reason code         | Capability id is the stringified status code                                                         |
| measure_power.pakku         | Read         | pakku                | Reads charger PV optimization average battery power                 | Rounded to 2 decimals                                                                                |
| measure_power.pgrid         | Read         | pgrid                | Reads charger PV optimization average grid power                    | Rounded to 2 decimals                                                                                |
| measure_power.ppv           | Read         | ppv                  | Reads charger PV optimization average PV power                      | Rounded to 2 decimals                                                                                |

Additional mode/power mappings:

- `target_power`: read/write mapping with API keys `amp` and `fsp`.
  - Read derives watts from charger config: single-phase (`fsp=true`) => `amp*230`, three-phase (`fsp=false`) => `amp*690`.
  - Write is unidirectional only: values `<0` are rejected, `0` sends no API write, and positive values map to integer `amp` + `fsp` using a `4140W` phase switch threshold.
- `goe_charger_mode`: read/write enum with these combinations:
  - `basic_charging` => `lmo=3`, `fup=false`, `awe=false`
  - `eco_pv_surplus` => `lmo=4`, `fup=true`, `awe=false`
  - `eco_flexible_price` => `lmo=4`, `fup=false`, `awe=true`
  - `eco_pv_and_flexible_price` => `lmo=4`, `fup=true`, `awe=true`
  - `trip_pv_surplus` => `lmo=5`, `fup=true`, `awe=false`
  - `trip_flexible_price` => `lmo=5`, `fup=false`, `awe=true`
  - `trip_pv_and_flexible_price` => `lmo=5`, `fup=true`, `awe=true`
  - `trip_no_pv_no_flexible_price` => `lmo=5`, `fup=false`, `awe=false`
- `goe_pv_surplus_enabled`: uses `fup` for read/write; enabling applies `lmo=4`, `fup=true`, `awe=false`, `psm=0`, `pgt=-200`, `frm=2`, `spl3=4140`; disabling applies `lmo=3`, `fup=false`, `awe=false`.
- `meter_power.1..10` and `goe_meter_power_name.1..10`: dynamic per-card capabilities controlled by `c0i..c9i` (configured=true adds capabilities, configured=false removes capabilities).
- Dynamic per-card energy/name values map from `c0e..c9e` and `c0n..c9n` respectively.

## Control Behavior

- Listener handles control capabilities in one debounced batch:
  - `target_power`
  - `evcharger_charging`
  - `goe_charger_mode`
  - `goe_pv_surplus_enabled`
  - `goe_transaction`
- If `goe_charger_mode` is included in a batch, it is processed first.
- If `goe_pv_surplus_enabled` is included in a batch, it is processed next and the listener returns immediately.
- If `goe_transaction` is included, it writes `trx` directly and allows any charging command in the same batch to continue.
- If `target_power` is included and `goe_charger_mode` is `basic_charging`, writes use `amp` and `fsp` with integer amps and a 4140W single/three-phase switch threshold.
- If `target_power` is included and `goe_charger_mode` is not `basic_charging`, Homey still accepts and stores the setpoint, but no `amp`/`fsp` write is sent to charger.
- Polling only syncs `target_power` from `amp`/`fsp` while in `basic_charging`; in other modes the stored setpoint is preserved.
- If charging is turned off, command flow sends force-off behavior (`frc=1`).
- If charging is turned on and `goe_charger_mode` is any Eco/Trip mode, command flow sends `frc=0` (automatic).
- If charging is turned on and `goe_charger_mode` is `basic_charging`, command flow sends `frc=2` (homey).
- Inverter/grid/battery telemetry can be sent via the `set_pv_surplus_info` flow action, which calls `onCapability_SET_PV_SURPLUS_INFO` and writes the `ids` payload only when `goe_pv_surplus_enabled` is true.
- The `set_charger_mode` flow action writes `goe_charger_mode`; `is_charger_mode` checks the current enum value.
- The `set_transaction` flow action writes `goe_transaction`; device-side validation accepts `card_none` and `card_0..10`, with `card_none` mapped to anonymous transaction `trx=0`.
- `goe_transaction` requests the 60.0 RFID card key groups `c0n..c9n`, `c0e..c9e`, and `c0i..c9i` so transaction card names can be derived from charger status.
- `goe_transaction_name` and `goe_meter_power_name` both derive the active RFID card name from the 60.0 RFID key groups.
- The `goe_charger_mode_changed` trigger uses Homey's custom capability changed trigger for enum capabilities and exposes the current mode token.
- The `goe_transaction_changed` trigger fires on polled charger-state changes and exposes the current card name token, with the raw transaction label still available as an extra token.
- After a UI toggle of `evcharger_charging`, one mismatching poll value is ignored to prevent temporary switch bounce.

## Polling and Availability

- Poll interval is 5000 ms.
- `target_power` capability max is updated from charger `ama` via `setCapabilityOptions()`:
  - `ama=16` => `max=11000`
  - `ama=32` => `max=22000`
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
- Control semantics change for `trx`, `frc`, `fsp`, `amp`, or `psm`.
- Runtime constraints such as power limits or polling behavior change.

## Development Checklist

Before committing mapping-related changes:

1. Update this document.
2. Verify capability names match compose templates.
3. Verify API key dependencies match mapping code.
4. Keep commits small and focused.
