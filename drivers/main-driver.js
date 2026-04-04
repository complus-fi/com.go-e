'use strict';

const Homey = require('homey');

class mainDriver extends Homey.Driver {
  onInit() {
    this.log('[Driver] - init', this.id);
    this.log('[Driver] - version', this.homey.app.manifest.version);
  }

  async onPair(session) {
    const deviceDriver = this.id;
    let deviceArray = {};

    session.setHandler('list_devices', async () => {
      try {
        this.log(`[Driver] ${deviceDriver} - mDNS discovery`);

        const discoveryStrategy = this.getDiscoveryStrategy();
        const discoveryResults = discoveryStrategy.getDiscoveryResults();
        const results = Object.values(discoveryResults).map((discoveryResult) => ({
          name: discoveryResult.name,
          data: {
            id: discoveryResult.id
          },
          settings: {
            address: discoveryResult.address,
            version: discoveryResult.txt.version,
            type: discoveryResult.txt.devicetype,
            driver: deviceDriver
          },
          store: {}
        }));

        if (results.length > 0) return results;

        return {};
      } catch (e) {
        this.log(e);
        throw new Error(this.homey.__('pair.error'));
      }
    });
  }
}

module.exports = mainDriver;
