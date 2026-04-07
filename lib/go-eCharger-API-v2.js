'use strict';

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

/**
 * Local API client for a go-e Charger.
 *
 * @example
 * const api = new goeChargerLocalApi('192.168.1.50', driver, ['alw', 'amp', 'nrg']);
 * const status = await api.getStatus();
 * await api.setValue('alw', 1);
 */
class goeChargerLocalApi {
  /**
   * @param {string} address Charger hostname or IP address.
   * @param {object} driver Driver instance that owns this API client.
   * @param {string[]} attributes Attribute keys to request in `getStatus()`,
   * for example: ['sse', 'fna', 'car', 'alw', 'acs', 'frc', 'trx', 'cards', 'err', 'wh', 'pha', 'nrg', 'eto', 'tma', 'amp', 'ama', 'fsp', 'cbl'].
   */
  constructor(address, driver, attributes) {
    this.address = address;
    this.driver = driver;
    this.attributes = attributes;
  }

  /**
   * Test connectivity to the charger.
   *
   * @returns {Promise<boolean>} `true` when reachable, otherwise `false`.
   */
  async testConnection() {
    try {
      const response = await fetch(`http://${this.address}/api/status?filter=fna`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch current charger status using the configured attribute filter.
   *
   * @returns {Promise<object>} Parsed status payload from the charger.
   */
  async getStatus() {
    const response = await fetch(`http://${this.address}/api/status?filter=${this.attributes.join(',')}`, { method: 'GET' });
    if (!response.ok) {
      return Promise.reject('Could not connect to go-eCharger at ' + this.address);
    }
    const txt = await response.text();

    return Promise.resolve(JSON.parse(txt));
  }

  /**
   * Set a single charger value through the local API.
   *
   * @param {string} key API key to set, for example `alw`.
   * @param {string|number|boolean} value Value to assign to the key.
   * @returns {Promise<object>} Parsed response payload from the charger.
   */
  async setValue(key, value) {
    const response = await fetch(`http://${this.address}/api/set?${key}=${value}`, { method: 'GET' });
    if (!response.ok) {
      return Promise.reject('Could not connect to go-eCharger at ' + this.address);
    }
    const txt = await response.text();

    return Promise.resolve(JSON.parse(txt));
  }

  /**
   * Convert a target power in watts to charger amp + phase config.
   * Prefers 3-phase above 1-phase max (16A × 230V = 3680W) to keep the
   * 3-phase system balanced. 1-phase is only used in the range 1380–3680W
   * where 3-phase cannot go lower than 3P 6A (4140W).
   *
   * @param {number} watts Target power in watts (0 = force off).
   * @param {number} [maxAmps=16] Maximum ampere limit of the charger (16 for 11kW, 32 for 22kW).
   * @returns {{ amp: number, fsp: boolean } | { frc: number }} Charger config to apply.
   */
  wattsToChargerConfig(watts, maxAmps = 16) {
    const MAX_1P_W = 16 * 230; // 3680W — above this always prefer 3-phase

    if (watts <= 0) {
      return { frc: 1 };
    } else if (watts <= MAX_1P_W) {
      // 1-phase only zone: clamp to 6–16A
      const amp = Math.max(6, Math.min(16, Math.round(watts / 230)));
      return { amp, fsp: true };
    } else {
      // 3-phase preferred; gap step (3681–4139W) rounds to amp=6 → 3P 6A (4140W)
      const amp = Math.max(6, Math.min(maxAmps, Math.round(watts / 690)));
      return { amp, fsp: false };
    }
  }

  /**
   * Convert charger amp + phase state back to watts.
   *
   * @param {number} amp Current requested ampere from the charger.
   * @param {boolean} fsp Force single phase flag from the charger.
   * @returns {number} Equivalent power in watts.
   */
  chargerConfigToWatts(amp, fsp) {
    return fsp ? amp * 230 : amp * 690;
  }

  /**
   * Set the target charging power on the charger.
   * Converts watts to amp + phase config and applies both in sequence.
   * Pass 0 to force the charger off.
   *
   * @param {number} watts Target power in watts.
   * @param {number} [maxAmps=16] Maximum ampere limit of the charger.
   * @returns {Promise<void>}
   */
  async setChargerPower(watts, maxAmps = 16) {
    const config = this.wattsToChargerConfig(watts, maxAmps);

    if (config.frc !== undefined) {
      await this.setValue('frc', config.frc);
    } else {
      await this.setValue('amp', config.amp);
      await this.setValue('fsp', config.fsp);
    }
  }
}

module.exports = goeChargerLocalApi;
