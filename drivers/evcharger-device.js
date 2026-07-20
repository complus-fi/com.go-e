'use strict';

const Homey = require('homey');
const goeChargerAPI = require('../lib/go-eCharger-API-v2');
const { formatStatusForLog, formatTransactionDateTime, formatTransactionDuration, parseTimeArgToLocalSeconds, parseTransactionStart } = require('../lib/helpers');
const {
  DEFAULT_SPL3_THRESHOLD_W,
  GOE_CHARGER_MODE,
  GOE_TRANSACTION,
  THREE_PHASE_VOLTAGE,
  getStatusAttributes,
  getTransactionApiValue,
  getTransactionCardName,
  getTransactionCardNameBySlot,
  getTransactionCapabilityIdFromTrx,
  getTransactionLabel,
  mapHomeyToApiValues,
  mapStatusToCapabilities
} = require('../lib/mappings');

const POLL_INTERVAL = 5000;
const POLL_INTERVAL_IDLE = 30000;
const CHARGING_UI_DEBOUNCE_POLLS = 1;

const GOE_TRANSACTION_BASE_VALUES = [
  {
    id: GOE_TRANSACTION.NONE,
    title: {
      en: 'No authentication',
      nl: 'Geen authenticatie',
      da: 'Ingen godkendelse',
      de: 'Keine Authentifizierung',
      es: 'Sin autenticación',
      fr: "Pas d'authentification",
      it: 'Nessuna autenticazione',
      no: 'Ingen autentisering',
      sv: 'Ingen autentisering',
      pl: 'Brak uwierzytelniania',
      ru: 'Без аутентификации',
      ko: '인증 없음',
      ar: 'بدون مصادقة'
    }
  },
  {
    id: GOE_TRANSACTION.ANONYMOUS,
    title: {
      en: 'Anonymous',
      nl: 'Anoniem',
      da: 'Anonym',
      de: 'Anonym',
      es: 'Anónimo',
      fr: 'Anonyme',
      it: 'Anonimo',
      no: 'Anonym',
      sv: 'Anonym',
      pl: 'Anonimowa',
      ru: 'Анонимно',
      ko: '익명',
      ar: 'مجهول'
    }
  }
];

class evChargerDevice extends Homey.Device {
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} start init.`);
    this.setUnavailable(`Initializing ${this.getName()}`).catch(() => {});

    const settings = this.getSettings();
    this.api = new goeChargerAPI();
    this.api.driver = this.driver.id;
    this.configureApiConnection(settings); // was: this.api.base_url = this.getApiBaseUrl(settings.address);

    await this.checkCapabilities();

    await this.setSettings({
      driver: this.api.driver
    });

    this.cardConfiguredFlags = Array(10).fill(undefined);
    this.transactionSlotById = {};
    this.lastTransactionValuesSignature = null;
    this.api.apiKeys = getStatusAttributes(this.getCapabilities(), {
      firmwareVersion: this.getSettings().version,
      cardConfiguredFlags: this.cardConfiguredFlags
    });
    this.pollErrorMessage = null;
    this.pendingChargingState = null;
    this.transactionStartTimestamp = null;
    this.pollIntervalMs = null;

    this.registerCapabilityListeners();
    await this.startConnection();
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log(`[Device] ${this.getName()}: ${this.getData().id} has been added.`);
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

  applyTransactionTimeValues(nextValues = {}) {
    const hasStart = this.hasCapability('goe_transaction_start');
    const hasEnd = this.hasCapability('goe_transaction_end');
    const hasDuration = this.hasCapability('goe_transaction_duration');
    if (!hasStart && !hasEnd && !hasDuration) return;

    // Only update transaction timers from a fresh polled transaction value.
    if (typeof nextValues.goe_transaction !== 'string') {
      return;
    }

    const previousTransaction = this.getCapabilityValue('goe_transaction');
    const nextTransaction = nextValues.goe_transaction;
    const isTransactionActive = typeof nextTransaction === 'string' && nextTransaction !== GOE_TRANSACTION.NONE;
    const timezone = this.homey?.clock?.getTimezone?.();

    if (previousTransaction === GOE_TRANSACTION.NONE && isTransactionActive) {
      this.transactionStartTimestamp = Date.now();
      if (hasStart) {
        nextValues.goe_transaction_start = formatTransactionDateTime(new Date(this.transactionStartTimestamp), timezone);
      }
    }

    if (!isTransactionActive) {
      this.transactionStartTimestamp = null;
      return;
    }

    if (!Number.isFinite(this.transactionStartTimestamp)) {
      const startCandidate = nextValues.goe_transaction_start ?? this.getCapabilityValue('goe_transaction_start');
      const parsedStart = parseTransactionStart(startCandidate);
      if (parsedStart !== null) {
        this.transactionStartTimestamp = parsedStart;
      }
    }

    if (!Number.isFinite(this.transactionStartTimestamp)) {
      this.transactionStartTimestamp = Date.now();
      if (hasStart) {
        nextValues.goe_transaction_start = formatTransactionDateTime(new Date(this.transactionStartTimestamp), timezone);
      }
    }

    const now = new Date();
    const endTimestamp = now.getTime();
    let endValue;
    if (hasEnd) {
      endValue = formatTransactionDateTime(now, timezone);
      nextValues.goe_transaction_end = endValue;
    } else {
      endValue = formatTransactionDateTime(now, timezone);
    }
    if (hasDuration) {
      const startValue = nextValues.goe_transaction_start ?? this.getCapabilityValue('goe_transaction_start');
      const parsedStart = parseTransactionStart(startValue);
      const parsedEnd = parseTransactionStart(endValue);

      const durationMs = Number.isFinite(parsedStart) && Number.isFinite(parsedEnd) ? parsedEnd - parsedStart : endTimestamp - this.transactionStartTimestamp;
      nextValues.goe_transaction_duration = formatTransactionDuration(durationMs);
    }
  }

  getDynamicPollIntervalMs() {
    if (this.hasCapability('evcharger_charging_state')) {
      const chargingState = this.getCapabilityValue('evcharger_charging_state');
      if (chargingState === 'plugged_in_charging' || chargingState === 'plugged_in_paused' || chargingState === 'plugged_in') {
        return POLL_INTERVAL;
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

  getApiBaseUrl(address) {
    const host = typeof address === 'string' ? address.trim() : '';
    return host ? `http://${host}/api` : null;
  }

  // Set the API endpoint (and auth) from device settings. Local uses the LAN address.
  configureApiConnection(settings) {
    this.api.base_url = this.getApiBaseUrl(settings.address);
  }

  // Local devices become available and start polling from onDiscoveryAvailable (mDNS).
  // Overridden by cloud devices, which have no discovery and must start polling here.
  async startConnection() {}

  getConfiguredTransactionEntries(status = {}) {
    const entries = [];
    const usedIds = new Set(GOE_TRANSACTION_BASE_VALUES.map((entry) => entry.id));

    for (let statusIndex = 0; statusIndex < 10; statusIndex += 1) {
      const configured = this.isCardConfigured(status[`c${statusIndex}i`]);
      if (!configured) continue;

      let baseId = null;
      const rawName = status[`c${statusIndex}n`];
      if (typeof rawName === 'string') {
        const normalized = rawName.trim();
        if (normalized && normalized.toLowerCase() !== 'n/a') {
          baseId = normalized;
        }
      }

      if (!baseId) {
        // Keep a stable fallback ID if charger name is empty.
        baseId = `card_${statusIndex + 1}`;
      }

      if (!baseId) continue;

      let dedupIndex = 1;
      let id = baseId;
      while (usedIds.has(id)) {
        dedupIndex += 1;
        id = `${baseId}_${dedupIndex}`;
      }

      usedIds.add(id);
      entries.push({
        slot: statusIndex + 1,
        id,
        title: `Card: ${baseId}`
      });
    }

    return entries;
  }

  async syncDynamicTransactionOptions(status = {}, configuredEntries = this.getConfiguredTransactionEntries(status)) {
    if (!this.hasCapability('goe_transaction')) return;

    const lookup = {};
    for (const entry of configuredEntries) {
      lookup[entry.id] = entry.slot;
    }
    this.transactionSlotById = lookup;

    const values = [...GOE_TRANSACTION_BASE_VALUES];
    for (const entry of configuredEntries) {
      values.push({
        id: entry.id,
        title: {
          en: entry.title
        }
      });
    }

    const signature = JSON.stringify(values);
    if (signature === this.lastTransactionValuesSignature) return;

    await this.setCapabilityOptions('goe_transaction', { values });
    this.lastTransactionValuesSignature = signature;
  }

  /**
   * Resolve the display name for a transaction capability value.
   *
   * @param {object} status Latest charger status payload.
   * @param {string} transactionCapabilityValue Homey transaction capability value.
   * @returns {string} Transaction display name.
   */
  resolveTransactionName(status = {}, transactionCapabilityValue) {
    if (transactionCapabilityValue === GOE_TRANSACTION.NONE) {
      return 'No authentication';
    }

    if (transactionCapabilityValue === GOE_TRANSACTION.ANONYMOUS) {
      return 'Anonymous';
    }

    const dynamicSlot = this.transactionSlotById?.[transactionCapabilityValue];
    const staticSlotMatch = /^card_(\d+)$/.exec(String(transactionCapabilityValue || ''));
    const staticSlot = staticSlotMatch ? Number(staticSlotMatch[1]) : null;
    const slot = Number.isInteger(dynamicSlot) ? dynamicSlot : staticSlot;
    if (Number.isInteger(slot) && slot >= 1 && slot <= 10) {
      return getTransactionCardNameBySlot(status, slot);
    }

    if (typeof transactionCapabilityValue === 'string' && transactionCapabilityValue.trim()) {
      return transactionCapabilityValue;
    }

    return 'Unknown';
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

  async clearIntervals() {
    try {
      this.log(`[Device] ${this.getName()}: ${this.getData().id} clearIntervals`);
      this.homey.clearInterval(this.onPollInterval);
      this.onPollInterval = null;
      this.pollIntervalMs = null;
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
      const oldC = deviceCapabilities.filter((d) => {
        if (driverCapabilities.includes(d)) return false;
        // Dynamic RFID card capabilities are reconciled on poll from cXi state.
        if (/^meter_power\.(10|[1-9])$/.test(d)) return false;
        if (/^goe_meter_power_name\.(10|[1-9])$/.test(d)) return false;
        return true;
      });

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
      ['evcharger_charging', 'goe_charger_mode', 'goe_transaction', 'target_power', 'goe_flexible_rate_limit'],
      async ({ evcharger_charging, goe_charger_mode, goe_transaction, target_power, goe_flexible_rate_limit }) => {
        try {
          this.log(`[Device] ${this.getName()} - Capability listener triggered with:`, {
            evcharger_charging,
            goe_charger_mode,
            goe_transaction,
            target_power,
            goe_flexible_rate_limit
          });

          const context = {
            api: this.api,
            maxAmps: this.maxAmps,
            firmwareVersion: this.getSettings().version,
            status: this.lastStatus,
            spl3Threshold: DEFAULT_SPL3_THRESHOLD_W,
            targetPower: this.getCapabilityValue('target_power')
          };

          if (goe_charger_mode !== undefined) {
            await this.onCapability_SET_CHARGER_MODE(goe_charger_mode);
          }

          if (goe_transaction !== undefined) {
            await this.onCapability_SET_TRANSACTION(goe_transaction);
          }

          const effectiveChargerMode = goe_charger_mode !== undefined ? goe_charger_mode : this.getCapabilityValue('goe_charger_mode');

          if (target_power !== undefined) {
            const apiValues = mapHomeyToApiValues({ target_power }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
            await this.applyApiValues(apiValues);
          }

          if (goe_flexible_rate_limit !== undefined) {
            await this.onCapability_SET_FLEXIBLE_RATE_LIMIT(goe_flexible_rate_limit);
          }

          if (evcharger_charging === false) {
            const apiValues = mapHomeyToApiValues({ evcharger_charging: false }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
            await this.applyApiValues(apiValues);
            this.setPendingChargingState(false);
            return;
          }

          if (evcharger_charging === true) {
            const automaticMode = effectiveChargerMode && effectiveChargerMode !== GOE_CHARGER_MODE.BASIC_CHARGING;

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
    const orderedKeys = ['ids', 'lmo', 'fup', 'psm', 'pgt', 'frm', 'spl3', 'trx', 'frc', 'amp'];

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
      this.log(`[Device] ${this.getName()} - onPoll status:\n${formatStatusForLog(status)}`);
      this.lastStatus = status;
      const configuredTransactionEntries = this.getConfiguredTransactionEntries(status);

      await this.syncDynamicCardCapabilities(status);
      await this.syncDynamicTransactionOptions(status, configuredTransactionEntries);

      if (this.pollErrorMessage) {
        this.pollErrorMessage = null;
        await this.setAvailable().catch(() => {});
      }

      if (status.fwv !== undefined && status.fwv !== null) {
        const firmwareVersion = String(status.fwv).trim();
        const currentVersion = String(this.getSettings().version || '').trim();
        if (firmwareVersion && firmwareVersion !== currentVersion) {
          await this.setSettings({ version: firmwareVersion });
          this.api.apiKeys = getStatusAttributes(this.getCapabilities(), {
            firmwareVersion,
            cardConfiguredFlags: this.cardConfiguredFlags
          });
          this.log(`[Device] ${this.getName()} - firmware updated to ${firmwareVersion}`);
        }
      }

      const deviceCapabilities = this.getCapabilities();
      const statusCapabilities = this.hasCapability('goe_transaction') ? deviceCapabilities.filter((capability) => capability !== 'goe_transaction') : deviceCapabilities;
      const nextValues = mapStatusToCapabilities(status, statusCapabilities, this.api);
      if (this.hasCapability('goe_transaction')) {
        nextValues.goe_transaction = getTransactionCapabilityIdFromTrx(status.trx, {
          configuredEntries: configuredTransactionEntries,
          invalidFallback: GOE_TRANSACTION.NONE
        });
      }

      if (this.hasCapability('goe_transaction_name') && this.hasCapability('evcharger_charging_state')) {
        const previousChargingState = this.getCapabilityValue('evcharger_charging_state');
        const nextChargingState = nextValues.evcharger_charging_state ?? previousChargingState;
        const transactionCapabilityValue = typeof nextValues.goe_transaction === 'string' ? nextValues.goe_transaction : this.getCapabilityValue('goe_transaction');
        const transactionName = this.resolveTransactionName(status, transactionCapabilityValue);

        const hasMeaningfulTransaction = typeof transactionCapabilityValue === 'string' && transactionCapabilityValue !== GOE_TRANSACTION.NONE;
        if (nextChargingState && nextChargingState !== 'plugged_out') {
          if (hasMeaningfulTransaction || this.getCapabilityValue('goe_transaction_name') == null) {
            nextValues.goe_transaction_name = transactionName;
          } else {
            nextValues.goe_transaction_name = this.getCapabilityValue('goe_transaction_name');
          }
        } else {
          const currentTransactionName = this.getCapabilityValue('goe_transaction_name');
          if (currentTransactionName !== undefined && currentTransactionName !== null) {
            nextValues.goe_transaction_name = currentTransactionName;
          }
        }
      }

      this.applyTransactionTimeValues(nextValues);
      if (this.hasCapability('goe_meter_power_name')) {
        const transactionName = typeof nextValues.goe_transaction_name === 'string' ? nextValues.goe_transaction_name : getTransactionCardName(status);
        const currentMeterPowerName = this.getCapabilityValue('goe_meter_power_name');
        const sessionEnergyValue = nextValues['meter_power.session'] ?? this.getCapabilityValue('meter_power.session');
        const sessionEnergy = Number(sessionEnergyValue);

        // Match old app behavior: bind name at session start and keep it while session energy is accumulating.
        if (!Number.isFinite(sessionEnergy) || sessionEnergy <= 0) {
          nextValues.goe_meter_power_name = transactionName;
        } else if (typeof currentMeterPowerName === 'string' && currentMeterPowerName.trim() !== '') {
          nextValues.goe_meter_power_name = currentMeterPowerName;
        } else {
          nextValues.goe_meter_power_name = transactionName;
        }
      }

      if (this.hasCapability('measure_power.max') && this.hasCapability('evcharger_charging_state')) {
        const previousChargingState = this.getCapabilityValue('evcharger_charging_state');

        if (previousChargingState === 'plugged_out') {
          nextValues['measure_power.max'] = 0;
        } else {
          const currentPowerValue = nextValues.measure_power ?? this.getCapabilityValue('measure_power');
          const currentPower = Number(currentPowerValue);
          if (Number.isFinite(currentPower) && currentPower >= 0) {
            const currentSessionMaxValue = this.getCapabilityValue('measure_power.max');
            const currentSessionMax = Number(currentSessionMaxValue);
            const normalizedSessionMax = Number.isFinite(currentSessionMax) && currentSessionMax >= 0 ? currentSessionMax : 0;

            nextValues['measure_power.max'] = Math.max(normalizedSessionMax, currentPower);
          }
        }
      }

      // Update target_power max capability option based on ama (ampere max limit)
      if (this.hasCapability('target_power') && status.ama !== undefined && Number.isFinite(Number(status.ama))) {
        const currentOptions = this.getCapabilityOptions('target_power');
        const newMax = Math.floor(Number(status.ama) * THREE_PHASE_VOLTAGE);

        if (!currentOptions.max || currentOptions.max !== newMax) {
          const newOptions = { ...currentOptions, max: newMax };
          await this.setCapabilityOptions('target_power', newOptions).catch((error) => this.error(error));
        }
      }

      const pendingTriggers = [];

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

        if (capability === 'goe_charger_mode' && previousValue !== value) {
          pendingTriggers.push({ type: 'charger_mode', value });
        }

        if (capability === 'goe_transaction' && previousValue !== value) {
          pendingTriggers.push({ type: 'transaction', value, transactionName: nextValues.goe_transaction_name });
        }
      }

      for (const pendingTrigger of pendingTriggers) {
        if (pendingTrigger.type === 'charger_mode') {
          await this.triggerChargerModeChanged(pendingTrigger.value);
        }

        if (pendingTrigger.type === 'transaction') {
          await this.triggerTransactionChanged(status, pendingTrigger.value, pendingTrigger.transactionName);
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

    this.updatePollInterval(this.getDynamicPollIntervalMs());
  }

  async onCapability_SET_PV_SURPLUS_INFO({ pGrid, pPv, pAkku }) {
    // Keep `pgrid` current in every charger mode. Skip only when nothing is connected to charge.
    const chargingState = this.getCapabilityValue('evcharger_charging_state');
    if (chargingState === 'plugged_out') {
      return;
    }

    const payload = {
      pGrid: Number(pGrid)
    };

    if (pPv !== undefined && pPv !== null && pPv !== '') {
      payload.pPv = Number(pPv);
    }

    if (pAkku !== undefined && pAkku !== null && pAkku !== '') {
      payload.pAkku = Number(pAkku);
    }

    await this.applyApiValues({ ids: payload });
  }

  async onCapability_SET_CHARGER_MODE(mode) {
    const normalizedMode = typeof mode === 'string' ? mode.trim() : '';

    const context = {
      status: this.lastStatus,
      spl3Threshold: DEFAULT_SPL3_THRESHOLD_W,
      targetPower: this.getCapabilityValue('target_power')
    };

    const apiValues = mapHomeyToApiValues({ goe_charger_mode: normalizedMode }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
    await this.applyApiValues(apiValues);
  }

  async onCapability_SET_TRANSACTION(transaction) {
    const normalizedTransaction = typeof transaction === 'string' ? transaction.trim() : '';

    this.apiValue = null;
    if (normalizedTransaction === GOE_TRANSACTION.ANONYMOUS) {
      this.apiValue = 0;
    } else if (normalizedTransaction === GOE_TRANSACTION.NONE) {
      this.apiValue = null;
    } else if (Number.isInteger(this.transactionSlotById[normalizedTransaction])) {
      this.apiValue = this.transactionSlotById[normalizedTransaction];
    } else {
      this.apiValue = getTransactionApiValue(normalizedTransaction);
    }

    if (this.apiValue === null || this.apiValue === undefined) {
      return;
    }

    await this.applyApiValues({ trx: this.apiValue });
    if (this.hasCapability('goe_transaction_name')) {
      const transactionName = this.resolveTransactionName(this.lastStatus, normalizedTransaction);
      await this.setCapabilityValue('goe_transaction_name', transactionName).catch((error) => this.error(error));
    }
  }

  async onCapability_SET_FLEXIBLE_RATE_LIMIT(rate) {
    const parsedRate = Number(rate);

    const context = {
      api: this.api,
      maxAmps: this.maxAmps,
      firmwareVersion: this.getSettings().version,
      status: this.lastStatus,
      spl3Threshold: DEFAULT_SPL3_THRESHOLD_W,
      targetPower: this.getCapabilityValue('target_power')
    };

    const apiValues = mapHomeyToApiValues({ goe_flexible_rate_limit: parsedRate }, this.getCapabilities(), (cap) => this.getCapabilityValue(cap), context);
    await this.applyApiValues(apiValues);
  }

  /**
   * Set Daily Trip targets directly from kWh and time.
   *
   * @param {object} params Action params.
   * @param {number} params.targetEnergyKWh Target energy in kWh.
   * @param {string|Date|object} params.targetTime Target time (local).
   */
  async onCapability_SET_DAILY_TRIP_KWH_TARGET({ targetEnergyKWh, targetTime }) {
    const parsedTargetEnergyKWh = Number(targetEnergyKWh);
    const att = parseTimeArgToLocalSeconds(targetTime);
    const ate = Math.ceil(parsedTargetEnergyKWh) * 1000;
    await this.applyApiValues({ att, ate });
  }

  /**
   * Set Daily Trip targets from SoC values and battery capacity.
   *
   * @param {object} params Action params.
   * @param {number} params.startSoc Start SoC in percent.
   * @param {number} params.targetSoc Target SoC in percent.
   * @param {number} params.batteryCapacityKWh Battery capacity in kWh.
   * @param {string|Date|object} params.targetTime Target time (local).
   */
  async onCapability_SET_DAILY_TRIP_PCT_TARGET({ startSoc, targetSoc, batteryCapacityKWh, targetTime }) {
    const parsedStartSoc = Number(startSoc);
    const parsedTargetSoc = Number(targetSoc);
    const parsedBatteryCapacityKWh = Number(batteryCapacityKWh);

    const att = parseTimeArgToLocalSeconds(targetTime);
    const requiredKWh = ((parsedTargetSoc - parsedStartSoc) / 100) * parsedBatteryCapacityKWh;
    const ate = Math.ceil(requiredKWh) * 1000;

    await this.applyApiValues({ att, ate });
  }

  isCardConfigured(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1';
    }
    return false;
  }

  async syncDynamicCardCapabilities(status = {}) {
    const capsToAdd = [];
    const capsToRemove = [];
    const nextCardConfiguredFlags = [...this.cardConfiguredFlags];
    let cardStateChanged = false;

    for (let index = 0; index < 10; index += 1) {
      const configKey = `c${index}i`;
      if (status[configKey] === undefined || status[configKey] === null) {
        continue;
      }

      const cardNumber = index + 1;
      const configured = this.isCardConfigured(status[configKey]);
      const previousConfigured = this.cardConfiguredFlags[index];
      const meterCapability = `meter_power.${cardNumber}`;
      const nameCapability = `goe_meter_power_name.${cardNumber}`;
      const hasMeterCapability = this.hasCapability(meterCapability);
      const hasNameCapability = this.hasCapability(nameCapability);

      // On first seen value, reconcile only if device capability state does not match charger state.
      if (previousConfigured !== undefined && previousConfigured === configured) {
        const isCapabilityStateInSync = configured ? hasMeterCapability && hasNameCapability : !hasMeterCapability && !hasNameCapability;

        if (isCapabilityStateInSync) {
          continue;
        }
      }

      if (configured) {
        if (!hasMeterCapability) capsToAdd.push(meterCapability);
        if (!hasNameCapability) capsToAdd.push(nameCapability);
      } else {
        if (hasMeterCapability) capsToRemove.push(meterCapability);
        if (hasNameCapability) capsToRemove.push(nameCapability);
      }

      nextCardConfiguredFlags[index] = configured;
      cardStateChanged = true;
    }

    if (capsToAdd.length === 0 && capsToRemove.length === 0) {
      this.cardConfiguredFlags = nextCardConfiguredFlags;

      if (cardStateChanged) {
        this.api.apiKeys = getStatusAttributes(this.getCapabilities(), {
          firmwareVersion: this.getSettings().version,
          cardConfiguredFlags: this.cardConfiguredFlags
        });
      }

      return;
    }

    for (const capability of capsToRemove) {
      try {
        await this.removeCapability(capability);
      } catch (error) {
        const message = error?.message || '';
        if (!message.includes('Invalid Capability')) {
          throw error;
        }
      }
    }

    for (const capability of capsToAdd) {
      try {
        await this.addCapability(capability);
      } catch (error) {
        const message = error?.message || '';
        if (!message.includes('already exists')) {
          throw error;
        }
      }
    }

    this.cardConfiguredFlags = nextCardConfiguredFlags;
    this.api.apiKeys = getStatusAttributes(this.getCapabilities(), {
      firmwareVersion: this.getSettings().version,
      cardConfiguredFlags: this.cardConfiguredFlags
    });
  }

  /**
   * Trigger the Homey flow when the charger mode changes.
   *
   * @param {string} chargerMode Current charger mode capability value.
   * @returns {Promise<void>}
   */
  async triggerChargerModeChanged(chargerMode) {
    const trigger = this.homey.flow.getDeviceTriggerCard('goe_charger_mode_changed');
    await trigger
      .trigger(this, {
        goe_charger_mode: chargerMode
      })
      .catch((error) => this.error(error));
  }

  /**
   * Trigger the Homey flow when the charger transaction changes.
   *
   * @param {object} status Latest charger status payload.
   * @param {string} transactionCapabilityValue Current transaction capability value.
   * @param {string} transactionName Current transaction display name.
   * @returns {Promise<void>}
   */
  async triggerTransactionChanged(status, transactionCapabilityValue, transactionName = this.resolveTransactionName(status, transactionCapabilityValue)) {
    const trigger = this.homey.flow.getDeviceTriggerCard('goe_transaction_changed');
    await trigger
      .trigger(this, {
        card_name: transactionName,
        goe_transaction: getTransactionLabel(transactionCapabilityValue)
      })
      .catch((error) => this.error(error));
  }
}

module.exports = evChargerDevice;
