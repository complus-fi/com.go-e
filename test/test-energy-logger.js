'use strict';

/**
 * Standalone go-e local-API sample logger.
 *
 * Polls a go-e Charger's local status endpoint at a fixed interval and
 * appends one JSON line per poll to a log file, so you can capture real
 * charging-session data to validate lib/energy-split.js against — instead of
 * only the synthetic polls in test/test-energy-split.js.
 *
 * Tracks three independent counters, each with its own accumulated split,
 * exactly like `this.energySplitState.{session,lifetime,cards[]}` in the real
 * driver (Step 5 of METER_SURPLUS_PLAN.md): the session total `wh` (resets
 * every charge), the lifetime total `eto`, and each configured RFID card's
 * own lifetime total `c{n}e`. A reset on any one of them never affects the
 * others.
 *
 * Doesn't touch Homey and has no dependency on the rest of the app beyond
 * lib/energy-split.js (used here only to print a live running split as a
 * sanity check while you watch it charge — the authoritative analysis should
 * be done by reprocessing the raw logged samples afterwards).
 *
 * Usage:
 *   node test/test-energy-logger.js --host 192.168.4.18 --label full-grid
 *   node test/test-energy-logger.js --host 192.168.4.18 --label pv-surplus
 *
 * Suggested scenarios to capture (see METER_SURPLUS_PLAN.md):
 *   1. full-grid    — charge overnight / with no PV production, so pgrid
 *                      should track close to the charger's total power the
 *                      whole session.
 *   2. pv-surplus   — charge during strong PV production with the charger's
 *                      "PV surplus" mode (or just during a sunny midday
 *                      period), so pgrid should be low/negative for most of
 *                      the session.
 *
 * Options:
 *   --host <ip>        Charger IP, e.g. 192.168.4.18 (default: 192.168.4.18)
 *   --base-url <url>   Full API base URL, overrides --host, e.g.
 *                      http://192.168.4.18/api
 *   --label <name>     Tag used in the output filename (default: session)
 *   --interval <secs>  Poll interval in seconds (default: 5)
 *   --duration <secs>  Stop automatically after this many seconds
 *                      (default: run until Ctrl+C)
 *   --out <dir>        Output directory for log files (default: ./logs)
 *   --keys <a,b,c>     Override the requested status filter keys
 *
 * Press Ctrl+C to stop early — the log file is flushed and a summary is
 * printed either way.
 */

const fs = require('fs');
const path = require('path');
const { getEnergySourceSplit, accumulateEnergySplit, getSurplusWh } = require(
  path.join(__dirname, '..', 'lib', 'energy-split')
);

const CARD_SLOTS = 10;

// wh (session) + eto (lifetime) + nrg/pgrid (needed for the split itself),
// plus each card's id/name/energy triplet (c0i/c0n/c0e .. c9i/c9n/c9e). id+name
// are requested alongside energy purely so the log/console output can tell
// you *which* physical card a slot belongs to, not just its index.
const DEFAULT_KEYS = [
  'wh',
  'eto',
  'nrg',
  'pgrid',
  ...Array.from({ length: CARD_SLOTS }, (_, i) => [`c${i}i`, `c${i}n`, `c${i}e`]).flat()
];

// c{n}i is a boolean "is this card slot configured" flag — NOT an RFID tag
// id. Mirrors the check in drivers/evcharger-device.js#isCardConfigured().
function isCardConfigured(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

// c{n}n is the card's display name, but it can be blank or the literal
// string "n/a". Mirrors getConfiguredTransactionEntries()'s baseId fallback:
// use the name if it's meaningful, otherwise fall back to a stable card_N id.
function getCardLabel(slot, rawName) {
  if (typeof rawName === 'string') {
    const normalized = rawName.trim();
    if (normalized && normalized.toLowerCase() !== 'n/a') return normalized;
  }
  return `card_${slot}`;
}

function parseArgs(argv) {
  const args = {
    host: '192.168.4.18',
    baseUrl: null,
    label: 'session',
    interval: 5,
    duration: null,
    out: './logs',
    keys: DEFAULT_KEYS
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];

    switch (arg) {
      case '--host':
        args.host = next();
        break;
      case '--base-url':
        args.baseUrl = next();
        break;
      case '--label':
        args.label = next();
        break;
      case '--interval':
        args.interval = Number(next());
        break;
      case '--duration':
        args.duration = Number(next());
        break;
      case '--out':
        args.out = next();
        break;
      case '--keys':
        args.keys = next().split(',').map((key) => key.trim()).filter(Boolean);
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }

  if (!args.baseUrl) {
    args.baseUrl = `http://${args.host}/api`;
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, '');

  return args;
}

function printHelp() {
  console.log(`
Usage: node test/test-energy-logger.js [options]

Options:
  --host <ip>        Charger IP, e.g. 192.168.4.18 (default: 192.168.4.18)
  --base-url <url>   Full API base URL, overrides --host
  --label <name>     Tag used in the output filename (default: session)
  --interval <secs>  Poll interval in seconds (default: 5)
  --duration <secs>  Stop automatically after this many seconds
  --out <dir>        Output directory for log files (default: ./logs)
  --keys <a,b,c>     Override the requested status filter keys
                      (default: wh,eto,nrg,pgrid + c0i,c0n,c0e .. c9i,c9n,c9e)

Examples:
  node test/test-energy-logger.js --host 192.168.4.18 --label full-grid
  node test/test-energy-logger.js --host 192.168.4.18 --label pv-surplus --interval 10
`);
}

async function fetchStatus(baseUrl, keys) {
  const url = `${baseUrl}/status?filter=${keys.join(',')}`;
  const response = await fetch(url, { method: 'GET' });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

function formatWh(wh) {
  return Number.isFinite(wh) ? `${(wh / 1000).toFixed(3)} kWh` : 'n/a';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (!Number.isFinite(args.interval) || args.interval <= 0) {
    console.error('--interval must be a positive number of seconds.');
    process.exit(1);
  }

  fs.mkdirSync(args.out, { recursive: true });

  const startedAt = new Date();
  const timestampForFilename = startedAt.toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(args.out, `${args.label}-${timestampForFilename}.jsonl`);
  const stream = fs.createWriteStream(outFile, { flags: 'a' });

  console.log(`Logging go-e status from ${args.baseUrl} every ${args.interval}s`);
  console.log(`Filter keys: ${args.keys.join(',')}`);
  console.log(`Writing samples to: ${outFile}`);
  if (args.duration) {
    console.log(`Will stop automatically after ${args.duration}s.`);
  }
  console.log('Press Ctrl+C to stop early.\n');

  let sampleCount = 0;
  let errorCount = 0;

  // Session (wh) split state — same shape as this.energySplitState.session.
  let sessionSplitState = null;
  let firstWh = null;
  let lastWh = null;

  // Lifetime (eto) split state — same shape as this.energySplitState.lifetime.
  let lifetimeSplitState = null;
  let firstEto = null;
  let lastEto = null;

  // Per-card split state — same shape as this.energySplitState.cards[].
  // Indexed 0-9 to match the go-e API's c0.. c9 naming (slot = index + 1).
  const cardSplitStates = Array(CARD_SLOTS).fill(null);
  const cardSummaries = Array(CARD_SLOTS).fill(null); // { slot, id, name, firstWh, lastWh } once seen configured

  const startMs = Date.now();

  const poll = async () => {
    let status;
    try {
      status = await fetchStatus(args.baseUrl, args.keys);
    } catch (error) {
      errorCount++;
      console.error(`[poll error] ${error.message}`);
      return;
    }

    const now = new Date();
    const elapsedMs = Date.now() - startMs;

    const totalPowerW = Number(status.nrg?.[11]);
    const gridPowerW = Number(status.pgrid);
    const wh = Number(status.wh);
    const eto = Number(status.eto);

    const split = getEnergySourceSplit(totalPowerW, gridPowerW);

    // Session.
    sessionSplitState = accumulateEnergySplit(sessionSplitState, wh, split);
    const sessionSurplusWh = getSurplusWh(wh, sessionSplitState.gridWh);
    if (firstWh === null && Number.isFinite(wh)) firstWh = wh;
    if (Number.isFinite(wh)) lastWh = wh;

    // Lifetime.
    lifetimeSplitState = accumulateEnergySplit(lifetimeSplitState, eto, split);
    const lifetimeSurplusWh = getSurplusWh(eto, lifetimeSplitState.gridWh);
    if (firstEto === null && Number.isFinite(eto)) firstEto = eto;
    if (Number.isFinite(eto)) lastEto = eto;

    // Per configured card.
    const cardLines = [];
    for (let i = 0; i < CARD_SLOTS; i++) {
      const configured = isCardConfigured(status[`c${i}i`]);
      if (!configured) continue;

      const cardWh = Number(status[`c${i}e`]);
      cardSplitStates[i] = accumulateEnergySplit(cardSplitStates[i], cardWh, split);
      const cardSurplusWh = getSurplusWh(cardWh, cardSplitStates[i].gridWh);

      const label = getCardLabel(i + 1, status[`c${i}n`]);

      if (!cardSummaries[i]) {
        cardSummaries[i] = {
          slot: i + 1,
          label,
          firstWh: cardWh,
          lastWh: cardWh
        };
      } else if (Number.isFinite(cardWh)) {
        cardSummaries[i].lastWh = cardWh;
      }

      cardLines.push({
        slot: i + 1,
        label,
        energyWh: cardWh,
        gridWh: cardSplitStates[i].gridWh,
        surplusWh: cardSurplusWh
      });
    }

    const line = {
      t: now.toISOString(),
      elapsedMs,
      raw: status,
      computed: {
        totalPowerW,
        gridPowerW,
        gridFraction: split.gridFraction,
        surplusFraction: split.surplusFraction,
        sessionGridWh: sessionSplitState.gridWh,
        sessionSurplusWh,
        lifetimeGridWh: lifetimeSplitState.gridWh,
        lifetimeSurplusWh,
        cards: cardLines
      }
    };

    stream.write(`${JSON.stringify(line)}\n`);
    sampleCount++;

    const cardConsoleSummary = cardLines
      .map((c) => `#${c.slot}(${c.label}):${c.energyWh}Wh`)
      .join(' ');

    console.log(
      `[${now.toLocaleTimeString()}] wh=${wh} eto=${eto} totalPowerW=${totalPowerW} `
      + `gridPowerW=${gridPowerW} gridFrac=${split.gridFraction.toFixed(2)} `
      + `sessionGridWh=${sessionSplitState.gridWh.toFixed(1)} sessionSurplusWh=${sessionSurplusWh.toFixed(1)} `
      + `lifetimeGridWh=${lifetimeSplitState.gridWh.toFixed(1)} lifetimeSurplusWh=${lifetimeSurplusWh.toFixed(1)}`
      + (cardConsoleSummary ? ` cards[${cardConsoleSummary}]` : ' cards[none configured]')
    );

    if (args.duration && elapsedMs >= args.duration * 1000) {
      stop('duration reached');
    }
  };

  const intervalHandle = setInterval(poll, args.interval * 1000);
  poll(); // fire immediately instead of waiting for the first interval tick

  let stopping = false;
  function stop(reason) {
    if (stopping) return;
    stopping = true;
    clearInterval(intervalHandle);
    stream.end(() => {
      const durationSec = ((Date.now() - startMs) / 1000).toFixed(1);
      console.log(`\nStopped (${reason}).`);
      console.log(`Samples logged: ${sampleCount} (${errorCount} poll error(s))`);
      console.log(`Duration: ${durationSec}s`);

      if (firstWh !== null && lastWh !== null) {
        console.log(`Session wh: ${firstWh} -> ${lastWh} (delta ${formatWh(lastWh - firstWh)})`);
      }
      if (sessionSplitState) {
        console.log(`Computed session split: grid=${formatWh(sessionSplitState.gridWh)}, surplus=${formatWh(getSurplusWh(lastWh, sessionSplitState.gridWh))}`);
      }

      if (firstEto !== null && lastEto !== null) {
        console.log(`Lifetime eto: ${firstEto} -> ${lastEto} (delta ${formatWh(lastEto - firstEto)})`);
      }
      if (lifetimeSplitState) {
        console.log(`Computed lifetime split: grid=${formatWh(lifetimeSplitState.gridWh)}, surplus=${formatWh(getSurplusWh(lastEto, lifetimeSplitState.gridWh))}`);
      }

      const seenCards = cardSummaries.filter(Boolean);
      if (seenCards.length === 0) {
        console.log('No configured RFID cards seen during this run.');
      } else {
        console.log('Per-card totals:');
        for (const card of seenCards) {
          const state = cardSplitStates[card.slot - 1];
          const delta = card.lastWh - card.firstWh;
          console.log(
            `  #${card.slot} (${card.label}): ${card.firstWh} -> ${card.lastWh} (delta ${formatWh(delta)}), `
            + `grid=${formatWh(state.gridWh)}, surplus=${formatWh(getSurplusWh(card.lastWh, state.gridWh))}`
          );
        }
      }

      console.log(`Log file: ${outFile}`);
      process.exit(0);
    });
  }

  process.on('SIGINT', () => stop('Ctrl+C'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
