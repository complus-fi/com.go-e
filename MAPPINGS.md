# Capability to API Mappings

This document describes how Homey capabilities map to go-e API keys and behavior in this project.

Primary sources:

- [drivers/evcharger-device.js](drivers/evcharger-device.js)
- [lib/mappings.js](lib/mappings.js)
- [lib/go-eCharger-API-v2.js](lib/go-eCharger-API-v2.js)
- [.homeycompose/drivers/templates/go-eCharger.json](.homeycompose/drivers/templates/go-eCharger.json)

## Runtime Flow

1. The device initializes API key filtering from active capabilities.
2. Polling fetches charger status every 5 seconds.
3. Status values are converted to capability values.
4. Capability writes are converted back to API key/value commands.
5. API command ordering prioritizes `trx`, then `frc`, then `amp`, then `psm`.

## Capability Matrix

| Homey capability         | Direction                      | API keys used        | Mapping behavior                                                    | Notes                                                              |
| ------------------------ | ------------------------------ | -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| evcharger_charging       | Read + write                   | alw (read), trx, frc | Read: `alw` bool. Write true -> `trx=0` when null; false -> `frc=1` | `alw` is read-only in API; transaction enables anonymous charging  |
| evcharger_charging_state | Read                           | car                  | car state mapped to enum values                                     | When `car === 5`, state becomes null and `alarm_problem` is true   |
| alarm_problem            | Read                           | car                  | true when `car === 5`                                               | Fault indicator                                                    |
| meter_power              | Read                           | eto                  | Wh to kWh conversion with rounding                                  | Returns null if value is not positive                              |
| meter_power.session      | Read                           | wh                   | Session Wh to kWh conversion with rounding                          | Capability options are defined in compose template                 |
| measure_temperature      | Read                           | tma                  | Averages non-zero temperatures from array                           | 0 when all values are zero or missing                              |
| measure_power            | Read                           | nrg                  | Uses `nrg[11]` total power                                          | Rounded to 2 decimals                                              |
| measure_current          | Read                           | nrg                  | Average of non-zero phase currents (`nrg[4..6]`)                    | 0 when no active phases                                            |
| measure_voltage          | Read                           | nrg, pha             | Phase-aware input voltage calculation                               | 3-phase uses sqrt(3) scaling                                       |
| measure_voltage.output   | Read                           | nrg, pha             | Phase-aware output voltage calculation                              | 0 if no output phases active                                       |
| target_power             | Read + write                   | amp, psm             | Read: amp/phase to watts. Write: watts to amp+psm                   | Write intentionally does not set `frc`                             |
| target_power_mode        | Read + indirect write behavior | frc                  | Read: frc=0 => device, frc=1/2 => homey                             | On write path in device logic, selecting device mode sends `frc=0` |

## Control Behavior

- Listener handles three control capabilities in one debounced batch:
  - `target_power`
  - `target_power_mode`
  - `evcharger_charging`
- If `target_power_mode` is set to `device`, command is `frc=0` and no power override is sent.
- If charging is turned off, command flow sends force-off behavior (`frc=1`).
- If charging is turned on, command flow sends `frc=2`; if `trx` is null it also sets `trx=0` for anonymous charging.
- If charging is turned on and a target power is included in the same batch, values are merged into a single API call.
- If only `target_power` changes, updates are ignored unless mode is `homey`.
- After a UI toggle of `evcharger_charging`, one mismatching poll value is ignored to prevent temporary switch bounce.

## Dynamic Limits

- `target_power` capability max is updated from charger `ama` using:
  - `max_watts = ama * 690`
- This is applied via capability options at runtime.

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
