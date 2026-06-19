'use strict';

const evChargerDevice = require('evcharger-device');
const goeChargerAPI = require('../lib/go-eCharger-API-v2');
const { GOE_CHARGER_MODE, getStatusAttributes, mapHomeyToApiValues, mapStatusToCapabilities } = require('../lib/mappings');

const POLL_INTERVAL = 5000;
const CHARGING_UI_DEBOUNCE_POLLS = 1;
const AUTO_SPL3_THRESHOLD_W = 4140;
const GOE_CHARGER_MODE_IDS = new Set(Object.values(GOE_CHARGER_MODE));

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
