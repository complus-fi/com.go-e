'use strict';

const Homey = require('homey');
const goeCharger = require('../lib/go-eCharger-API-v2');
const { getStatusAttributes, mapHomeyToApiValues, mapStatusToCapabilities } = require('../lib/mappings');

const POLL_INTERVAL = 5000;

class evChargerDevice extends Homey.Device {
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

    await this.checkCapabilities();

    await this.setSettings({
      driver: this.api.driver
    });

    this.api.apiKeys = getStatusAttributes(this.getCapabilities(), { firmwareVersion: this.getSettings().version });
    this.pollErrorMessage = null;
    this.registerCapabilityListeners();
  }

  getErrorMessage(error, fallback = 'Unknown error') {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    return fallback;
  }

  async sleep(ms) {
    return new Promise((resolve) => {
      this.homey.setTimeout(resolve, ms);
    });
  }

  async updateTargetPowerCapabilityMax(ama) {
    if (!this.hasCapability('target_power')) return;

    const maxAmps = Number(ama);
    if (!Number.isFinite(maxAmps) || maxAmps <= 0) return;

    // target_power max should follow charger amp limit, expressed in watts.
    const maxWatts = Math.round(maxAmps * 690);
    const options = this.getCapabilityOptions('target_power') || {};
    if (options.max === maxWatts) return;

    await this.setCapabilityOptions('target_power', {
      ...options,
      max: maxWatts
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
    const newAddress = typeof newSettings.address === 'string' ? newSettings.address.trim() : '';
    const oldAddress = typeof oldSettings.address === 'string' ? oldSettings.address.trim() : '';

    if (!newAddress || newAddress === oldAddress) {
      return;
    }

    this.api.address = newAddress;
    try {
      const isConnected = await this.api.testConnection();
      if (!isConnected) {
        const error = `Could not connect to go-eCharger at ${this.api.address}`;
        this.setUnavailable(error).catch(() => {});
        return Promise.reject(error);
      }
      this.log(`[Device] ${this.getName()}: ${this.getData().id} new settings OK.`);
      await this.setAvailable();
    } catch (error) {
      await this.setUnavailable(error);
      return Promise.reject(error);
    }
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} was renamed to ${name}.`);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} has been deleted.`);
    await this.clearIntervals();
  }

  async onUninit() {
    await this.clearIntervals();
    if (this.api && typeof this.api.destroy === 'function') {
      this.api.destroy();
    }
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
    await this.clearIntervals();
    this.onPollInterval = this.homey.setInterval(this.onPoll.bind(this), POLL_INTERVAL);
    await this.onPoll();
  }

  async onDiscoveryAddressChanged(discoveryResult) {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} changed - result: ${discoveryResult.address}.`);
    this.log(`[Device] ${this.getName()}: ${this.getData().id} changed - result: ${discoveryResult.name}.`);
    // Update your connection details here, reconnect when the device is offline
    this.api.address = discoveryResult.address;
    await this.setSettings({
      address: this.api.address
    });
    await this.setAvailable();
  }

  onDiscoveryLastSeenChanged(discoveryResult) {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} LastSeenChanged - result: ${discoveryResult.address}.`);
    this.log(`[Device] ${this.getName()}: ${this.getData().id} LastSeenChanged - result: ${discoveryResult.name}.`);
  }

  async clearIntervals() {
    try {
      this.log(`[Device] ${this.getName()}: ${this.getData().id} clearIntervals`);
      this.homey.clearInterval(this.onPollInterval);
    } catch (error) {
      this.log(error);
    }
  }

  // ------------- Check if Capabilities has changed and update them -------------
  async checkCapabilities() {
    try {
      const driverManifest = this.driver.manifest;
      const driverCapabilities = driverManifest.capabilities;
      const deviceCapabilities = this.getCapabilities();

      this.log(`[Device] ${this.getName()} - checkCapabilities for`, driverManifest.id);
      this.log(`[Device] ${this.getName()} - Found capabilities =>`, deviceCapabilities);

      await this.updateCapabilities(driverCapabilities, deviceCapabilities);

      return deviceCapabilities;
    } catch (error) {
      this.log(error);
    }
  }

  async updateCapabilities(driverCapabilities, deviceCapabilities) {
    try {
      const newC = driverCapabilities.filter((d) => !deviceCapabilities.includes(d));
      const oldC = deviceCapabilities.filter((d) => !driverCapabilities.includes(d));

      this.log(`[Device] ${this.getName()} - Got old capabilities =>`, oldC);
      this.log(`[Device] ${this.getName()} - Got new capabilities =>`, newC);

      // Remove old capabilities with delay between each
      for (const c of oldC) {
        this.log(`[Device] ${this.getName()} - updateCapabilities => Remove `, c);
        await this.removeCapability(c);
        await this.sleep(500);
      }
      await this.sleep(2000);

      // Add new capabilities with delay between each
      for (const c of newC) {
        this.log(`[Device] ${this.getName()} - updateCapabilities => Add `, c);
        await this.addCapability(c);

        await this.sleep(500);
      }

      await this.sleep(1000);
    } catch (error) {
      this.log(error);
    }
  }

  registerCapabilityListeners() {
    this.registerMultipleCapabilityListener(
      ['target_power', 'target_power_mode', 'evcharger_charging'],
      async ({ target_power, target_power_mode, evcharger_charging }) => {
        try {
          this.log(`[Device] ${this.getName()} - Capability listener triggered with:`, { target_power, target_power_mode, evcharger_charging });

          const context = { api: this.api, maxAmps: this.maxAmps, firmwareVersion: this.getSettings().version };
          // Switching to device mode: let the charger resume its own scheduling (frc=0 = neutral).
          if (target_power_mode === 'device') {
            await this.applyApiValues({ frc: 0 });
            return;
          }

          // Resolve the effective mode (from this batch or the current capability value).
          const mode = target_power_mode ?? this.getCapabilityValue('target_power_mode');

          if (evcharger_charging === false) {
            const apiValues = mapHomeyToApiValues({ evcharger_charging: false }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
            await this.applyApiValues(apiValues);
            return;
          }

          const watts = target_power ?? this.getCapabilityValue('target_power') ?? 0;

          if (evcharger_charging === true) {
            // Start/resume charging. When target_power arrives in the same batch (e.g. from
            // the "Set target power" flow card), combine both into a single API call so the
            // charger receives the amp setting and the force-on command together.
            const forceOnValues = mapHomeyToApiValues({ evcharger_charging: true }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
            if (target_power !== undefined) {
              const powerValues = mapHomeyToApiValues({ target_power: watts }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
              await this.applyApiValues({ ...powerValues, ...forceOnValues });
            } else {
              await this.applyApiValues(forceOnValues);
            }
            return;
          }

          // Only target_power changed — update the charger amp setting without
          // altering the current charging state (frc is intentionally excluded).
          // Ignore if the charger is in device mode — it manages its own power.
          if (target_power !== undefined) {
            if (mode !== 'homey') {
              this.log(`[Device] ${this.getName()} - Ignoring target_power — not in homey mode`);
              return;
            }
            const powerValues = mapHomeyToApiValues({ target_power: watts }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
            await this.applyApiValues(powerValues);
          }
        } catch (error) {
          const message = this.getErrorMessage(error, 'Failed to apply charger command');
          this.log(`[Device] ${this.getName()} - capability command error: ${message}`);
          throw new Error(message);
        }
      },
      1000
    );
  }

  async applyApiValues(apiValues = {}) {
    const orderedKeys = ['frc', 'amp', 'psm'];

    const orderedApiValues = {};
    for (const key of orderedKeys) {
      if (apiValues[key] !== undefined) {
        orderedApiValues[key] = apiValues[key];
      }
    }
    for (const [key, value] of Object.entries(apiValues)) {
      if (orderedKeys.includes(key)) continue;
      if (value === undefined) continue;
      orderedApiValues[key] = value;
    }

    if (Object.keys(orderedApiValues).length === 0) return;

    try {
      await this.api.setValues(orderedApiValues);
    } catch (error) {
      const message = this.getErrorMessage(error, 'Failed to apply API values');
      throw new Error(message);
    }
  }

  async onPoll() {
    try {
      const status = await this.api.getStatus();
      this.log(`[Device] ${this.getName()} - onPoll status:`, status);

      if (this.pollErrorMessage) {
        this.pollErrorMessage = null;
        await this.setAvailable().catch(() => {});
      }

      if (status.fwv !== undefined && status.fwv !== null) {
        const firmwareVersion = String(status.fwv).trim();
        const currentVersion = String(this.getSettings().version || '').trim();
        if (firmwareVersion && firmwareVersion !== currentVersion) {
          await this.setSettings({ version: firmwareVersion });
          this.api.apiKeys = getStatusAttributes(this.getCapabilities(), { firmwareVersion });
          this.log(`[Device] ${this.getName()} - firmware updated to ${firmwareVersion}`);
        }
      }

      if (status.ama !== undefined) {
        this.maxAmps = Number(status.ama);
        await this.updateTargetPowerCapabilityMax(this.maxAmps);
      }

      const nextValues = mapStatusToCapabilities(status, this.getCapabilities(), this.api);
      for (const [capability, value] of Object.entries(nextValues)) {
        if (!this.hasCapability(capability)) continue;
        if (value === undefined || value === null) continue;
        await this.setCapabilityValue(capability, value).catch(this.error);
      }
    } catch (error) {
      const message = this.getErrorMessage(error, 'Polling failed');
      if (this.pollErrorMessage !== message) {
        this.pollErrorMessage = message;
        this.log(`[Device] ${this.getName()} - onPoll error: ${message}`);
      }
      await this.setUnavailable(`Connection issue: ${message}`).catch(() => {});
    }
  }
}

module.exports = evChargerDevice;
