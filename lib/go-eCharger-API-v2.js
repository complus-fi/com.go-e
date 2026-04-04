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
}

module.exports = goeChargerLocalApi;
