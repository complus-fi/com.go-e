'use strict';

const Homey = require('homey');
const { sleep } = require('../lib/helpers');
const goeCharger = require('../lib/go-eCharger-API-v2');
const { getStatusAttributes, statusMap } = require('../lib/mappings');

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

    await this.checkCapabilities();

    this.setSettings({
      driver: this.api.driver
    });

    this.api.attributes = getStatusAttributes(this.getCapabilities());
    this.maxAmps = 16;
    this.registerCapabilityListeners();
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
    this.log(`[Device] ${this.getName()}: ${this.getData().id} was renamed to ${name}.`);
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
    clearInterval(this.onPollInterval);
    this.onPollInterval = setInterval(this.onPoll.bind(this), POLL_INTERVAL);
    await this.onPoll();
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

  async clearIntervals() {
    try {
      this.log(`[Device] ${this.getName()}: ${this.getData().id} clearIntervals`);
      clearInterval(this.onPollInterval);
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
        this.removeCapability(c);
        await sleep(500);
      }
      await sleep(2000);

      // Add new capabilities with delay between each
      for (const c of newC) {
        this.log(`[Device] ${this.getName()} - updateCapabilities => Add `, c);
        this.addCapability(c);
        await sleep(500);
      }

      await sleep(1000);
    } catch (error) {
      this.log(error);
    }
  }

  registerCapabilityListeners() {
    this.registerMultipleCapabilityListener(
      ['target_power', 'target_power_mode', 'evcharger_charging'],
      async ({ target_power, target_power_mode, evcharger_charging }) => {
        if (target_power_mode === 'device') {
          await this.api.setValue('frc', 0); // neutral — device controls itself
          return;
        }

        if (evcharger_charging === false) {
          await this.api.setValue('frc', 1); // force off
          return;
        }

        const isCharging = evcharger_charging === true || this.getCapabilityValue('evcharger_charging');
        const watts = target_power ?? this.getCapabilityValue('target_power') ?? 0;

        if (evcharger_charging === true || (target_power != null && isCharging)) {
          await this.api.setValue('frc', 2); // force on
          await this.api.setChargerPower(watts, this.maxAmps);
        }
      },
      500
    );
  }

  async onPoll() {
    try {
      const status = await this.api.getStatus();

      if (status.ama !== undefined) this.maxAmps = status.ama;

      // evcharger_charging from alw
      if (status.alw !== undefined) {
        await this.setCapabilityValue('evcharger_charging', status.alw).catch(this.error);
      }

      // car status mapping:
      // - status 5 (error): keep last known charging_state and raise alarm_problem
      // - other known statuses: update charging_state and clear alarm_problem
      if (status.car !== undefined) {
        if (this.hasCapability('alarm_problem')) {
          await this.setCapabilityValue('alarm_problem', status.car === 5).catch(this.error);
        }

        if (status.car !== 5 && statusMap[status.car]) {
          await this.setCapabilityValue('evcharger_charging_state', statusMap[status.car]).catch(this.error);
        }
      }

      // target_power from amp + fsp
      if (status.amp !== undefined && status.fsp !== undefined) {
        await this.setCapabilityValue('target_power', this.api.chargerConfigToWatts(status.amp, status.fsp)).catch(this.error);
      }

      // meter_power from eto (Wh → kWh)
      if (status.eto > 0) {
        await this.setCapabilityValue('meter_power', Number((status.eto / 1000).toFixed(1))).catch(this.error);
      }

      // meter_power.session from wh (Wh → kWh, resets when car connects)
      if (status.wh !== undefined) {
        await this.setCapabilityValue('meter_power.session', Number((status.wh / 1000).toFixed(1))).catch(this.error);
      }

      // nrg array: nrg[0-2]=V per phase, nrg[4-6]=A per phase, nrg[11]=total W
      // pha array: pha[0-2]=output phases active, pha[3-5]=input phases active
      if (Array.isArray(status.nrg)) {
        if (status.nrg[11] > 0) {
          await this.setCapabilityValue('measure_power', Number(status.nrg[11].toFixed(1))).catch(this.error);
        }

        let numPhases = 0;
        if (status.nrg[4] > 0) numPhases++;
        if (status.nrg[5] > 0) numPhases++;
        if (status.nrg[6] > 0) numPhases++;
        if (numPhases > 0) {
          const avgCurrent = (status.nrg[4] + status.nrg[5] + status.nrg[6]) / numPhases;
          await this.setCapabilityValue('measure_current', Number(avgCurrent.toFixed(1))).catch(this.error);
        }

        if (Array.isArray(status.pha)) {
          let vInSum = 0;
          let nInPhases = 0;
          if (status.pha[3]) {
            vInSum += status.nrg[0];
            nInPhases++;
          }
          if (status.pha[4]) {
            vInSum += status.nrg[1];
            nInPhases++;
          }
          if (status.pha[5]) {
            vInSum += status.nrg[2];
            nInPhases++;
          }
          const vIn = nInPhases === 3 ? Number(((vInSum / nInPhases) * Math.sqrt(3)).toFixed(1)) : vInSum || Number(status.nrg[3].toFixed(1));
          await this.setCapabilityValue('measure_voltage', vIn).catch(this.error);

          let vOutSum = 0;
          let nOutPhases = 0;
          if (status.pha[0]) {
            vOutSum += status.nrg[0];
            nOutPhases++;
          }
          if (status.pha[1]) {
            vOutSum += status.nrg[1];
            nOutPhases++;
          }
          if (status.pha[2]) {
            vOutSum += status.nrg[2];
            nOutPhases++;
          }
          const vOut = nOutPhases === 3 ? Number(((vOutSum / nOutPhases) * Math.sqrt(3)).toFixed(1)) : vOutSum || Number(status.nrg[3].toFixed(1));
          await this.setCapabilityValue('measure_voltage.output', vOut).catch(this.error);
        }
      }
    } catch (error) {
      this.log(`[Device] ${this.getName()} - onPoll error:`, error);
    }
  }
}

module.exports = mainDevice;
