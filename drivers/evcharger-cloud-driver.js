'use strict';

const Homey = require('homey');
const { getModelFromDriverId, matchesDiscoveryModel } = require('../lib/mappings');
const goeChargerAPI = require('../lib/go-eCharger-API-v2');

class evChargerCloudDriver extends Homey.Driver {
  onInit() {
    this.log('[Driver] - init', this.id);
    this.log('[Driver] - version', this.homey.app.manifest.version);
  }

  async onPair(session) {
    let serialnumber = '';
    let token = '';

    session.setHandler('login', async (data) => {
      serialnumber = data.username;
      token = data.password;
      this.log(`[Driver] ${this.id} - cloud login requested for serial ${serialnumber}`);

      const api = new goeChargerAPI(`https://${serialnumber}.api.v3.go-e.io/api`, this, ['sse', 'fna', 'dfam', 'typ', 'styp', 'fwv'], token);
      let credentialsAreValid = false;
      try {
        const cloudStatus = await api.getStatus();
        credentialsAreValid = Boolean(cloudStatus && cloudStatus.sse === serialnumber);
        this.log(`[Driver] ${this.id} - cloud login validation result: ${credentialsAreValid ? 'ok' : 'failed'}`);
      } catch (error) {
        this.log('[Driver] cloud login validation failed:', error?.message || error);
      }

      // return true to continue adding the device if the login succeeded
      // return false to indicate to the user the login attempt failed
      // thrown errors will also be shown to the user
      return credentialsAreValid;
    });

    session.setHandler('list_devices', async () => {
      this.log(`[Driver] ${this.id} - list_devices requested for serial ${serialnumber}`);
      const api = new goeChargerAPI(`https://${serialnumber}.api.v3.go-e.io/api`, this, ['sse', 'fna', 'dfam', 'typ', 'styp', 'fwv'], token);
      const cloudStatus = await api.getStatus();
      const model = getModelFromDriverId(this.id);
      this.log(`[Driver] ${this.id} - cloud device reported type: ${cloudStatus.typ || 'unknown'}${cloudStatus.styp ? `/${cloudStatus.styp}` : ''}, expected model: ${model || 'any'}`);
      const matchesModel = matchesDiscoveryModel(
        {
          txt: {
            devicetype: cloudStatus.typ || '',
            devicesubtype: cloudStatus.styp || ''
          }
        },
        model
      );

      if (!matchesModel) {
        this.log(`[Driver] ${this.id} - list_devices filtered out serial ${serialnumber} because model does not match`);
        return [];
      }

      this.log(`[Driver] ${this.id} - list_devices returning serial ${serialnumber}`);

      return [
        {
          name: cloudStatus.fna || serialnumber,
          data: {
            id: serialnumber
          },
          settings: {
            // Store serialnumber & token in settings
            // so the user can change them later
            serialnumber,
            token,
            version: cloudStatus.fwv,
            type: cloudStatus.styp ? `${cloudStatus.typ}/${cloudStatus.styp}` : cloudStatus.typ
          }
        }
      ];
    });
  }
}

module.exports = evChargerCloudDriver;
