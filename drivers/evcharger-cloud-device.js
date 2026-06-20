'use strict';

const evChargerDevice = require('./evcharger-device');
const goeChargerAPI = require('../lib/go-eCharger-API-v2');
const { getStatusAttributes } = require('../lib/mappings');

const POLL_INTERVAL_CHARGING = 5000;
const POLL_INTERVAL_IDLE = 30000;

class evCloudChargerDevice extends evChargerDevice {
  getDynamicPollIntervalMs(status = this.lastStatus) {
    if (Number(status?.car) === 2) {
      return POLL_INTERVAL_CHARGING;
    }

    if (this.hasCapability('evcharger_charging_state')) {
      const chargingState = this.getCapabilityValue('evcharger_charging_state');
      if (chargingState === 'plugged_in_charging') {
        return POLL_INTERVAL_CHARGING;
      }
    }

    return POLL_INTERVAL_IDLE;
  }

  updatePollInterval(intervalMs) {
    if (this.pollIntervalMs === intervalMs && this.onPollInterval) {
      return;
    }

    if (this.onPollInterval) {
      this.homey.clearInterval(this.onPollInterval);
    }

    this.onPollInterval = this.homey.setInterval(this.onPoll.bind(this), intervalMs);
    this.pollIntervalMs = intervalMs;
  }

  getApiBaseUrl(serialnumber) {
    const host = typeof serialnumber === 'string' ? serialnumber.trim() : '';
    return host ? `https://${serialnumber}.api.v3.go-e.io/api` : null;
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} start init.`);
    this.setUnavailable(`Initializing ${this.getName()}`).catch(() => {});

    const settings = this.getSettings();
    this.api = new goeChargerAPI();
    this.api.base_url = this.getApiBaseUrl(settings.serialnumber);
    this.api.cloud_api_token = settings.token;
    this.api.driver = this.driver.id;

    await this.checkCapabilities();

    await this.setSettings({
      driver: this.api.driver
    });

    this.api.apiKeys = getStatusAttributes(this.getCapabilities(), { firmwareVersion: this.getSettings().version });
    this.pollErrorMessage = null;
    this.pendingChargingState = null;
    this.pollIntervalMs = null;
    this.registerCapabilityListeners();

    await this.setAvailable();
    await this.clearIntervals();
    await this.onPoll();
    this.updatePollInterval(this.getDynamicPollIntervalMs());
  }

  async onPoll() {
    await super.onPoll();
    this.updatePollInterval(this.getDynamicPollIntervalMs());
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} settings where changed: ${changedKeys}`);

    const newSerialnumber = typeof newSettings.serialnumber === 'string' ? newSettings.serialnumber.trim() : '';
    const oldSerialnumber = typeof oldSettings.serialnumber === 'string' ? oldSettings.serialnumber.trim() : '';
    const newToken = typeof newSettings.token === 'string' ? newSettings.token.trim() : '';
    const oldToken = typeof oldSettings.token === 'string' ? oldSettings.token.trim() : '';

    if (newSerialnumber === oldSerialnumber && newToken === oldToken) {
      return;
    }

    if (!newSerialnumber) {
      const error = 'Cloud charger serial number is required';
      this.setUnavailable(error).catch(() => {});
      throw new Error(error);
    }

    this.api.base_url = this.getApiBaseUrl(newSerialnumber);
    this.api.cloud_api_token = newToken || null;

    try {
      const isConnected = await this.api.testConnection();
      if (!isConnected) {
        const error = `Could not connect to go-e Cloud charger ${newSerialnumber}`;
        this.setUnavailable(error).catch(() => {});
        throw new Error(error);
      }

      this.log(`[Device] ${this.getName()}: ${this.getData().id} new cloud settings OK.`);
      await this.setAvailable();
    } catch (error) {
      await this.setUnavailable(error);
      throw error;
    }
  }
}

module.exports = evCloudChargerDevice;
