'use strict';

const util = require('util');

/**
 * Format a transaction timestamp for Homey capability display.
 *
 * @param {Date} date Date to format.
 * @param {string|null} timezone IANA timezone name.
 * @returns {string} Formatted timestamp.
 */
function formatTransactionDateTime(date = new Date(), timezone = null) {
  const normalizedTimezone = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : null;
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  };

  if (normalizedTimezone) {
    options.timeZone = normalizedTimezone;
  }

  const formatter = new Intl.DateTimeFormat('en-GB', options);
  const parts = formatter.formatToParts(date);
  const byType = {};

  for (const part of parts) {
    byType[part.type] = part.value;
  }

  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
}

/**
 * Parse a formatted transaction timestamp.
 *
 * @param {string} value Formatted timestamp.
 * @returns {number|null} Parsed timestamp in milliseconds.
 */
function parseTransactionStart(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) return null;

  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`);
  const timestamp = parsed.getTime();
  if (!Number.isFinite(timestamp)) return null;
  return timestamp;
}

/**
 * Parse a Homey flow time argument to seconds since local midnight.
 *
 * @param {string|Date|object} value Flow card time value.
 * @returns {number} Seconds since midnight.
 */
function parseTimeArgToLocalSeconds(value) {
  let hours = null;
  let minutes = null;
  let seconds = 0;

  if (value instanceof Date) {
    hours = value.getHours();
    minutes = value.getMinutes();
    seconds = value.getSeconds();
  } else if (typeof value === 'string') {
    const normalized = value.trim();
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
    if (match) {
      hours = Number(match[1]);
      minutes = Number(match[2]);
      seconds = match[3] !== undefined ? Number(match[3]) : 0;
    }
  } else if (value && typeof value === 'object') {
    const rawHours = value.hour ?? value.hours ?? value.h;
    const rawMinutes = value.minute ?? value.minutes ?? value.min ?? value.m;
    const rawSeconds = value.second ?? value.seconds ?? value.s;
    hours = Number(rawHours);
    minutes = Number(rawMinutes);
    seconds = rawSeconds === undefined ? 0 : Number(rawSeconds);
  }

  return (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
}

/**
 * Format a transaction duration in milliseconds as HH:mm:ss.
 *
 * @param {number} durationMs Duration in milliseconds.
 * @returns {string} Formatted duration.
 */
function formatTransactionDuration(durationMs) {
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(safeDuration / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

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

exports.formatTransactionDateTime = formatTransactionDateTime;
exports.formatTransactionDuration = formatTransactionDuration;
exports.parseTimeArgToLocalSeconds = parseTimeArgToLocalSeconds;
exports.parseTransactionStart = parseTransactionStart;
