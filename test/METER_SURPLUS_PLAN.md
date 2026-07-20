# METER_SURPLUS_PLAN.md — Surplus vs Grid energy sub-capabilities

Step-by-step guide to add `_surplus` / `_grid` split sub-capabilities to the energy
meters, so users can see how much of their charging was "free" (not drawn from the
grid) vs paid grid energy.

## Decisions already made (don't relitigate these mid-implementation)

- **Capability id** stays technical: `_surplus` / `_grid` (matches the app's existing
  `GOE_CHARGER_MODE.*_PV_SURPLUS` naming).
- **User-facing title** says **"Surplus energy"** / **"Grid energy"**
- **Allocation model**: `gridPortion = clamp(pgrid, 0, measure_power)`,
  `surplusPortion = measure_power - gridPortion`, evaluated fresh each poll and
  applied to that poll's *delta* of the underlying Wh counter — not two independently
  accumulated totals. See `lib/energy-split.js`.
- **`pgrid` sign convention**: positive = importing from the grid, negative =
  exporting to the grid (e.g. PV produces more than the house + charger are using).
  The `clamp(pgrid, 0, ...)` above is doing double duty: it treats any negative
  (export) reading as `gridPortion = 0` — fully surplus, which is correct, since
  exporting means the charger's load is covered without drawing from the grid at
  all. Don't "fix" this clamp to pass negative values through; that's the intended
  behavior, not a missing abs()/edge case.
- **Caveat to keep in mind**: with a home battery, "surplus"/"free" really means
  "non-grid" (PV + battery discharge combined), since `pgrid` alone can't tell them apart.
- **Scope**: confirm before starting — session only, or session + lifetime + all 10
  card meters? The steps below assume you're doing all three; skip the per-card bits
  if you're starting smaller.

---

## Step 1 — Add the energy-split module

File: `lib/energy-split.js` (new file). This is pure logic, no Homey dependencies,
so it's the easiest thing to unit test in isolation before touching the device code.

Exports:

- `getEnergySourceSplit(totalPowerW, gridPowerW)` → `{ surplusFraction, gridFraction }`
  for *this instant*.
- `accumulateEnergySplit(state, rawWh, split)` → advances `{ lastRawWh, gridWh }` by
  one poll, handling counter resets (session reset, manual card reset, or anything
  else that makes the raw counter go backwards) by re-basing to zero instead of
  producing a negative delta.
- `getSurplusWh(rawWh, gridWh)` → derives the surplus side as `rawWh - gridWh`,
  clamped to `[0, rawWh]`. This is computed fresh every time from the authoritative
  hardware counter, not accumulated independently — so `surplus + grid === rawWh` by
  construction, not by careful bookkeeping.

✅ **Verify before moving on**: run a quick script (see the "Testing" section at the
bottom) confirming `surplusWh + gridWh === rawWh` across a simulated session,
including a mid-session reset. Don't wire this into the device until that passes.

---

## Step 2 — Add capability definitions

File: `.homeycompose/drivers/templates/go-eCharger.json`

As they are all sub capabilties of the standard SDK meter_power, we do not need the definition files. Only override a few capabilitiesOptions:

- title: {en:, nl:, da:, de:, es:, fr:, it:, no:, sv:, pl:, ru:, ko:, ar:}
- getable: true
- setable: false
- decimals: 3
- insights: true

Everything else is inherited from the main capability meter_power.

If you're doing the full scope, repeat for:

- meter_power.surplus, meter_power.grid
- meter_power.session_surplus, meter_power.session_grid
- meter_power.{1..10}_surplus, meter_power.{1..10}_grid

---

## Step 3 — Register the new capabilities on the driver template

File: `.homeycompose/drivers/templates/go-eCharger.json`

Add the new ids to the `"capabilities"` array, right next to the existing
`"meter_power"` / `"meter_power.session"` entries:

```jsonc
"capabilities": [
  // ...
  "meter_power",
  "meter_power.session",
  "meter_power.session_surplus",   // new
  "meter_power.session_grid",      // new
  // ...
]
```

This template is shared via `$extends` across all 8 driver `driver.compose.json`
files (local + cloud × 4 models), so one edit here covers all of them — you do not
need to touch each driver folder individually.

If you're adding lifetime/per-card too, add those ids here as well (skip the
per-card ones if you want them added *dynamically* only when a card is configured —
see the note in Step 5 about `syncDynamicCardCapabilities()`).

✅ **Verify**: `npx homey app validate` again — confirms the template edit is
syntactically correct and every driver still resolves capabilities.

---

## Step 4 — Make sure the right raw API keys get requested

File: `lib/mappings.js`, function `getStatusAttributes()` (~line 592-611)

The split needs `nrg` (for `measure_power`) and `pgrid` on every poll, even for
devices where the plain `measure_power`/`measure_power.pgrid` capabilities
themselves aren't present. Add a condition alongside the existing
`goe_transaction`/card-capability check:

```js
if (
  capabilities.includes('meter_power.session_surplus') ||
  capabilities.includes('meter_power.session_grid') ||
  capabilities.includes('meter_power.surplus') ||
  capabilities.includes('meter_power.grid')
  // + per-card ids if in scope
) {
  apiKeys.add('nrg');
  apiKeys.add('pgrid');
}
```

✅ **Verify**: add a temporary `this.log()` of `this.api.apiKeys` in `onInit()` and
confirm `nrg`/`pgrid` show up once a device has the new capabilities.

---

## Step 5 — Initialize per-counter state

File: `drivers/evcharger-device.js`, `onInit()` (~line 258-287)

Add alongside the existing per-device state (`this.cardConfiguredFlags`,
`this.transactionSlotById`, etc.):

```js
this.energySplitState = {
  session: null,
  lifetime: null,
  cards: Array(10).fill(null)
};
```

Each slot is independent — a session reset only resets `session`, a manual card
reset only resets that card's slot in `cards[]`. No cross-talk between them.

If you're doing per-card, this is also where you'd extend
`syncDynamicCardCapabilities()` (~line 937-1018) to add/remove the `_surplus`/`_grid`
card capabilities alongside the existing `meter_power.N` / `goe_meter_power_name.N`
pair, if you want them dynamically added only for configured cards rather than always
present.

---

## Step 6 — Compute and write the split values in `onPoll()`

File: `drivers/evcharger-device.js`, `onPoll()` (~line 665-818)

Add near the top, after `status` is fetched but before the capability-write loop:

```js
const { getEnergySourceSplit, accumulateEnergySplit, getSurplusWh } = require('../lib/energy-split');

// ...inside onPoll(), after `const status = await this.api.getStatus();`

const totalPowerW = Number(status.nrg?.[11]);
const gridPowerW = Number(status.pgrid);
const split = getEnergySourceSplit(totalPowerW, gridPowerW);

if (this.hasCapability('meter_power.session_surplus') || this.hasCapability('meter_power.session_grid')) {
  this.energySplitState.session = accumulateEnergySplit(this.energySplitState.session, status.wh, split);
  const gridWh = this.energySplitState.session.gridWh;
  nextValues['meter_power.session_grid'] = gridWh / 1000;
  nextValues['meter_power.session_surplus'] = getSurplusWh(status.wh, gridWh) / 1000;
}
```

(Move the `require()` to the top of the file with the other imports — it's shown
inline here just to mark where the new logic plugs in.)

Mirror this block for lifetime (`status.eto` → `this.energySplitState.lifetime`) and,
if in scope, loop over the 10 cards (`status['c' + i + 'e']` →
`this.energySplitState.cards[i]`), same pattern as the existing per-card loop later
in `onPoll()` that handles `meter_power.N`/`goe_meter_power_name.N`.

Everything downstream (the existing `for (const [capability, value] of
Object.entries(nextValues))` write loop) already handles arbitrary capability ids, so
no changes needed there — as long as you've added the keys to `nextValues` before
that loop runs.

✅ **Verify**: pair a real device (or point at a test fixture), let it poll a few
times, and confirm in the device's Insights/capability view that:

- `session_surplus + session_grid` always equals `meter_power.session`.
- Both stay at `0` while idle.
- Forcing an export/import swing (or just watching a real PV day) moves the split
  the direction you'd expect.

---

## Step 7 — Manual regression check for resets

Before calling this done, specifically exercise both reset paths, since that's where
this feature is most likely to quietly misbehave:

1. **Session reset**: let a charging session finish (`wh` returns to `0` on the next
   session), confirm `session_surplus`/`session_grid` both reset to `0` and don't
   inherit anything from the previous session.
2. **Manual card reset**: if you're in per-card scope, manually reset one card's
   counter via the go-e app/API mid-testing, confirm only that card's `_surplus`/
   `_grid` pair resets to `0`, and any *other* card you're tracking is unaffected.

---

## Step 8 — Docs

- Add a row to `MAPPINGS.md` for each new capability, same table format as the
  existing entries (see the `measure_power.pakku`/`pgrid`/`ppv` rows for the closest
  precedent).
- One-line mention in the README about what "Surplus energy" means (non-grid, may
  include battery discharge) so users aren't surprised.

---

## Testing

Throwaway script to validate `lib/energy-split.js` in isolation, before wiring it
into `onPoll()`. Doesn't touch Homey — just simulates a sequence of polls against
the module's exported functions.

Save as e.g. `/tmp/test-energy-split.js` and run with `node /tmp/test-energy-split.js`
from the app root (so the relative `require` resolves):

```js
const { getEnergySourceSplit, accumulateEnergySplit, getSurplusWh } = require('./lib/energy-split');

// Simulated poll sequence: [rawWh (session counter), totalPowerW, gridPowerW]
// gridPowerW follows the go-e convention: positive = importing from the grid,
// negative = exporting (PV output exceeds house + charger load).
// Includes a mid-session reset (rawWh drops back to a small value) and an
// export reading (negative pgrid) to exercise both edge cases.
const polls = [
  [0, 0, 0],          // idle
  [500, 2000, 500],   // charging starts, mostly PV (1500W surplus, 500W grid)
  [1200, 2000, 2000], // pure grid stretch (no PV)
  [1800, 1500, 0],    // pure surplus stretch (no grid draw)
  [2400, 1500, -300], // export: PV covers charger and pushes 300W back to grid — should count as 100% surplus, not "negative grid"
  [50, 1000, 1000],   // session reset mid-test: counter drops back down
  [900, 1000, 1000],  // pure grid after reset
];

let state = null;

for (const [rawWh, totalPowerW, gridPowerW] of polls) {
  const split = getEnergySourceSplit(totalPowerW, gridPowerW);
  state = accumulateEnergySplit(state, rawWh, split);
  const surplusWh = getSurplusWh(rawWh, state.gridWh);

  const sum = surplusWh + state.gridWh;
  const ok = Math.abs(sum - rawWh) < 1e-9;

  console.log(
    `rawWh=${rawWh}\tgridWh=${state.gridWh.toFixed(2)}\tsurplusWh=${surplusWh.toFixed(2)}\t` +
    `sum=${sum.toFixed(2)}\t${ok ? 'OK' : 'MISMATCH'}`
  );

  if (!ok) {
    throw new Error(`Invariant violated: surplusWh + gridWh (${sum}) !== rawWh (${rawWh})`);
  }
}

console.log('All polls satisfied surplusWh + gridWh === rawWh.');
```

✅ **Pass condition**: every printed line says `OK` and the script exits without
throwing. If the reset row (`[50, 1000, 1000]`) mismatches, that's the re-basing
logic in `accumulateEnergySplit` — check it treats a backwards jump in `rawWh` as
a fresh start (delta = new `rawWh`, not `rawWh - previous lastRawWh`) rather than
carrying forward the old `gridWh` total. If the export row (`[2400, 1500, -300]`)
mismatches, or its `gridWh` doesn't stay flat versus the previous row, that's
`getEnergySourceSplit` not clamping negative `pgrid` to `0` — check that a negative
grid reading contributes `gridFraction = 0` (fully surplus), not a negative
fraction.

Extend this script (or add more rows) if you want to sanity-check the lifetime
(`eto`) or per-card (`c{n}e`) variants before wiring those in too — the invariant
and reset behavior should hold identically regardless of which raw counter feeds it.

---

## Suggested PR breakdown (full scope, split across multiple PRs)

Each PR below is independently reviewable and shippable — the app is left in a
working, validated state after every one. `getStatusAttributes()` (Step 4) is
touched in every PR that introduces a new raw counter dependency, rather than
once at the end, so each PR's polling behavior is fully correct on its own
without waiting for a later PR.

### PR 1 — Energy-split module (foundation, no device wiring)

- `lib/energy-split.js` (Step 1).
- Throwaway test script from the "Testing" section above, including the reset
  and export rows.
- Nothing in `drivers/` or `.homeycompose/` changes yet — this PR is pure logic
  and can land on its own with no user-visible effect.

✅ Merge gate: test script passes (all rows `OK`).

### PR 2 — Session-level surplus/grid split

- Capability JSON: `meter_power.session_surplus`, `meter_power.session_grid`
  (Step 2, session-only).
- Template registration in `go-eCharger.json` (Step 3, session-only).
- `getStatusAttributes()`: add the `nrg`/`pgrid` condition, gated on the two
  session capability ids only (Step 4, session-only slice).
- `onInit()`: add `this.energySplitState` with `session` populated,
  `lifetime`/`cards` still present but unused until PR 3/4 (Step 5).
- `onPoll()`: session-only wiring block (Step 6, session-only).
- Regression check: Step 7.1 (session reset).
- Docs: `MAPPINGS.md` rows + README line for the two new session capabilities
  (Step 8, session-only slice).

✅ Merge gate: `npx homey app validate`, plus the Step 6 verification checklist
against a real device — this PR is a complete, user-facing feature by itself.

### PR 3 — Lifetime surplus/grid split

- Capability JSON + template registration for `meter_power.surplus`,
  `meter_power.grid` (Steps 2-3, repeated for `eto`).
- Extend the `getStatusAttributes()` condition from PR 2 to also match the two
  lifetime capability ids (still the same `nrg`/`pgrid` keys — just widening
  which capabilities trigger requesting them).
- `onInit()`: no new state shape needed, `lifetime` slot already exists from
  PR 2 — just start populating it in `onPoll()`.
- `onPoll()`: mirror the session block for `status.eto` (Step 6).
- Docs: add the two lifetime rows/README mention.

✅ Merge gate: same as PR 2, but confirm lifetime totals survive an app
restart (lifetime shouldn't reset the way session does) in addition to the
Step 6 checklist.

### PR 4 — Per-card surplus/grid split

- Capability JSON for `meter_power.{1..10}_surplus`/`_grid` (Steps 2-3).
- Dynamic add/remove wiring in `syncDynamicCardCapabilities()` so these ids
  follow the existing `meter_power.N`/`goe_meter_power_name.N` pair per
  configured card (Step 5 note).
- Extend the `getStatusAttributes()` condition again to cover the per-card ids
  (Step 4, final slice — this condition is now complete).
- `onPoll()`: loop over the 10 cards mirroring the existing per-card pattern
  (Step 6).
- Regression check: Step 7.2 (manual card reset).
- Docs: per-card rows/README mention.

✅ Merge gate: Step 6 checklist per configured card, plus Step 7.2 (resetting
one card doesn't disturb another's `_surplus`/`_grid` pair).

### If you're stopping at session-only scope

Just do PR 1 and PR 2 — skip PR 3/4 entirely, and don't add the unused
`lifetime`/`cards` handling in `onInit()` beyond what PR 2 already needs.
