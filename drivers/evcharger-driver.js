'use strict';

const Homey = require('homey');
const { getDeviceIcon, getModelFromDriverId, matchesDiscoveryModel } = require('../lib/mappings');

class evChargerDriver extends Homey.Driver {
  onInit() {
    this.log('[Driver] - init', this.id);
    this.log('[Driver] - version', this.homey.app.manifest.version);
  }

  async onPair(session) {
    const deviceDriver = this.id;

    session.setHandler('list_devices', async () => {
      try {
        this.log(`[Driver] ${deviceDriver} - mDNS discovery`);

        const discoveryStrategy = this.getDiscoveryStrategy();
        const discoveryResults = discoveryStrategy.getDiscoveryResults();
        const model = getModelFromDriverId(deviceDriver);
        const results = Object.values(discoveryResults)
          .filter((discoveryResult) => matchesDiscoveryModel(discoveryResult, model))
          .map((discoveryResult) => {
            const devicetype = discoveryResult.txt.devicetype || '';
            const devicesubtype = discoveryResult.txt.devicesubtype || '';

            return {
              name: discoveryResult.name,
              data: {
                id: discoveryResult.id
              },
              icon: getDeviceIcon(devicetype, devicesubtype),
              settings: {
                address: discoveryResult.address,
                version: discoveryResult.txt.version,
                type: devicesubtype ? `${devicetype}/${devicesubtype}` : devicetype
              },
              store: {}
            };
          });

        if (results.length > 0) {
          this.log(`[Driver] ${deviceDriver} - mDNS discovery found ${results.length} device(s): ${results.map((result) => `${result.name} (${JSON.stringify(result.data)})`).join(', ')}`);
        } else {
          this.log(`[Driver] ${deviceDriver} - mDNS discovery found no devices`);
        }

        return results;
      } catch (err) {
        throw new Error(err);
      }
    });
  }
}

module.exports = evChargerDriver;
