# com.go-e — Homey Cloud Review & Cleanup TODO

Review of the app against the [Homey Cloud rules](https://apps.developer.homey.app/guides/homey-cloud):
redundancies, Cloud rule violations, and optimizations. Every item below was verified against
source (greps + file reads).

## Cloud compliance verdict

**No hard Cloud violations found.** The app is already well-structured for Homey Cloud:
`sdk: 3`, `platforms: ["local","cloud"]`, `"permissions": []` (no `homey:manager:*`,
`homey:app:*`, or `homey:manager:api`), no custom app-settings views, no App Web API, no raw
sockets/servers/fs, timers via `this.homey.setInterval/setTimeout`, and `onUninit` cleanup.
Local (mDNS/LAN) drivers are correctly gated to `platforms: ["local"]` + `connectivity: ["lan"]`,
so they don't violate the Cloud "no LAN/mDNS" rule. The work below is redundancy removal, one
latent bug fix, doc sync, and small optimizations.

---

## P1 — Correctness (latent bug)

- [x] **Cloud `onInit` copy-paste divergence** — `drivers/evcharger-cloud-device.js:16-46`
      duplicates ~90% of `drivers/evcharger-device.js:215-242` but **omits**
      `this.transactionSlotById = {}` and `this.lastTransactionValuesSignature = null`
      (base lines 231-232). `onCapability_SET_TRANSACTION` reads `this.transactionSlotById[...]`
      **without** optional chaining at `evcharger-device.js:790-791`, so a cloud user who sets a
      transaction before the first successful poll gets a `TypeError`.
      **Fix:** refactor cloud `onInit` to call `await super.onInit()`, then apply only the
      cloud-specific bits (base*url from `serialnumber`, `cloud_api_token`, and the
      `clearIntervals()` + `onPoll()` kick-off that replaces mDNS `onDiscoveryAvailable`). Removes
      the duplication \_and* restores the missing initializers.

## P2 — Dead code removal

- [x] **`lib/go-eCharger-API-v2.js`** — remove unused power-conversion / single-write block:
      `setChargerPower` (:281), `wattsToChargerConfig` (:245), `chargerConfigToWatts` (:268),
      `setValue` (:174, only called by dead `setChargerPower`), and `static testCredentials` (:20,
      cloud validation is done inline in `evcharger-cloud-driver.js:24-27`). ~90 lines, and removes
      a *divergent duplicate* of the live power math in `lib/mappings.js`
      (`targetPowerToApiValues`/`apiValuesToTargetPower`) that uses different rounding/thresholds.
- [x] **`lib/mappings.js`** — remove `rfidCards` (:711, exported :831, never consumed),
      `getMeterPowerName` (:177, exported :827, never called), and the dead
      `capabilityMap.goe_transaction.homeyToApi` branch (:398-413; transaction writes bypass the map
      via `onCapability_SET_TRANSACTION`).
- [x] **`goe_pv_surplus_enabled` — fully dead capability path.** Declared in **no** compose
      template or `app.json` (grep = 0 hits), so `hasCapability('goe_pv_surplus_enabled')` is always
      false. Remove its map entry `lib/mappings.js:372-397` and the onPoll block
      `drivers/evcharger-device.js:673-675`. (If it was meant to ship: declare it in the driver
      template and add it to the `registerMultipleCapabilityListener` list — but current state is
      neither wired nor declared, so default to deletion.)
- [x] **`'fst'` in `orderedKeys`** — `drivers/evcharger-device.js:617`. No mapping emits an `fst`
      key; remove the unused ordering slot.

## P3 — Redundancy / optimization

- [x] **Recompute-per-poll:** `getConfiguredTransactionEntries` (`evcharger-device.js:260`) is
      invoked 3× per `onPoll` cycle (`refreshTransactionSlotLookup` :303,
      `getDynamicTransactionValues`/`syncDynamicTransactionOptions` :289,
      `getDynamicTransactionCapabilityValue` :326), each looping all 10 card slots. Compute once per
      poll and reuse. At the 5 s charging interval this runs ~12×/min unnecessarily.
- [x] **Map-then-override waste:** `mapStatusToCapabilities` computes `nextValues.goe_transaction`
      (`evcharger-device.js:668`), immediately overwritten by `getDynamicTransactionCapabilityValue`
      at :669-671. Drop the wasted map computation.
- [ ] **Duplicated helpers (lower priority):** two parallel implementations each for "resolve card
      name from `cXn`" (`evcharger-device.js:844-872` vs `mappings.js:141-175`) and "trx →
      transaction id" (`evcharger-device.js:310-328` vs `mappings.js:98-113`). Keep one home (prefer
      `lib/mappings.js`) and delete the other.
- [ ] **Magic-number consolidation:** `4140` appears in 4 places (`evcharger-device.js:20`
      `AUTO_SPL3_THRESHOLD_W`, `mappings.js:33`, and `?? 4140` fallbacks at `mappings.js:303` and
      `:387`); phase-voltage constants `690`/`230` are likewise scattered. Centralize as named
      constants exported from `lib/mappings.js`.
- [x] **Minor timer nits (`evcharger-device.js`):** `clearIntervals` (:467) clears the interval
      but never nulls `this.onPollInterval` (stale handle); `onDiscoveryAvailable` (:445) calls
      `updatePollInterval` redundantly since `onPoll` already reschedules at its tail (:728). Tidy up.

## P4 — Documentation sync (`MAPPINGS.md`, required by CLAUDE.md)

- [ ] `fsp` **does not exist** in code; the real key is `psm`. Fix references at MAPPINGS.md
      lines ~19, 51-53, 81-83, 120.
- [ ] Correct the command-ordering list (MAPPINGS.md:19) to the actual `orderedKeys`:
      `ids, lmo, fup, psm, pgt, frm, spl3, fst, trx, frc, amp` (drop `fst` if removed in P2).
- [ ] Remove `goe_pv_surplus_enabled` documentation (MAPPINGS.md:39, 63, 78) — capability
      doesn't exist.
- [ ] Update template references (MAPPINGS.md:11, 113) to list all three templates:
      `go-eCharger.json`, `go-eCharger-local.json`, `go-eCharger-cloud.json`.

---

## Verified false — not action items

- **`assets/goe_flexible_rate.svg` is NOT missing** — the file exists; capability icon references
  are valid.
- **`.homeybuild/` and `tmp/` are NOT tracked cruft** — both are already in `.gitignore` and
  `git ls-files` returns nothing for them.

## Verification (after applying edits)

- Run `homey app validate --level publish` (or the CI validate step) — must pass for
  `platforms: ["local","cloud"]`.
- Confirm no dangling references:
  `grep -rn "setChargerPower\|testCredentials\|rfidCards\|getMeterPowerName\|goe_pv_surplus_enabled\|\bfsp\b" lib/ drivers/ MAPPINGS.md`
  should return nothing meaningful.
- Apply and commit code edits in small, individually-validated steps per CLAUDE.md
  ("test and commit often").
