'use strict';

const evChargerDevice = require('./evcharger-device');
const goeChargerAPI = require('../lib/go-eCharger-API-v2');
const { getStatusAttributes } = require('../lib/mappings');

class evCloudChargerDevice extends evChargerDevice.Device {
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
    this.api.cloud_api_token = this.getApiBaseUrl(settings.token);
    this.api.driver = this.driver.id;

    await this.checkCapabilities();

    await this.setSettings({
      driver: this.api.driver
    });

    this.api.apiKeys = getStatusAttributes(this.getCapabilities(), { firmwareVersion: this.getSettings().version });
    this.pollErrorMessage = null;
    this.pendingChargingState = null;
    this.registerCapabilityListeners();
  }

}

module.exports = evCloudChargerDevice;
