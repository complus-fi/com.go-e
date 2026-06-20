'use strict';

const Homey = require('homey');
const goeChargerAPI = require('../lib/go-eCharger-API-v2');
const { GOE_CHARGER_MODE, GOE_TRANSACTION, getStatusAttributes, getTransactionApiValue, getTransactionLabel, mapHomeyToApiValues, mapStatusToCapabilities } = require('../lib/mappings');

const POLL_INTERVAL = 5000;
const CHARGING_UI_DEBOUNCE_POLLS = 1;
const AUTO_SPL3_THRESHOLD_W = 4140;
const GOE_CHARGER_MODE_IDS = new Set(Object.values(GOE_CHARGER_MODE));
const GOE_TRANSACTION_IDS = new Set(Object.values(GOE_TRANSACTION));

class evChargerDevice extends Homey.Device {
  getApiBaseUrl(address) {
    const host = typeof address === 'string' ? address.trim() : '';
    return host ? `http://${host}/api` : null;
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} start init.`);
    this.setUnavailable(`Initializing ${this.getName()}`).catch(() => {});

    const settings = this.getSettings();
    this.api = new goeChargerAPI();
    this.api.base_url = this.getApiBaseUrl(settings.address);
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

  setPendingChargingState(value) {
    this.pendingChargingState = {
      expectedValue: value,
      pollsToSkip: CHARGING_UI_DEBOUNCE_POLLS
    };
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

    this.api.base_url = this.getApiBaseUrl(newAddress);
    try {
      const isConnected = await this.api.testConnection();
      if (!isConnected) {
        const error = `Could not connect to go-eCharger at ${newAddress}`;
        this.setUnavailable(error).catch(() => {});
        throw new Error(error);
      }
      this.log(`[Device] ${this.getName()}: ${this.getData().id} new settings OK.`);
      await this.setAvailable();
    } catch (error) {
      await this.setUnavailable(error);
      throw error;
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
  }

  async onUninit() {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} has been uninitialized.`);
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
    this.api.base_url = this.getApiBaseUrl(discoveryResult.address);
    await this.setSettings({
      address: discoveryResult.address
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
    this.api.base_url = this.getApiBaseUrl(discoveryResult.address);
    await this.setSettings({
      address: discoveryResult.address
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
        if (!this.hasCapability(c)) {
          this.log(`[Device] ${this.getName()} - updateCapabilities => Skip remove missing capability`, c);
          continue;
        }

        this.log(`[Device] ${this.getName()} - updateCapabilities => Remove `, c);
        try {
          await this.removeCapability(c);
        } catch (error) {
          const message = error?.message || '';
          if (!message.includes('Invalid Capability')) {
            throw error;
          }
          this.log(`[Device] ${this.getName()} - updateCapabilities => Remove skipped (already missing)`, c);
        }
        await this.sleep(500);
      }
      await this.sleep(2000);

      // Add new capabilities with delay between each
      for (const c of newC) {
        if (this.hasCapability(c)) {
          this.log(`[Device] ${this.getName()} - updateCapabilities => Skip add existing capability`, c);
          continue;
        }

        this.log(`[Device] ${this.getName()} - updateCapabilities => Add `, c);
        try {
          await this.addCapability(c);
        } catch (error) {
          const message = error?.message || '';
          if (!message.includes('already exists')) {
            throw error;
          }
          this.log(`[Device] ${this.getName()} - updateCapabilities => Add skipped (already exists)`, c);
        }

        await this.sleep(500);
      }

      await this.sleep(1000);
    } catch (error) {
      this.log(error);
    }
  }

  registerCapabilityListeners() {
    this.registerMultipleCapabilityListener(
      ['evcharger_charging', 'goe_pv_surplus_enabled', 'goe_charger_mode', 'goe_transaction'],
      async ({ evcharger_charging, goe_pv_surplus_enabled, goe_charger_mode, goe_transaction }) => {
        try {
          this.log(`[Device] ${this.getName()} - Capability listener triggered with:`, { evcharger_charging, goe_pv_surplus_enabled, goe_charger_mode, goe_transaction });

          const context = {
            api: this.api,
            maxAmps: this.maxAmps,
            firmwareVersion: this.getSettings().version,
            status: this.lastStatus,
            spl3Threshold: AUTO_SPL3_THRESHOLD_W
          };

          if (goe_charger_mode !== undefined) {
            await this.onCapability_SET_CHARGER_MODE(goe_charger_mode);
            return;
          }

          if (goe_pv_surplus_enabled !== undefined) {
            await this.onCapability_SET_PV_SURPLUS_ENABLED(goe_pv_surplus_enabled);
            return;
          }

          if (goe_transaction !== undefined) {
            await this.onCapability_SET_TRANSACTION(goe_transaction);
          }

          if (evcharger_charging === false) {
            const apiValues = mapHomeyToApiValues({ evcharger_charging: false }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
            await this.applyApiValues(apiValues);
            this.setPendingChargingState(false);
            return;
          }

          if (evcharger_charging === true) {
            const chargerMode = this.getCapabilityValue('goe_charger_mode');
            const automaticMode = chargerMode && chargerMode !== GOE_CHARGER_MODE.BASIC_CHARGING;

            // Start/resume charging in automatic mode for Eco/Trip charger logic, otherwise use Homey/manual mode.
            const startValues = mapHomeyToApiValues({ evcharger_charging: true }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
            startValues.frc = automaticMode ? 0 : 2;
            await this.applyApiValues(startValues);
            this.setPendingChargingState(true);
            return;
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
    const orderedKeys = ['ids', 'lmo', 'fup', 'psm', 'pgt', 'frm', 'spl3', 'fst', 'trx', 'frc', 'amp'];

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
      this.lastStatus = status;

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
      }

      const nextValues = mapStatusToCapabilities(status, this.getCapabilities(), this.api);

      if (this.hasCapability('goe_pv_surplus_enabled') && status.fup !== undefined) {
        nextValues.goe_pv_surplus_enabled = Boolean(status.fup);
      }

      for (const [capability, value] of Object.entries(nextValues)) {
        if (!this.hasCapability(capability)) continue;
        if (value === undefined || value === null) continue;

        if (capability === 'evcharger_charging' && this.pendingChargingState) {
          const pending = this.pendingChargingState;
          if (value === pending.expectedValue) {
            this.pendingChargingState = null;
          } else if (pending.pollsToSkip > 0) {
            pending.pollsToSkip -= 1;
            this.log(`[Device] ${this.getName()} - Skipping stale evcharger_charging poll value ${value} (waiting for ${pending.expectedValue})`);
            continue;
          } else {
            this.pendingChargingState = null;
          }
        }

        const previousValue = this.getCapabilityValue(capability);

        await this.setCapabilityValue(capability, value).catch((error) => this.error(error));

        if (capability === 'goe_transaction' && previousValue !== value) {
          await this.triggerTransactionChanged(value);
        }
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

  async onCapability_SET_PV_SURPLUS_INFO({ pGrid, pPv, pAkku }) {
    const pvSurplusEnabled = Boolean(this.getCapabilityValue('goe_pv_surplus_enabled'));
    if (!pvSurplusEnabled) {
      this.log(`[Device] ${this.getName()} - Skip ids update because goe_pv_surplus_enabled is false`);
      return;
    }

    const payload = {
      pGrid: Number(pGrid)
    };

    if (!Number.isFinite(payload.pGrid)) {
      throw new Error('pGrid must be a number');
    }

    if (pPv !== undefined && pPv !== null && pPv !== '') {
      const parsedPPv = Number(pPv);
      if (!Number.isFinite(parsedPPv)) {
        throw new Error('pPv must be a number when provided');
      }
      payload.pPv = parsedPPv;
    }

    if (pAkku !== undefined && pAkku !== null && pAkku !== '') {
      const parsedPAkku = Number(pAkku);
      if (!Number.isFinite(parsedPAkku)) {
        throw new Error('pAkku must be a number when provided');
      }
      payload.pAkku = parsedPAkku;
    }

    await this.applyApiValues({ ids: payload });
  }

  async onCapability_SET_PV_SURPLUS_ENABLED(enabled) {
    const normalizedEnabled = typeof enabled === 'string' ? enabled.trim().toLowerCase() === 'true' : Boolean(enabled);

    const context = {
      status: this.lastStatus,
      spl3Threshold: AUTO_SPL3_THRESHOLD_W
    };

    const apiValues = mapHomeyToApiValues({ goe_pv_surplus_enabled: normalizedEnabled }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);

    await this.applyApiValues(apiValues);
  }

  async onCapability_SET_CHARGER_MODE(mode) {
    const normalizedMode = typeof mode === 'string' ? mode.trim() : '';
    if (!GOE_CHARGER_MODE_IDS.has(normalizedMode)) {
      throw new Error(`Unsupported charger mode: ${mode}`);
    }

    const context = {
      status: this.lastStatus,
      spl3Threshold: AUTO_SPL3_THRESHOLD_W
    };

    const apiValues = mapHomeyToApiValues({ goe_charger_mode: normalizedMode }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
    await this.applyApiValues(apiValues);
  }

  async onCapability_SET_TRANSACTION(transaction) {
    const normalizedTransaction = typeof transaction === 'string' ? transaction.trim() : '';
    if (!GOE_TRANSACTION_IDS.has(normalizedTransaction)) {
      throw new Error(`Unsupported transaction: ${transaction}`);
    }

    await this.applyApiValues({ trx: getTransactionApiValue(normalizedTransaction) });
  }

  async triggerTransactionChanged(transaction) {
    const trigger = this.homey.flow.getDeviceTriggerCard('goe_transaction_changed');
    await trigger
      .trigger(this, {
        goe_transaction: getTransactionLabel(transaction)
      })
      .catch((error) => this.error(error));
  }
}

module.exports = evChargerDevice;
