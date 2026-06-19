'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const { getModelFromDriverId } = require('../lib/mappings');

class evChargerCloudDriver extends Homey.Driver {
  onInit() {
    this.log('[Driver] - init', this.id);
    this.log('[Driver] - version', this.homey.app.manifest.version);
  }

  async onPair(session) {
    const deviceDriver = this.id;
    let pairingApiKey = '';

    session.setHandler('set_api_key', async ({ apiKey } = {}) => {
      const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
      if (!trimmedApiKey) {
        throw new Error('Cloud API key is required.');
      }

      pairingApiKey = trimmedApiKey;
      this.log(`[Driver] ${deviceDriver} - Cloud API key received for pairing`);
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!pairingApiKey) {
        throw new Error('Please provide the Cloud API key first.');
      }

      const model = getModelFromDriverId(deviceDriver);
      const cloudDeviceId = crypto.createHash('sha256').update(pairingApiKey).digest('hex').slice(0, 24);

      return [
        {
          name: `${model} (Cloud)`,
          data: {
            id: cloudDeviceId
          },
          settings: {
            address: 'api.go-e.com',
            version: '',
            type: `${model}/cloud`,
            api_key: pairingApiKey
          },
          store: {}
        }
      ];
    });
  }
}

module.exports = evChargerCloudDriver;
