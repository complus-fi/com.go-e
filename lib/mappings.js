/**
 * API Mappings
 * Defines mappings between raw go-eCharger API keys and Homey capabilities,
 */
const { round } = require('./helpers');

const GOE_CHARGER_MODE = {
  BASIC_CHARGING: 'basic_charging',
  ECO_PV_SURPLUS: 'eco_pv_surplus',
  ECO_FLEXIBLE_PRICE: 'eco_flexible_price',
  ECO_PV_AND_FLEXIBLE_PRICE: 'eco_pv_and_flexible_price',
  TRIP_PV_SURPLUS: 'trip_pv_surplus',
  TRIP_FLEXIBLE_PRICE: 'trip_flexible_price',
  TRIP_PV_AND_FLEXIBLE_PRICE: 'trip_pv_and_flexible_price',
  TRIP_NO_PV_NO_FLEXIBLE_PRICE: 'trip_no_pv_no_flexible_price'
};

const GOE_TRANSACTION = {
  NONE: 'no_auth',
  ANONYMOUS: 'anonymous',
  CARD_1: 'card_1',
  CARD_2: 'card_2',
  CARD_3: 'card_3',
  CARD_4: 'card_4',
  CARD_5: 'card_5',
  CARD_6: 'card_6',
  CARD_7: 'card_7',
  CARD_8: 'card_8',
  CARD_9: 'card_9',
  CARD_10: 'card_10'
};

const SINGLE_PHASE_VOLTAGE = 230;
const THREE_PHASE_VOLTAGE = 690;
const DEFAULT_SPL3_THRESHOLD_W = 4140;
const TARGET_POWER_PHASE_SWITCH_THRESHOLD_W = DEFAULT_SPL3_THRESHOLD_W;
const MIN_CHARGING_AMP = 6;
const DEFAULT_MAX_CHARGING_AMP = 16;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getMaxChargingAmp(context = {}) {
  const parsed = Number(context.maxAmps);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_CHARGING_AMP;
  return Math.max(MIN_CHARGING_AMP, Math.trunc(parsed));
}

function targetPowerToApiValues(targetPower, context = {}) {
  const watts = Number(targetPower);
  if (!Number.isFinite(watts)) {
    throw new Error('target_power must be a number');
  }

  if (watts < 0) {
    throw new Error('target_power must be zero or positive for unidirectional charging');
  }

  if (watts === 0) {
    return {};
  }

  const maxAmps = getMaxChargingAmp(context);
  const useSinglePhase = watts < TARGET_POWER_PHASE_SWITCH_THRESHOLD_W;
  const divisor = useSinglePhase ? SINGLE_PHASE_VOLTAGE : THREE_PHASE_VOLTAGE;
  const calculatedAmp = Math.floor(watts / divisor);
  const amp = clamp(calculatedAmp, MIN_CHARGING_AMP, maxAmps);

  return {
    psm: useSinglePhase ? 1 : 2,
    amp
  };
}

function apiValuesToTargetPower(status = {}) {
  const amp = Number(status.amp);
  if (!Number.isFinite(amp)) return {};

  const singlePhase = Number(status.psm) === 1;
  return {
    target_power: singlePhase ? amp * SINGLE_PHASE_VOLTAGE : amp * THREE_PHASE_VOLTAGE
  };
}

const GOE_TRANSACTION_LABELS = {
  [GOE_TRANSACTION.NONE]: 'No authentication',
  [GOE_TRANSACTION.ANONYMOUS]: 'Anonymous',
  [GOE_TRANSACTION.CARD_1]: '1st Card',
  [GOE_TRANSACTION.CARD_2]: '2nd Card',
  [GOE_TRANSACTION.CARD_3]: '3rd Card',
  [GOE_TRANSACTION.CARD_4]: '4th Card',
  [GOE_TRANSACTION.CARD_5]: '5th Card',
  [GOE_TRANSACTION.CARD_6]: '6th Card',
  [GOE_TRANSACTION.CARD_7]: '7th Card',
  [GOE_TRANSACTION.CARD_8]: '8th Card',
  [GOE_TRANSACTION.CARD_9]: '9th Card',
  [GOE_TRANSACTION.CARD_10]: '10th Card'
};

function getTransactionCapabilityIdFromTrx(trx, options = {}) {
  const { configuredEntries = null, invalidFallback = null } = options;

  if (trx === null || trx === undefined || trx === '') {
    return GOE_TRANSACTION.NONE;
  }

  const parsed = Number(trx);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) {
    return invalidFallback;
  }

  if (parsed === 0) {
    return GOE_TRANSACTION.ANONYMOUS;
  }

  if (Array.isArray(configuredEntries)) {
    const dynamicEntry = configuredEntries.find((entry) => entry.slot === parsed);
    if (dynamicEntry?.id) {
      return dynamicEntry.id;
    }
  }

  return `card_${parsed}`;
}

function getTransactionApiValue(transaction) {
  if (transaction === GOE_TRANSACTION.ANONYMOUS) {
    return 0;
  }

  if (transaction === GOE_TRANSACTION.NONE) {
    return null;
  }

  const match = /^card_(\d+)$/.exec(String(transaction));
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10) {
    return null;
  }

  return parsed;
}

function getTransactionLabel(transaction) {
  return GOE_TRANSACTION_LABELS[transaction] || String(transaction || '');
}

function getTransactionCardNameBySlot(status = {}, cardIndex) {
  if (!Number.isInteger(cardIndex) || cardIndex < 1 || cardIndex > 10) {
    return 'Unknown';
  }

  const cardNameKey = `c${cardIndex - 1}n`;
  return getCardSpecificName(status[cardNameKey], cardIndex);
}

function getTransactionCardName(status = {}) {
  const transaction = getTransactionCapabilityIdFromTrx(status.trx);
  if (!transaction) {
    return 'Unknown';
  }

  if (transaction === GOE_TRANSACTION.NONE) {
    return 'No authentication';
  }

  if (transaction === GOE_TRANSACTION.ANONYMOUS) {
    return 'Anonymous';
  }

  const match = /^card_(\d+)$/.exec(transaction);
  if (!match) {
    return getTransactionLabel(transaction);
  }

  const cardIndex = Number(match[1]);
  if (!Number.isInteger(cardIndex) || cardIndex < 1 || cardIndex > 10) {
    return getTransactionLabel(transaction);
  }

  return getTransactionCardNameBySlot(status, cardIndex);
}

function getTransactionCardApiKeys() {
  const apiKeys = [];
  for (let index = 0; index < 10; index += 1) {
    apiKeys.push(`c${index}n`, `c${index}e`, `c${index}i`);
  }
  return apiKeys;
}

function getTransactionCardApiKeysForConfiguredCards(cardConfiguredFlags = []) {
  const apiKeys = [];
  for (let index = 0; index < 10; index += 1) {
    apiKeys.push(`c${index}i`);
    if (cardConfiguredFlags[index] === true) {
      apiKeys.push(`c${index}n`, `c${index}e`);
    }
  }
  return apiKeys;
}

function hasCardSpecificCapabilities(capabilities = []) {
  return capabilities.some((capability) => {
    return /^meter_power\.(10|[1-9])$/.test(capability) || /^meter_power\.(10|[1-9])_(pv|grid)$/.test(capability) || /^goe_meter_power_name\.(10|[1-9])$/.test(capability);
  });
}

function getCardSpecificName(value, cardIndex) {
  if (typeof value !== 'string') return `Card ${cardIndex}`;
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === 'n/a') {
    return `Card ${cardIndex}`;
  }
  return normalized;
}

function getChargerModeFromStatus(status = {}) {
  const lmo = Number(status.lmo);
  const fup = Boolean(status.fup);
  const awe = Boolean(status.awe);

  if (!Number.isFinite(lmo)) return null;

  if (lmo === 3) {
    return GOE_CHARGER_MODE.BASIC_CHARGING;
  }

  if (lmo === 4) {
    if (fup && awe) return GOE_CHARGER_MODE.ECO_PV_AND_FLEXIBLE_PRICE;
    if (fup) return GOE_CHARGER_MODE.ECO_PV_SURPLUS;
    if (awe) return GOE_CHARGER_MODE.ECO_FLEXIBLE_PRICE;
    return null;
  }

  if (lmo === 5) {
    if (fup && awe) return GOE_CHARGER_MODE.TRIP_PV_AND_FLEXIBLE_PRICE;
    if (fup) return GOE_CHARGER_MODE.TRIP_PV_SURPLUS;
    if (awe) return GOE_CHARGER_MODE.TRIP_FLEXIBLE_PRICE;
    return GOE_CHARGER_MODE.TRIP_NO_PV_NO_FLEXIBLE_PRICE;
  }

  return null;
}

function getApiValuesForChargerMode(mode, context = {}) {
  const base = {
    [GOE_CHARGER_MODE.BASIC_CHARGING]: {
      lmo: 3,
      fup: false,
      awe: false
    },
    [GOE_CHARGER_MODE.ECO_PV_SURPLUS]: {
      lmo: 4,
      fup: true,
      awe: false
    },
    [GOE_CHARGER_MODE.ECO_FLEXIBLE_PRICE]: {
      lmo: 4,
      fup: false,
      awe: true
    },
    [GOE_CHARGER_MODE.ECO_PV_AND_FLEXIBLE_PRICE]: {
      lmo: 4,
      fup: true,
      awe: true
    },
    [GOE_CHARGER_MODE.TRIP_PV_SURPLUS]: {
      lmo: 5,
      fup: true,
      awe: false
    },
    [GOE_CHARGER_MODE.TRIP_FLEXIBLE_PRICE]: {
      lmo: 5,
      fup: false,
      awe: true
    },
    [GOE_CHARGER_MODE.TRIP_PV_AND_FLEXIBLE_PRICE]: {
      lmo: 5,
      fup: true,
      awe: true
    },
    [GOE_CHARGER_MODE.TRIP_NO_PV_NO_FLEXIBLE_PRICE]: {
      lmo: 5,
      fup: false,
      awe: false
    }
  };

  const selected = base[mode];
  if (!selected) return {};

  if (mode === GOE_CHARGER_MODE.BASIC_CHARGING) {
    const targetPower = Number(context.targetPower);
    const psm = Number.isFinite(targetPower) && targetPower > 0 ? (targetPower < TARGET_POWER_PHASE_SWITCH_THRESHOLD_W ? 1 : 2) : 0;
    return { ...selected, psm };
  }

  if (!selected.fup) {
    return { ...selected, psm: 0 };
  }

  return {
    ...selected,
    psm: 0,
    pgt: -200,
    frm: 2,
    spl3: context.spl3Threshold ?? DEFAULT_SPL3_THRESHOLD_W
  };
}

/**
 * Capability Map
 * - Tuple: [homeyCapability, apiToHomey, homeyToApi?]
 * - Object: { apiKeys, homeyCapabilities, apiToHomey, homeyToApi? }
 */
const capabilityMap = {
  alw: {
    apiKeys: ['alw', 'trx'],
    requiredApiKeys: ['alw'],
    homeyCapabilities: ['evcharger_charging'],
    apiToHomey: (status) => ({
      evcharger_charging: Boolean(status.alw)
    }),
    homeyToApi: (values, getCapValue, context = {}) => {
      if (values.evcharger_charging === false) {
        return { frc: 1 };
      }

      if (values.evcharger_charging === true) {
        const trx = context.status?.trx;
        if (trx === null || trx === undefined) {
          return { trx: 0, frc: 2 };
        }

        return { frc: 2 };
      }

      return {};
    }
  },
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
  goe_charger_mode: {
    apiKeys: ['lmo', 'fup', 'awe'],
    homeyCapabilities: ['goe_charger_mode'],
    apiToHomey: (status) => {
      const mode = getChargerModeFromStatus(status);
      return mode ? { goe_charger_mode: mode } : {};
    },
    homeyToApi: (values, getCapValue, context = {}) => getApiValuesForChargerMode(values.goe_charger_mode, context)
  },
  goe_transaction: {
    apiKeys: ['trx'],
    homeyCapabilities: ['goe_transaction'],
    apiToHomey: (status) => {
      const transaction = getTransactionCapabilityIdFromTrx(status.trx);
      return transaction ? { goe_transaction: transaction } : {};
    }
  },
  goe_measure_phase_switching: {
    apiKeys: ['psm'],
    homeyCapabilities: ['goe_measure_phase_switching'],
    apiToHomey: (status) => {
      const parsed = Number(status.psm);
      if (!Number.isFinite(parsed)) return {};
      if (parsed < 0 || parsed > 2) return {};

      return {
        goe_measure_phase_switching: String(Math.trunc(parsed))
      };
    }
  },
  target_power: {
    apiKeys: ['amp', 'psm'],
    homeyCapabilities: ['target_power'],
    apiToHomey: (status) => apiValuesToTargetPower(status),
    homeyToApi: (values, getCapValue, context = {}) => targetPowerToApiValues(values.target_power, context)
  },
  pakku: {
    apiKeys: ['pakku'],
    homeyCapabilities: ['measure_power.pakku'],
    apiToHomey: (status) => {
      const parsed = Number(status.pakku);
      return {
        'measure_power.pakku': Number.isFinite(parsed) ? round(parsed, 2) : 0
      };
    }
  },
  pgrid: {
    apiKeys: ['pgrid'],
    homeyCapabilities: ['measure_power.pgrid'],
    apiToHomey: (status) => {
      const parsed = Number(status.pgrid);
      return {
        'measure_power.pgrid': Number.isFinite(parsed) ? round(parsed, 2) : 0
      };
    }
  },
  ppv: {
    apiKeys: ['ppv'],
    homeyCapabilities: ['measure_power.ppv'],
    apiToHomey: (status) => {
      const parsed = Number(status.ppv);
      return {
        'measure_power.ppv': Number.isFinite(parsed) ? round(parsed, 2) : 0
      };
    }
  },
  awcp: {
    apiKeys: ['awcp'],
    homeyCapabilities: ['goe_flexible_rate'],
    apiToHomey: (status) => {
      const marketPrice = Number(status.awcp?.marketprice ?? status.awcp);
      if (!Number.isFinite(marketPrice)) return {};

      return {
        goe_flexible_rate: marketPrice / 100
      };
    }
  },
  awp: {
    apiKeys: ['awp'],
    homeyCapabilities: ['goe_flexible_rate_limit'],
    apiToHomey: (status) => {
      const cents = Number(status.awp);
      if (!Number.isFinite(cents)) return {};

      return {
        goe_flexible_rate_limit: cents / 100
      };
    },
    homeyToApi: (values) => {
      const euros = Number(values.goe_flexible_rate_limit);
      if (!Number.isFinite(euros) || euros < 0) {
        throw new Error('goe_flexible_rate_limit must be a non-negative number');
      }

      return {
        awp: euros * 100
      };
    }
  },
  modelStatus: {
    apiKeys: ['modelStatus'],
    homeyCapabilities: ['goe_measure_modelStatus'],
    apiToHomey: (status) => {
      const parsed = Number(status.modelStatus);
      if (!Number.isFinite(parsed)) return {};
      if (parsed < 0 || parsed > 41) return {};

      const code = String(Math.trunc(parsed));
      return {
        goe_measure_modelStatus: code
      };
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

  if (capabilities.includes('goe_transaction') || capabilities.includes('goe_transaction_name') || capabilities.includes('goe_meter_power_name') || hasCardSpecificCapabilities(capabilities)) {
    const configuredFlags = Array.isArray(context.cardConfiguredFlags) ? context.cardConfiguredFlags : [];
    const hasKnownCardState = configuredFlags.some((value) => value === true || value === false);
    const cardApiKeys = hasKnownCardState ? getTransactionCardApiKeysForConfiguredCards(configuredFlags) : getTransactionCardApiKeys();
    cardApiKeys.forEach((apiKey) => apiKeys.add(apiKey));
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

  for (let cardIndex = 1; cardIndex <= 10; cardIndex += 1) {
    const statusIndex = cardIndex - 1;
    const energyCapability = `meter_power.${cardIndex}`;
    const nameCapability = `goe_meter_power_name.${cardIndex}`;
    const energyKey = `c${statusIndex}e`;
    const nameKey = `c${statusIndex}n`;

    if (capabilities.includes(energyCapability)) {
      const energyWh = Number(status[energyKey]);
      mappedValues[energyCapability] = Number.isFinite(energyWh) ? round(energyWh / 1000, 2) : 0;
    }

    if (capabilities.includes(nameCapability)) {
      mappedValues[nameCapability] = getCardSpecificName(status[nameKey], cardIndex);
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
 * Status Map
 * Maps car API key numeric values to Homey `evcharger_charging_state` enum values.
 * Homey supports also plugged_in_discharging state, but go-eCharger does not report it.
 * This is also overriden in the driver template.
 */
const statusMap = {
  1: 'plugged_out',
  2: 'plugged_in_charging',
  3: 'plugged_in_paused',
  4: 'plugged_in'
};

/**
 * Device type/subtype to icon mapping.
 * Entries are matched in order; first match wins.
 * `devicesubtype` is optional and tested as a RegExp when present.
 * Icon paths are relative to /drivers/<driver_id>/assets/.
 *
 * Known mDNS TXT values:
 *   go-eCharger_Pro     -> CORE hardware
 *   go-eCharger_V4/V5   -> Gemini hardware
 *   go-eCharger_Phoenix + devicesubtype ^pro  -> PRO hardware
 */
const deviceTypeIconMap = [
  { devicetype: 'go-eCharger_Phoenix', devicesubtype: /^pro/i, icon: '../../assets/go-echarger_pro.svg' },
  { devicetype: 'go-eCharger_Pro', icon: '../../assets/go-echarger_core.svg' },
  { devicetype: 'go-eCharger_V4', icon: '../../assets/go-echarger_gemini.svg' },
  { devicetype: 'go-eCharger_V5', icon: '../../assets/go-echarger_gemini.svg' },
  { devicetype: 'go-eCharger_V3', icon: '../../assets/go-echarger_homeplus.svg' }
];

const modelDiscoveryMatchers = {
  homeplus: ({ devicetype }) => devicetype === 'go-eCharger_V3',
  gemini: ({ devicetype }) => devicetype === 'go-eCharger_V4' || devicetype === 'go-eCharger_V5',
  core: ({ devicetype }) => devicetype === 'go-eCharger_Pro',
  pro: ({ devicetype, devicesubtype }) => devicetype === 'go-eCharger_Phoenix' && /^pro/i.test(devicesubtype || '')
};

const driverModelMap = {
  'go-eCharger-Homeplus': 'homeplus',
  'go-eCharger-Gemini': 'gemini',
  'go-eCharger-CORE': 'core',
  'go-eCharger-PRO': 'pro',
  'goe-Cloud-Homeplus': 'homeplus',
  'goe-Cloud-Gemini': 'gemini',
  'goe-Cloud-CORE': 'core',
  'goe-Cloud-PRO': 'pro'
};

const DEVICE_ICON_FALLBACK = 'icon.svg';

/**
 * Resolve the pairing-list icon path for a discovered device.
 *
 * @param {string}  devicetype    txt.devicetype from the mDNS TXT record.
 * @param {string}  [devicesubtype] txt.devicesubtype from the mDNS TXT record (optional).
 * @returns {string} Icon path relative to /drivers/<driver_id>/assets/.
 */
function getDeviceIcon(devicetype, devicesubtype) {
  for (const entry of deviceTypeIconMap) {
    if (entry.devicetype !== devicetype) continue;
    if (entry.devicesubtype && !entry.devicesubtype.test(devicesubtype || '')) continue;
    return entry.icon;
  }
  return DEVICE_ICON_FALLBACK;
}

function getModelFromDriverId(driverId = '') {
  return driverModelMap[driverId] || null;
}

function matchesDiscoveryModel(discoveryResult = {}, model = null) {
  if (!model) return true;

  const matcher = modelDiscoveryMatchers[model];
  if (!matcher) return true;

  const txt = discoveryResult.txt || {};
  return matcher({
    devicetype: txt.devicetype || '',
    devicesubtype: txt.devicesubtype || ''
  });
}

module.exports = {
  DEFAULT_SPL3_THRESHOLD_W,
  GOE_CHARGER_MODE,
  GOE_TRANSACTION,
  SINGLE_PHASE_VOLTAGE,
  THREE_PHASE_VOLTAGE,
  capabilityMap,
  deviceTypeIconMap,
  driverModelMap,
  getModelFromDriverId,
  getDeviceIcon,
  getStatusAttributes,
  getTransactionCardApiKeys,
  getTransactionCardName,
  getTransactionCardNameBySlot,
  getTransactionCapabilityIdFromTrx,
  getTransactionApiValue,
  getTransactionLabel,
  matchesDiscoveryModel,
  mapHomeyToApiValues,
  mapStatusToCapabilities,
  statusMap
};
