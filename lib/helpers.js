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

// Group the go-e `nrg` array into its labelled sections for readable logs.
function formatNrgForLog(nrg) {
  if (!Array.isArray(nrg)) {
    return util.inspect(nrg, { depth: null, compact: true, breakLength: Infinity });
  }

  const groups = [
    { label: 'U', values: nrg.slice(0, 4) },
    { label: 'I', values: nrg.slice(4, 7) },
    { label: 'P', values: nrg.slice(7, 12) },
    { label: 'pf', values: nrg.slice(12, 16) }
  ];

  const extra = nrg.slice(16);
  if (extra.length > 0) {
    groups.push({ label: '…', values: extra });
  }

  const labelWidth = Math.max(...groups.map((group) => group.label.length));
  const lines = groups.map((group) => {
    const values = util.inspect(group.values, { depth: null, compact: true, breakLength: Infinity });
    return `    ${group.label.padEnd(labelWidth)}: ${values}`;
  });

  return `[\n${lines.join(',\n')}\n  ]`;
}

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
    formattedEntries.push(['ids', idsFromTopLevel]);
  }

  const isMultiValue = (value) => Array.isArray(value) || (value !== null && typeof value === 'object');
  const orderedEntries = [...formattedEntries.filter(([, value]) => !isMultiValue(value)), ...formattedEntries.filter(([, value]) => isMultiValue(value))];

  for (const [key, value] of orderedEntries) {
    if (key === 'ids') {
      lines.push(`  ${key}: ${formatIdsForLog(value)},`);
      continue;
    }
    if (key === 'nrg') {
      lines.push(`  ${key}: ${formatNrgForLog(value)},`);
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
