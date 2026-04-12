'use strict';

exports.sleep = async function (ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

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
