/**
 * API Mappings
 * Defines mappings between raw go-eCharger API keys and Homey capabilities,
 */
const { round } = require('./helpers');

/**
 * Capability Map
 * - Tuple: [homeyCapability, apiToHomey, homeyToApi?]
 * - Object: { apiKeys, homeyCapabilities, apiToHomey, homeyToApi? }
 */
const capabilityMap = {
  alw: [
    'evcharger_charging',
    (value) => Boolean(value),
    (value, getCapValue) => {
      if (value === false) return { frc: 1 };

      const targetPowerMode = typeof getCapValue === 'function' ? getCapValue('target_power_mode') : undefined;
      return { frc: targetPowerMode === 'device' ? 0 : 2 };
    }
  ],
  car: {
    apiKeys: ['car'],
    homeyCapabilities: ['alarm_problem', 'evcharger_charging_state'],
    apiToHomey: (status) => ({
      alarm_problem: status.car === 5,
      evcharger_charging_state: status.car === 5 ? null : statusMap[status.car] || null
    })
  },
  eto: ['meter_power', (value) => (Number(value) > 0 ? round(Number(value) / 1000, 2) : null)],
  wh: ['meter_power.session', (value) => round(Number(value) / 1000, 2)],
  tma: {
    apiKeys: ['tma'],
    homeyCapabilities: ['measure_temperature'],
    apiToHomey: (status) => {
      if (!Array.isArray(status.tma)) return {};

      const nonZeroTemperatures = status.tma.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value !== 0);

      if (nonZeroTemperatures.length === 0) {
        return { measure_temperature: 0 };
      }

      const average = nonZeroTemperatures.reduce((sum, value) => sum + value, 0) / nonZeroTemperatures.length;
      return { measure_temperature: round(average, 1) };
    }
  },
  target_power: {
    apiKeys: ['amp', 'psm'],
    requiredApiKeys: ['amp', 'psm'],
    homeyCapabilities: ['target_power'],
    apiToHomey: (status, api) => {
      // psm 1=single phase, 2=three phase, 0=automatic.
      const isSinglePhase = Number(status.psm) === 1;

      return {
        target_power: api.chargerConfigToWatts(status.amp, isSinglePhase)
      };
    },
    homeyToApi: (values, getCapValue, context = {}) => {
      const api = context.api;
      if (!api || values.target_power === undefined || values.target_power === null) return null;

      const maxAmps = context.maxAmps ?? 16;
      const config = api.wattsToChargerConfig(values.target_power, maxAmps);

      // target_power changes must not control frc (charging state).
      if (config.frc !== undefined) {
        return null;
      }

      // Use psm (1=single phase, 2=three phase) for phase selection.
      if (config.fsp !== undefined) {
        const { fsp, ...rest } = config;
        return { ...rest, psm: fsp ? 1 : 2 };
      }

      return config;
    }
  },
  target_power_mode: {
    apiKeys: [],
    requiredApiKeys: [],
    homeyCapabilities: ['target_power_mode'],
    apiToHomey: () => ({}),
    homeyToApi: (values, getCapValue, context = {}) => {
      if (values.target_power_mode !== 'device') return null;
      return { frc: 0, psm: 0 };
    }
  },
  nrg: {
    apiKeys: ['nrg', 'pha'],
    homeyCapabilities: ['measure_power', 'measure_current', 'measure_voltage', 'measure_voltage.output'],
    apiToHomey: (status) => {
      if (!Array.isArray(status.nrg)) return {};

      const mapped = {};

      const totalPower = Number(status.nrg[11]);
      mapped.measure_power = Number.isFinite(totalPower) ? round(totalPower, 2) : 0;

      let numPhases = 0;
      if (status.nrg[4] > 0) numPhases++;
      if (status.nrg[5] > 0) numPhases++;
      if (status.nrg[6] > 0) numPhases++;
      if (numPhases > 0) {
        const avgCurrent = (status.nrg[4] + status.nrg[5] + status.nrg[6]) / numPhases;
        mapped.measure_current = round(avgCurrent, 2);
      } else {
        mapped.measure_current = 0;
      }

      if (Array.isArray(status.pha)) {
        let vInSum = 0;
        let nInPhases = 0;
        if (status.pha[3]) {
          vInSum += status.nrg[0];
          nInPhases++;
        }
        if (status.pha[4]) {
          vInSum += status.nrg[1];
          nInPhases++;
        }
        if (status.pha[5]) {
          vInSum += status.nrg[2];
          nInPhases++;
        }
        mapped.measure_voltage = nInPhases === 3 ? round((vInSum / nInPhases) * Math.sqrt(3), 2) : vInSum || round(status.nrg[3], 2);

        let vOutSum = 0;
        let nOutPhases = 0;
        if (status.pha[0]) {
          vOutSum += status.nrg[0];
          nOutPhases++;
        }
        if (status.pha[1]) {
          vOutSum += status.nrg[1];
          nOutPhases++;
        }
        if (status.pha[2]) {
          vOutSum += status.nrg[2];
          nOutPhases++;
        }
        if (nOutPhases === 3) {
          mapped['measure_voltage.output'] = round((vOutSum / nOutPhases) * Math.sqrt(3), 2);
        } else if (nOutPhases > 0) {
          mapped['measure_voltage.output'] = round(vOutSum, 2);
        } else {
          mapped['measure_voltage.output'] = 0;
        }
      }

      return mapped;
    }
  }
};

function resolveCapabilityEntry(entry, fallbackAttribute) {
  if (Array.isArray(entry)) {
    const [homeyCapability, apiToHomey, homeyToApi] = entry;
    return {
      apiKeys: [fallbackAttribute],
      requiredApiKeys: [fallbackAttribute],
      homeyCapabilities: [homeyCapability],
      apiToHomey: (status, api) => {
        const converted = apiToHomey(status[fallbackAttribute], status, api);
        return converted === null || converted === undefined ? {} : { [homeyCapability]: converted };
      },
      homeyToApi: homeyToApi ? (values, getCapValue, context) => homeyToApi(values[homeyCapability], getCapValue, context) : undefined
    };
  }
  return {
    ...entry,
    requiredApiKeys: entry.requiredApiKeys || entry.apiKeys
  };
}

function hasRequiredApiKeys(status, apiKeys) {
  return apiKeys.every((apiKey) => status[apiKey] !== undefined);
}

/**
 * Build a filtered status attribute list from Homey capabilities.
 * This keeps API filters in sync with driver capability changes.
 *
 * @param {string[]} capabilities Homey capability ids from device/driver.
 * @param {object} context Mapping context (for example firmware-dependent key selection).
 * @returns {string[]} API status attributes to request.
 */
function getStatusAttributes(capabilities = [], context = {}) {
  const apiKeys = new Set(['frc', 'ama', 'fwv']);

  for (const [mapKey, entry] of Object.entries(capabilityMap)) {
    const resolved = resolveCapabilityEntry(entry, mapKey);
    if (resolved.homeyCapabilities.some((homeyCapability) => capabilities.includes(homeyCapability))) {
      const selectedApiKeys = typeof resolved.apiKeysForContext === 'function' ? resolved.apiKeysForContext(context) : resolved.apiKeys;
      selectedApiKeys.forEach((apiKey) => apiKeys.add(apiKey));
    }
  }

  return Array.from(apiKeys);
}

/**
 * Convert a go-eCharger status payload to Homey capability values.
 *
 * @param {object} status Raw status object from the charger API.
 * @param {string[]} capabilities Homey capability ids on the device.
 * @param {object} api API helper instance for conversion utilities.
 * @returns {object} Capability/value map ready for setCapabilityValue.
 */
function mapStatusToCapabilities(status, capabilities = [], api) {
  const mappedValues = {};

  for (const [mapKey, entry] of Object.entries(capabilityMap)) {
    const resolved = resolveCapabilityEntry(entry, mapKey);
    if (!resolved.homeyCapabilities.some((homeyCapability) => capabilities.includes(homeyCapability))) continue;
    if (!hasRequiredApiKeys(status, resolved.requiredApiKeys)) continue;

    const converted = resolved.apiToHomey(status, api) || {};
    for (const [capability, value] of Object.entries(converted)) {
      if (capabilities.includes(capability)) {
        mappedValues[capability] = value;
      }
    }
  }

  return mappedValues;
}

/**
 * Convert changed Homey capabilities into go-eCharger API values.
 *
 * @param {object} changedValues Changed Homey capability values.
 * @param {string[]} capabilities Homey capability ids on the device.
 * @param {Function} getCapValue Function returning current capability value by id.
 * @param {object} context Extra conversion context (for example api/maxAmps).
 * @returns {object} API key/value pairs to send via setValue.
 */
function mapHomeyToApiValues(changedValues = {}, capabilities = [], getCapValue = () => undefined, context = {}) {
  const apiValues = {};
  const changedCaps = Object.keys(changedValues);

  for (const [mapKey, entry] of Object.entries(capabilityMap)) {
    const resolved = resolveCapabilityEntry(entry, mapKey);
    if (!resolved.homeyToApi) continue;
    if (!resolved.homeyCapabilities.some((homeyCapability) => changedCaps.includes(homeyCapability))) continue;
    if (!resolved.homeyCapabilities.some((homeyCapability) => capabilities.includes(homeyCapability))) continue;

    const mergedValues = {};
    for (const homeyCapability of resolved.homeyCapabilities) {
      mergedValues[homeyCapability] = changedValues[homeyCapability] !== undefined ? changedValues[homeyCapability] : getCapValue(homeyCapability);
    }

    const converted = resolved.homeyToApi(mergedValues, getCapValue, context);
    if (!converted || typeof converted !== 'object') continue;
    Object.assign(apiValues, converted);
  }

  return apiValues;
}

/**
 * RFID Card attribute mapping for firmware 60.0+
 * Individual card attributes replace the legacy cards array
 */
const rfidCards = {
  // Card index 0-9
  0: {
    name: 'c0n', // card name
    energy: 'c0e', // card energy in Wh
    isConfigured: 'c0i' // card ID configured (true/false)
  },
  1: { name: 'c1n', energy: 'c1e', isConfigured: 'c1i' },
  2: { name: 'c2n', energy: 'c2e', isConfigured: 'c2i' },
  3: { name: 'c3n', energy: 'c3e', isConfigured: 'c3i' },
  4: { name: 'c4n', energy: 'c4e', isConfigured: 'c4i' },
  5: { name: 'c5n', energy: 'c5e', isConfigured: 'c5i' },
  6: { name: 'c6n', energy: 'c6e', isConfigured: 'c6i' },
  7: { name: 'c7n', energy: 'c7e', isConfigured: 'c7i' },
  8: { name: 'c8n', energy: 'c8e', isConfigured: 'c8i' },
  9: { name: 'c9n', energy: 'c9e', isConfigured: 'c9i' }
};

/**
 * Status Map
 * Maps car API key numeric values to Homey `evcharger_charging_state` enum values.
 */
const statusMap = {
  1: 'plugged_out',
  2: 'plugged_in_charging',
  3: 'plugged_in_paused',
  4: 'plugged_in'
};

module.exports = {
  capabilityMap,
  getStatusAttributes,
  mapHomeyToApiValues,
  mapStatusToCapabilities,
  rfidCards,
  statusMap
};
