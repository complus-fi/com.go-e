'use strict';

const Homey = require('homey');
const goeCharger = require('../lib/go-eCharger-API-v2');

const POLL_INTERVAL = 5000;

class mainDevice extends Homey.Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} start init.`);
    this.setUnavailable(`Initializing ${this.getName()}`).catch(() => {});

    const settings = this.getSettings();
    this.api = new goeCharger();
    this.api.address = settings.address;
    this.api.driver = this.driver.id;

    this.setSettings({
      driver: this.api.driver
    });
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} has been added.`);
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
    this.api.address = newSettings.address;
    try {
      const isConnected = await this.api.testConnection();
      if (!isConnected) {
        const error = `Could not connect to go-eCharger at ${this.api.address}`;
        this.setUnavailable(error).catch(() => {});
        return Promise.reject(error);
      }
      this.log(`[Device] ${this.getName()}: ${this.getData().id} new settings OK.`);
      this.setAvailable();
    } catch (error) {
      this.setUnavailable(error).catch(() => {});
      return Promise.reject(error);
    }
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} was renamed.`);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} has been deleted.`);
    this.clearIntervals();
  }

  onDiscoveryResult(discoveryResult) {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} discovered - result: ${discoveryResult.id}.`);
    // Return a truthy value here if the discovery result matches your device.
    return discoveryResult.id === this.getData().id;
  }

  // This method will be executed once when the device has been found (onDiscoveryResult returned true)
  async onDiscoveryAvailable(discoveryResult) {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} available - result: ${discoveryResult.address}.`);
    this.log(`[Device] ${this.getName()}: ${this.getData().id} type: ${discoveryResult.txt.devicetype}.`);
    this.api.address = discoveryResult.address;
    await this.setSettings({
      address: this.api.address
    });
    await this.setAvailable();
  }

  onDiscoveryAddressChanged(discoveryResult) {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} changed - result: ${discoveryResult.address}.`);
    this.log(`[Device] ${this.getName()}: ${this.getData().id} changed - result: ${discoveryResult.name}.`);
    // Update your connection details here, reconnect when the device is offline
    this.api.address = discoveryResult.address;
    this.setSettings({
      address: this.api.address
    });
    this.setAvailable();
  }

  onDiscoveryLastSeenChanged(discoveryResult) {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} LastSeenChanged - result: ${discoveryResult.address}.`);
    this.log(`[Device] ${this.getName()}: ${this.getData().id} LastSeenChanged - result: ${discoveryResult.name}.`);
    //this.api.address = discoveryResult.address;
    //this.setSettings({
    //	address: this.api.address,
    //});
    //this.setUnavailable('Discovery device offline.').catch(() => {});
  }
}

module.exports = mainDevice;
