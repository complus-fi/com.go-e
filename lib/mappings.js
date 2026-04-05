/**
 * API Mappings
 * Defines mappings between raw go-eCharger API keys and Homey capabilities,
 * plus RFID card attribute mappings for firmware 60.0+
 */

/**
 * Capability Map
 * Maps raw go-eCharger API keys to Homey capabilities where a mapping exists.
 */
const capabilityMap = {
  sse: null, // device serial number
  fna: null, // device friendly name
  car: null, // carState, null if internal error (Unknown/Error=0, Idle=1, Charging=2, WaitCar=3, Complete=4, Error=5)
  alw: 'onoff', // Is the car allowed to charge at all now?
  acs: null, // access_control user setting (Open=0, Wait=1)
  frc: null, // forceState (Neutral=0, Off=1, On=2)
  trx: null, // transaction, null when no transaction, 0 when without card, otherwise cardInde x + 1 (1: 0. card, 2: 1. card, ...)
  wh: 'meter_power.charged', // energy in Wh since car connected
  pha: null, // phase-state flags only [false, false, false, true, true, true] first three values are for L1-L3 output, last three values are for L1-L3 input, true if phase is active
  nrg: null, // energy array, U (L1, L2, L3, N), I (L1, L2, L3), P (L1, L2, L3, N, Total), pf (L1, L2, L3, N)
  eto: 'meter_power', // energy_total, measured in Wh
  tma: ['measure_temperature', 'measure_temperature.charge_port', 'measure_temperature_2', 'measure_temperature_3'], // Temperature values from device.
  amp: null, // requestedCurrent in Ampere, used for display on LED ring and logic calculations
  ama: null, // ampere_max limit
  fsp: null, // force_single_phase (boolean, true if the charger is currently forced to single phase mode)
  cbl: null // cable_limit ampers, not avaible on firmware 60.0 and above
};

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
 * Maps car API key numeric values to device status strings
 */
const statusMap = {
  1: 'station_idle',
  2: 'car_charging',
  3: 'station_waiting',
  4: 'car_finished',
  5: 'station_error'
};

module.exports = {
  capabilityMap,
  rfidCards,
  statusMap
};
