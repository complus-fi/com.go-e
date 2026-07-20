'use strict';

/**
 * Pure energy-source-split helpers.
 *
 * No Homey dependencies and no I/O — these functions only work with plain
 * numbers/objects, which is what makes them easy to unit test in isolation
 * (see script/test-energy-split.js) before wiring them into onPoll().
 *
 * Sign convention for `gridPowerW` (the go-e `pgrid` field): positive means
 * importing from the grid, negative means exporting to the grid (PV output
 * exceeds what the house + charger are currently using). See
 * METER_SURPLUS_PLAN.md for the reasoning behind clamping negative readings
 * to 0 (fully surplus) rather than passing them through.
 */

/**
 * Compute what fraction of the charger's current instantaneous power draw is
 * coming from the grid vs. "surplus" (PV and/or battery discharge — see the
 * "non-grid" caveat in METER_SURPLUS_PLAN.md).
 *
 * @param {number} totalPowerW Charger's total instantaneous power draw, in watts.
 * @param {number} gridPowerW Instantaneous grid power, in watts. Positive =
 *   importing, negative = exporting.
 * @returns {{ surplusFraction: number, gridFraction: number }} Fractions in
 *   `[0, 1]` that sum to `1` (or both `0` when `totalPowerW` is `0`/non-finite).
 */
function getEnergySourceSplit(totalPowerW, gridPowerW) {
  const total = Number(totalPowerW);
  const grid = Number(gridPowerW);

  if (!Number.isFinite(total) || total <= 0) {
    return { surplusFraction: 0, gridFraction: 0 };
  }

  // Negative (export) readings mean the grid is contributing nothing to the
  // charger's load: fully surplus. Also clamp to totalPowerW in case of a
  // momentary sensor mismatch where pgrid briefly reads higher than the
  // charger's own total draw.
  const safeGrid = Number.isFinite(grid) ? grid : 0;
  const clampedGrid = Math.min(Math.max(safeGrid, 0), total);
  const gridFraction = clampedGrid / total;
  const surplusFraction = 1 - gridFraction;

  return { surplusFraction, gridFraction };
}

/**
 * Advance the accumulated grid-Wh total by one poll's worth of the raw
 * session/lifetime/card Wh counter, applying this poll's split fraction to
 * the *delta* since the previous poll (not to the running total).
 *
 * Handles the raw counter going backwards (session reset, manual card reset,
 * app restart losing lifetime state, etc.) by re-basing: a backwards jump is
 * treated as a fresh start, where the entire new `rawWh` value is the delta
 * to allocate (not `rawWh - previous lastRawWh`, which would be negative,
 * and not a flat `0`, which would silently drop that poll's own energy from
 * the split). The old `gridWh` total is discarded, not carried forward.
 *
 * @param {{ lastRawWh: number, gridWh: number } | null} state Previous state,
 *   or `null`/`undefined` on the very first poll.
 * @param {number} rawWh Current value of the raw hardware Wh counter this
 *   poll is tracking (session `wh`, lifetime `eto`, or a card's `c{n}e`).
 * @param {{ surplusFraction: number, gridFraction: number }} split Result of
 *   `getEnergySourceSplit()` for this same poll.
 * @returns {{ lastRawWh: number, gridWh: number }} New state to store and
 *   pass into the next call.
 */
function accumulateEnergySplit(state, rawWh, split) {
  const raw = Number(rawWh);
  const safeRaw = Number.isFinite(raw) ? raw : 0;
  const gridFraction = Number.isFinite(split?.gridFraction) ? split.gridFraction : 0;

  const isFirstPoll = !state || !Number.isFinite(state.lastRawWh);
  const isReset = !isFirstPoll && safeRaw < state.lastRawWh;

  let delta;
  let previousGridWh;

  if (isFirstPoll || isReset) {
    // Fresh start: nothing meaningful preceded this value, so treat the
    // whole current reading as newly accrued since a zero baseline.
    delta = safeRaw;
    previousGridWh = 0;
  } else {
    delta = safeRaw - state.lastRawWh;
    previousGridWh = state.gridWh;
  }

  return {
    lastRawWh: safeRaw,
    gridWh: previousGridWh + delta * gridFraction
  };
}

/**
 * Derive the surplus-side Wh for display from the authoritative raw counter
 * and the accumulated grid-Wh total — not from an independently accumulated
 * surplus total. This guarantees `surplusWh + gridWh === rawWh` (clamped) by
 * construction, rather than by careful bookkeeping in two places.
 *
 * @param {number} rawWh Current raw hardware Wh counter value.
 * @param {number} gridWh Accumulated grid-Wh total from `accumulateEnergySplit()`.
 * @returns {number} Surplus-side Wh, clamped to `[0, rawWh]`.
 */
function getSurplusWh(rawWh, gridWh) {
  const raw = Number(rawWh);
  const safeRaw = Number.isFinite(raw) ? raw : 0;
  const safeGrid = Number.isFinite(gridWh) ? gridWh : 0;

  return Math.min(Math.max(safeRaw - safeGrid, 0), safeRaw);
}

module.exports = {
  getEnergySourceSplit,
  accumulateEnergySplit,
  getSurplusWh
};
