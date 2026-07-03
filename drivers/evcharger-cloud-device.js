'use strict';

const evChargerDevice = require('./evcharger-device');

class evCloudChargerDevice extends evChargerDevice {
  getApiBaseUrl(serialnumber) {
    const host = typeof serialnumber === 'string' ? serialnumber.trim() : '';
    return host ? `https://${host}.api.v3.go-e.io/api` : null;
  }

  // Cloud connects via serial number + bearer token instead of a LAN address.
  configureApiConnection(settings) {
    this.api.base_url = this.getApiBaseUrl(settings.serialnumber);
    this.api.cloud_api_token = settings.token;
  }

  // No mDNS discovery for cloud devices: become available and start polling now.
  // onPoll() reschedules the interval at its tail via updatePollInterval().
  async startConnection() {
    await this.setAvailable();
    await this.clearIntervals();
    await this.onPoll();
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
