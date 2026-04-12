'use strict';

const fetch = globalThis.fetch;

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
   * @param {string[]} apiKeys Attribute keys to request in `getStatus()`,
   * for example: ['sse', 'fna', 'car', 'alw', 'acs', 'frc', 'trx', 'cards', 'err', 'wh', 'pha', 'nrg', 'eto', 'tma', 'amp', 'ama', 'psm', 'fsp', 'cbl'].
   */
  constructor(address, driver, apiKeys) {
    this.address = address;
    this.driver = driver;
    this.apiKeys = apiKeys;
  }

  log(...args) {
    if (this.driver && typeof this.driver.log === 'function') {
      this.driver.log(...args);
      return;
    }
    console.log(...args);
  }

  normalizeApiError(action, error) {
    const message = error?.message || 'Unknown error';
    const code = error?.cause?.code || error?.code;
    const suffix = code ? ` (${code})` : '';
    return new Error(`go-eCharger ${action} failed at ${this.address}: ${message}${suffix}`);
  }

  serializeApiValue(value) {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return value;
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
    try {
      const response = await fetch(`http://${this.address}/api/status?filter=${this.apiKeys.join(',')}`, { method: 'GET' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const txt = await response.text();
      return JSON.parse(txt);
    } catch (error) {
      throw this.normalizeApiError('status request', error);
    }
  }

  /**
   * Set a single charger value through the local API.
   *
   * @param {string} key API key to set, for example `alw`.
   * @param {string|number|boolean} value Value to assign to the key.
   * @returns {Promise<object>} Parsed response payload from the charger.
   */
  async setValue(key, value) {
    try {
      const serializedValue = this.serializeApiValue(value);
      const url = `http://${this.address}/api/set?${key}=${encodeURIComponent(serializedValue)}`;
      this.log(`[go-eCharger API] setValue URL: ${url}`);
      const response = await fetch(url, { method: 'GET' });
      const txt = await response.text();
      if (!response.ok) {
        let payload = txt;
        try {
          payload = JSON.parse(txt);
        } catch {
          // Keep plain-text payload if response is not JSON.
        }
        this.log(`[go-eCharger API] setValue ${key} error payload:`, payload);

        const payloadMessage = typeof payload === 'string' ? payload : JSON.stringify(payload);
        throw new Error(`HTTP ${response.status}${payloadMessage ? ` - ${payloadMessage}` : ''}`);
      }
      return JSON.parse(txt);
    } catch (error) {
      throw this.normalizeApiError(`setValue ${key}`, error);
    }
  }

  /**
   * Set multiple charger values in a single local API request.
   *
   * @param {object} values API key/value pairs to set.
   * @returns {Promise<object>} Parsed response payload from the charger.
   */
  async setValues(values = {}) {
    try {
      const entries = Object.entries(values).filter(([, value]) => value !== undefined);
      if (entries.length === 0) return {};

      const query = entries.map(([key, value]) => `${key}=${encodeURIComponent(this.serializeApiValue(value))}`).join('&');

      const url = `http://${this.address}/api/set?${query}`;
      this.log(`[go-eCharger API] setValues URL: ${url}`);

      const response = await fetch(url, { method: 'GET' });
      const txt = await response.text();
      if (!response.ok) {
        let payload = txt;
        try {
          payload = JSON.parse(txt);
        } catch {
          // Keep plain-text payload if response is not JSON.
        }
        this.log('[go-eCharger API] setValues error payload:', payload);

        const payloadMessage = typeof payload === 'string' ? payload : JSON.stringify(payload);
        throw new Error(`HTTP ${response.status}${payloadMessage ? ` - ${payloadMessage}` : ''}`);
      }
      return JSON.parse(txt);
    } catch (error) {
      throw this.normalizeApiError('setValues', error);
    }
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
