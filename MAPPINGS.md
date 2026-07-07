# Capability to API Mappings

This document describes how Homey capabilities map to go-e API keys and behavior in this project.

Primary sources:

- [drivers/evcharger-device.js](drivers/evcharger-device.js)
- [lib/mappings.js](lib/mappings.js)
- [lib/go-eCharger-API-v2.js](lib/go-eCharger-API-v2.js)
- [lib/flows/actions.js](lib/flows/actions.js)
- [.homeycompose/drivers/templates/go-eCharger.json](.homeycompose/drivers/templates/go-eCharger.json)
- [.homeycompose/drivers/templates/go-eCharger-local.json](.homeycompose/drivers/templates/go-eCharger-local.json)
- [.homeycompose/drivers/templates/go-eCharger-cloud.json](.homeycompose/drivers/templates/go-eCharger-cloud.json)

## Runtime Flow

1. The device initializes API key filtering from active capabilities.
2. Polling fetches charger status every 5 seconds.
3. Status values are converted to capability values.
4. Capability writes are converted back to API key/value commands.
5. API command ordering prioritizes `ids`, `lmo`, `fup`, `psm`, `pgt`, `frm`, `spl3`, `trx`, `frc`, `amp`.

## Capability Matrix

| Homey capability            | Direction    | API keys used        | Mapping behavior                                                                                               | Notes                                                                                |
| --------------------------- | ------------ | -------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| evcharger_charging          | Read + write | alw (read), trx, frc | Read: `alw` bool. Write true -> `trx=0` when null; false -> `frc=1`                                            | `alw` is read-only in API; transaction enables anonymous charging                    |
| evcharger_charging_state    | Read         | car                  | car state mapped to enum values                                                                                | When `car === 5`, state becomes null and `alarm_problem` is true                     |
| alarm_problem               | Read         | car                  | true when `car === 5`                                                                                          | Fault indicator                                                                      |
| meter_power                 | Read         | eto                  | Wh to kWh conversion                                                                                           | Returns null if value is not positive                                                |
| meter_power.pv              | Local read   | eto, nrg, pgrid, ppv | Splits `meter_power` delta into PV share using per-poll ratio                                                  | Uses persisted split state; no extra API read                                        |
| meter_power.grid            | Local read   | eto, nrg, pgrid, ppv | Splits `meter_power` delta into grid share using per-poll ratio                                                | Uses persisted split state; no extra API read                                        |
| meter_power.session         | Read         | wh                   | Session Wh to kWh conversion                                                                                   | Capability options are defined in compose template                                   |
| meter_power.session_pv      | Local read   | wh, nrg, pgrid, ppv  | Splits `meter_power.session` delta into PV share using per-poll ratio                                          | Resets on charger session counter reset                                              |
| meter_power.session_grid    | Local read   | wh, nrg, pgrid, ppv  | Splits `meter_power.session` delta into grid share using per-poll ratio                                        | Resets on charger session counter reset                                              |
| meter_power.prev_session    | Local read   | n/a                  | Snapshots meter_power.session on unplug transition                                                             | Persists previous session energy across new sessions until next unplug event         |
| measure_temperature         | Read         | tma                  | Averages non-zero temperatures from array                                                                      | 0 when all values are zero or missing                                                |
| measure_power               | Read         | nrg                  | Uses `nrg[11]` total power                                                                                     | No explicit rounding in mapping                                                      |
| measure_current             | Read         | nrg                  | Average of non-zero phase currents (`nrg[4..6]`)                                                               | 0 when no active phases                                                              |
| measure_voltage             | Read         | nrg, pha             | Phase-aware input voltage calculation                                                                          | 3-phase uses sqrt(3) scaling                                                         |
| measure_voltage.output      | Read         | nrg, pha             | Phase-aware output voltage calculation                                                                         | 0 if no output phases active                                                         |
| measure_power.max           | Local read   | n/a                  | Tracks highest measure_power value during active session                                                       | Reset to 0 when charging state becomes unplugged                                     |
| measure_power.prev_max      | Local read   | n/a                  | Captures final measure_power.max on unplug transition                                                          | Persists previous session max power until next unplug transition                     |
| goe_charger_mode            | Read + write | lmo, fup, awe        | Maps go-e charger mode combinations to enum values                                                             | Primary charger mode capability                                                      |
| goe_transaction             | Read + write | trx, c0n..c9i        | Enum values are dynamic: always `no_auth` + `anonymous`, plus configured card names from `cXn` when `cXi=true` | Writing supports `anonymous` and configured dynamic card IDs; `no_auth` is read-only |
| goe_measure_phase_switching | Read         | psm                  | Enum capability for automatic / 1-phase / 3-phase status                                                       | Capability ids are stringified `0`, `1`, `2`                                         |
| goe_measure_modelStatus     | Read         | modelStatus          | Enum capability reflecting charger model status reason code                                                    | Capability id is the stringified status code                                         |
| goe_flexible_rate           | Read         | awcp                 | Reads `awcp.marketprice` (cents) and converts to euros                                                         | No explicit rounding in mapping; capability precision handles display                |
| goe_flexible_rate_limit     | Read + write | awp                  | Reads/writes max flexible price by converting between API cents and capability euros                           | No explicit rounding in mapping; API-side changes are synced back on poll            |
| measure_power.pakku         | Read         | pakku                | Reads charger PV optimization average battery power                                                            | No explicit rounding in mapping                                                      |
| measure_power.pgrid         | Read         | pgrid                | Reads charger PV optimization average grid power                                                               | No explicit rounding in mapping                                                      |
| measure_power.ppv           | Read         | ppv                  | Reads charger PV optimization average PV power                                                                 | No explicit rounding in mapping                                                      |

Additional mode/power mappings:

- `target_power`: read/write mapping with API keys `amp` and `psm`.
  - Read derives watts from charger config: single-phase (`psm=1`) => `amp*230`, three-phase (`psm=2`) => `amp*690`.
  - Write is unidirectional only: values `<0` are rejected, `0` sends no API write, and positive values map to integer `amp` + `psm` using a `4140W` phase switch threshold.
- `goe_charger_mode`: read/write enum with these combinations:
  - `basic_charging` => `lmo=3`, `fup=false`, `awe=false`
  - `eco_pv_surplus` => `lmo=4`, `fup=true`, `awe=false`
  - `eco_flexible_price` => `lmo=4`, `fup=false`, `awe=true`
  - `eco_pv_and_flexible_price` => `lmo=4`, `fup=true`, `awe=true`
  - `trip_pv_surplus` => `lmo=5`, `fup=true`, `awe=false`
  - `trip_flexible_price` => `lmo=5`, `fup=false`, `awe=true`
  - `trip_pv_and_flexible_price` => `lmo=5`, `fup=true`, `awe=true`
  - `trip_no_pv_no_flexible_price` => `lmo=5`, `fup=false`, `awe=false`
- `goe_transaction_name.prev_session`: local read-only value; snapshots `goe_transaction_name` when charging state transitions to unplugged and keeps that value until the next unplug transition.
- `meter_power.1..10` and `goe_meter_power_name.1..10`: dynamic per-card capabilities controlled by `c0i..c9i` (configured=true adds capabilities, configured=false removes capabilities).
- For configured cards, capability reconciliation also ensures `meter_power.N_pv` and `meter_power.N_grid` exist when `meter_power.N` exists (and removes them when card is not configured).
- Dynamic per-card energy/name values map from `c0e..c9e` and `c0n..c9n` respectively.
- `meter_power.1_pv..10_pv` and `meter_power.1_grid..10_grid`: local split counters derived from each card's `cXe` delta and the same per-poll PV ratio used for total/session split counters.
- Split counters (`meter_power.pv/grid`, `meter_power.session_pv/grid`, `meter_power.N_pv/grid`) are stateful and persisted via device store; if a source counter decreases (charger reset), its split counters reset to `0` for that counter scope.
- For non-session split counters only (`meter_power.pv/grid` and `meter_power.N_pv/grid`):
  - On first creation (both split counters null/zero), initialization sets `pv=0` and `grid=master`.
  - If master energy is above `50` and `pv+grid` is less than half of master, split counters are reinitialized to `pv=0` and `grid=master`.
  - Session split counters (`meter_power.session_pv/grid`) are excluded from this bootstrap/reinitialization logic.
- Elapsed-time PV ratio accumulation is only computed across consecutive active charging polls (`plugged_in_charging` with positive charger power) and uses a rolling 3-minute sample window to estimate current PV/grid share.

## Control Behavior

- Listener handles control capabilities in one debounced batch:
  - `target_power`
  - `evcharger_charging`
  - `goe_charger_mode`
  - `goe_transaction`
  - `goe_flexible_rate_limit`
- If `goe_charger_mode` is included in a batch, it is processed first.
- If `goe_transaction` is included, it writes `trx` directly and allows any charging command in the same batch to continue.
- If `goe_flexible_rate_limit` is included, it writes `awp` after converting capability euros to API cents.
- If `target_power` is included and `goe_charger_mode` is `basic_charging`, writes use `amp` and `psm` with integer amps and a 4140W single/three-phase switch threshold.
- If `target_power` is included and `goe_charger_mode` is not `basic_charging`, Homey still accepts and stores the setpoint, but no `amp`/`psm` write is sent to charger.
- Polling only syncs `target_power` from `amp`/`psm` while in `basic_charging`; in other modes the stored setpoint is preserved.
- If charging is turned off, command flow sends force-off behavior (`frc=1`).
- If charging is turned on and `goe_charger_mode` is any Eco/Trip mode, command flow sends `frc=0` (automatic).
- If charging is turned on and `goe_charger_mode` is `basic_charging`, command flow sends `frc=2` (homey).
- Inverter/grid/battery telemetry can be sent via the `set_pv_surplus_info` flow action, which calls `onCapability_SET_PV_SURPLUS_INFO` and writes the `ids` payload only when the charger is in a PV-surplus mode and connected.
- The `set_charger_mode` flow action writes `goe_charger_mode`; `is_charger_mode` checks the current enum value.
- The `set_transaction` flow action writes `goe_transaction`; writable values are `anonymous` and configured dynamic card IDs (derived from `cXn` where `cXi=true`), while `no_auth` remains read-only and is not written to charger.
- `goe_transaction` requests the 60.0 RFID card key groups `c0n..c9n`, `c0e..c9e`, and `c0i..c9i` so transaction card names can be derived from charger status.
- `goe_transaction_name` and `goe_meter_power_name` both derive the active RFID card name from the 60.0 RFID key groups.
- The `goe_charger_mode_changed` trigger uses Homey's custom capability changed trigger for enum capabilities and exposes the current mode token.
- The `goe_transaction_changed` trigger fires on polled charger-state changes and exposes the current card name token, with the raw transaction label still available as an extra token.
- After a UI toggle of `evcharger_charging`, one mismatching poll value is ignored to prevent temporary switch bounce.

## Polling and Availability

- Poll interval is dynamic:
  - 5000 ms while charging (`car === 2` or `evcharger_charging_state === plugged_in_charging`).
  - 30000 ms while idle.
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
- [.homeycompose/drivers/templates/go-eCharger-local.json](.homeycompose/drivers/templates/go-eCharger-local.json)
- [.homeycompose/drivers/templates/go-eCharger-cloud.json](.homeycompose/drivers/templates/go-eCharger-cloud.json)

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
4. Keep commits small and focused.
