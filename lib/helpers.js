'use strict';

const util = require('util');

function formatIdsForLog(ids) {
  if (!ids || typeof ids !== 'object' || Array.isArray(ids)) {
    return util.inspect(ids, { depth: null, compact: true, breakLength: Infinity });
  }

  const preferredKeys = ['pakku', 'pgrid', 'ppv'];
  const orderedEntries = [];

  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(ids, key)) {
      orderedEntries.push([key, ids[key]]);
    }
  }

  for (const [key, value] of Object.entries(ids)) {
    if (preferredKeys.includes(key)) continue;
    orderedEntries.push([key, value]);
  }

  const inline = orderedEntries.map(([key, value]) => `${key}: ${util.inspect(value, { depth: null, compact: true, breakLength: Infinity })}`);
  return `{ ${inline.join(', ')} }`;
}

exports.round = function (value, decimals = 2) {
  return Number(Number(value).toFixed(decimals));
};

exports.parseVersion = function (version) {
  if (!version) return [];
  return String(version)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number(part));
};

exports.isVersionAtLeast = function (version, minVersion) {
  const a = exports.parseVersion(version);
  const b = exports.parseVersion(minVersion);
  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return true;
};

exports.formatStatusForLog = function (status) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return util.inspect(status, { depth: null, compact: true, breakLength: Infinity });
  }

  const formattedEntries = [];
  const groupedCards = {};
  const idsFromTopLevel = {};
  const topLevelIdsKeys = new Set(['pakku', 'pgrid', 'ppv']);

  for (const [key, value] of Object.entries(status)) {
    if (topLevelIdsKeys.has(key)) {
      idsFromTopLevel[key] = value;
      continue;
    }

    const cardMatch = /^c(\d+)([ien])$/.exec(key);
    if (!cardMatch) {
      formattedEntries.push([key, value]);
      continue;
    }

    const [, index] = cardMatch;
    const cardIndex = Number(index);
    if (!groupedCards[cardIndex]) {
      groupedCards[cardIndex] = {};
    }
    groupedCards[cardIndex][key] = value;
  }

  const groupedCardIndexes = Object.keys(groupedCards)
    .map((index) => Number(index))
    .sort((a, b) => a - b);

  const lines = ['{'];
  if (Object.keys(idsFromTopLevel).length > 0) {
    lines.push(`  ids: ${formatIdsForLog(idsFromTopLevel)},`);
  }

  for (const [key, value] of formattedEntries) {
    if (key === 'ids') {
      lines.push(`  ${key}: ${formatIdsForLog(value)},`);
      continue;
    }
    lines.push(`  ${key}: ${util.inspect(value, { depth: null, compact: true, breakLength: 120 })},`);
  }

  if (groupedCardIndexes.length > 0) {
    lines.push('  cards: [');

    const cards = groupedCardIndexes.map((cardIndex) => groupedCards[cardIndex]);
    for (let i = 0; i < cards.length; i += 2) {
      const left = util.inspect(cards[i], { depth: null, compact: true, breakLength: Infinity });
      const right = cards[i + 1] ? `, ${util.inspect(cards[i + 1], { depth: null, compact: true, breakLength: Infinity })}` : '';
      lines.push(`    ${left}${right},`);
    }

    lines.push('  ],');
  }

  lines.push('}');

  return lines.join('\n');
};
