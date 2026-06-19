'use strict';

const fetch = globalThis.fetch;

/**
 * API client for a go-e Charger.
 *
 * @example
 * const api = new goeChargerAPI('http://192.168.1.50/api', driver, ['alw', 'amp', 'nrg']);
 * const status = await api.getStatus();
 * await api.setValue('alw', 1);
 */
class goeChargerAPI {
  /**
   * Validate cloud API credentials.
   *
   * @param {{ serialnumber: string, token?: string }} credentials Cloud credentials.
   * @returns {Promise<boolean>} `true` when credentials are valid.
   */
  static async testCredentials({ serialnumber, token }) {
    if (typeof serialnumber !== 'string' || serialnumber.trim() === '') {
      return false;
    }

    const normalizedSerial = serialnumber.trim();
    const url = `https://${normalizedSerial}.api.v3.go-e.io/api/status?filter=sse,fna,dfam,typ,styp,fwv`;
    const headers = {};
    if (typeof token === 'string' && token.trim() !== '') {
      headers.Authorization = `Bearer ${token.trim()}`;
    }

    try {
      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) return false;

      const payload = await response.json();
      return payload && typeof payload === 'object' && payload.sse === normalizedSerial;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} base_url Charger API base URL (for example `http://192.168.1.50/api`).
   * @param {object} driver Driver instance that owns this API client.
   * @param {string[]} apiKeys Attribute keys to request in `getStatus()`,
   * for example: ['sse', 'fna', 'car', 'alw', 'acs', 'frc', 'trx', 'cards', 'err', 'wh', 'pha', 'nrg', 'eto', 'tma', 'amp', 'ama', 'psm', 'cbl'].
   * @param {string} [cloud_api_token] Optional Bearer token for the go-e cloud endpoint.
   */
  constructor(base_url, driver, apiKeys, cloud_api_token) {
    this.base_url = typeof base_url === 'string' ? base_url.replace(/\/+$/, '') : null;
    this.driver = driver;
    this.apiKeys = apiKeys;
    this.cloud_api_token = cloud_api_token || null;
  }

  log(...args) {
    if (this.driver && typeof this.driver.log === 'function') {
      this.driver.log(...args);
      return;
    }
    console.log(...args);
  }

  buildHeaders() {
    if (this.cloud_api_token) {
      return { Authorization: `Bearer ${this.cloud_api_token}` };
    }
    return {};
  }

  normalizeApiError(action, error) {
    const message = error?.message || 'Unknown error';
    const code = error?.cause?.code || error?.code;
    const suffix = code ? ` (${code})` : '';
    return new Error(`go-eCharger ${action} failed at ${this.base_url}: ${message}${suffix}`);
  }

  serializeApiValue(value) {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value && typeof value === 'object') return JSON.stringify(value);
    return value;
  }

  /**
   * Test connectivity to the charger.
   *
   * @returns {Promise<boolean>} `true` when reachable, otherwise `false`.
   */
  async testConnection() {
    try {
      const response = await fetch(`${this.base_url}/status?filter=fna`, { method: 'GET', headers: this.buildHeaders() });
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
    const filter = Array.isArray(this.apiKeys) ? this.apiKeys.join(',') : '';
    const url = `${this.base_url}/status?filter=${filter}`;

    const isObjectPayload = (value) => value && typeof value === 'object' && !Array.isArray(value);
    const parsePayload = (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    };
    const getMissingKeys = (payload) => {
      if (!isObjectPayload(payload) || !Array.isArray(this.apiKeys)) return [];
      return this.apiKeys.filter((key) => payload[key] === undefined);
    };
    const syncFilterFromPayload = (payload, statusCode) => {
      const missingKeys = getMissingKeys(payload);
      if (missingKeys.length === 0) return;

      const requestedFilter = Array.isArray(this.apiKeys) ? this.apiKeys.join(',') : '';
      this.log(`[go-eCharger API] getStatus missing keys${statusCode ? ` (HTTP ${statusCode})` : ''}: ${missingKeys.join(',')}`);
      this.log(`[go-eCharger API] getStatus requested filter: ${requestedFilter}`);

      const supportedKeys = this.apiKeys.filter((key) => payload[key] !== undefined);
      if (supportedKeys.length > 0 && supportedKeys.length < this.apiKeys.length) {
        this.log(`[go-eCharger API] getStatus pruning unsupported filter keys: ${missingKeys.join(',')}`);
        this.apiKeys = supportedKeys;
      }
    };

    try {
      this.log(`[go-eCharger API] getStatus URL: ${url}`);

      const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() });
      const txt = await response.text();
      const payload = parsePayload(txt);

      if (!response.ok) {
        this.log('[go-eCharger API] getStatus error payload:', payload);

        if (isObjectPayload(payload)) {
          // Some firmware responds with HTTP 400 when unsupported keys are requested,
          // but still returns valid partial status data for supported keys.
          syncFilterFromPayload(payload, response.status);
          return payload;
        }

        const payloadMessage = typeof payload === 'string' ? payload : JSON.stringify(payload);
        throw new Error(`HTTP ${response.status}${payloadMessage ? ` - ${payloadMessage}` : ''}`);
      }

      syncFilterFromPayload(payload);
      if (isObjectPayload(payload)) {
        return payload;
      }

      throw new Error('Invalid JSON status payload');
    } catch (error) {
      throw this.normalizeApiError(`status request (${url})`, error);
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
      const url = `${this.base_url}/set?${key}=${encodeURIComponent(serializedValue)}`;
      this.log(`[go-eCharger API] setValue URL: ${url}`);
      const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() });
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

      const url = `${this.base_url}/set?${query}`;
      this.log(`[go-eCharger API] setValues URL: ${url}`);

      const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() });
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
   * @returns {{ amp: number, psm: number } | { frc: number }} Charger config to apply.
   */
  wattsToChargerConfig(watts, maxAmps = 16) {
    const MAX_1P_W = 16 * 230; // 3680W — above this always prefer 3-phase

    if (watts <= 0) {
      return { frc: 1 };
    } else if (watts <= MAX_1P_W) {
      // 1-phase only zone: clamp to 6–16A
      const amp = Math.max(6, Math.min(16, Math.round(watts / 230)));
      return { amp, psm: 1 };
    } else {
      // 3-phase preferred; gap step (3681–4139W) rounds to amp=6 → 3P 6A (4140W)
      const amp = Math.max(6, Math.min(maxAmps, Math.round(watts / 690)));
      return { amp, psm: 2 };
    }
  }

  /**
   * Convert charger amp + phase state back to watts.
   *
   * @param {number} amp Current requested ampere from the charger.
   * @param {boolean} isSinglePhase Whether the charger is in single-phase mode (psm === 1).
   * @returns {number} Equivalent power in watts.
   */
  chargerConfigToWatts(amp, isSinglePhase) {
    return isSinglePhase ? amp * 230 : amp * 690;
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
      await this.setValue('psm', config.psm);
    }
  }

  /**
   * Release local references for lifecycle cleanup.
   * There is no persistent socket/session to close for this API client.
   */
  destroy() {
    this.base_url = null;
    this.driver = null;
    this.apiKeys = [];
    this.cloud_api_token = null;
    return;
  }
}

module.exports = goeChargerAPI;
