'use strict';

/**
 * Throwaway validation script for lib/energy-split.js — run this before wiring
 * the module into onPoll(). Doesn't touch Homey; just simulates a sequence of
 * polls against the module's exported functions and checks the invariant
 * `surplusWh + gridWh === rawWh` on every one.
 *
 * Run from anywhere (the require below is relative to this file, not to your
 * current working directory):
 *
 *   node test/test-energy-split.js
 */

const path = require('path');
const { getEnergySourceSplit, accumulateEnergySplit, getSurplusWh } = require(
  path.join(__dirname, '..', 'lib', 'energy-split')
);

// Simulated poll sequence: [rawWh (session counter), totalPowerW, gridPowerW]
// gridPowerW follows the go-e convention: positive = importing from the grid,
// negative = exporting (PV output exceeds house + charger load).
// Includes a mid-session reset (rawWh drops back to a small value) and an
// export reading (negative pgrid) to exercise both edge cases.
const polls = [
  [0, 0, 0], // idle
  [500, 2000, 500], // charging starts, mostly PV (1500W surplus, 500W grid)
  [1200, 2000, 2000], // pure grid stretch (no PV)
  [1800, 1500, 0], // pure surplus stretch (no grid draw)
  [2400, 1500, -300], // export: PV covers charger and pushes 300W back to grid — should count as 100% surplus, not "negative grid"
  [50, 1000, 1000], // session reset mid-test: counter drops back down
  [900, 1000, 1000] // pure grid after reset
];

let state = null;
let failures = 0;

for (const [rawWh, totalPowerW, gridPowerW] of polls) {
  const split = getEnergySourceSplit(totalPowerW, gridPowerW);
  state = accumulateEnergySplit(state, rawWh, split);
  const surplusWh = getSurplusWh(rawWh, state.gridWh);

  const sum = surplusWh + state.gridWh;
  const ok = Math.abs(sum - rawWh) < 1e-9;
  if (!ok) failures++;

  console.log(
    `rawWh=${rawWh}\tgridWh=${state.gridWh.toFixed(2)}\tsurplusWh=${surplusWh.toFixed(2)}\t`
    + `sum=${sum.toFixed(2)}\t${ok ? 'OK' : 'MISMATCH'}`
  );
}

if (failures > 0) {
  console.error(`\n${failures} poll(s) violated surplusWh + gridWh === rawWh.`);
  process.exit(1);
}

console.log('\nAll polls satisfied surplusWh + gridWh === rawWh.');
