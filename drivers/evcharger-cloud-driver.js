'use strict';

const evChargerDriver = require('evcharger-driver');
const goeChargerAPI = require('../lib/go-eCharger-API-v2');
const { getModelFromDriverId } = require('../lib/mappings');

class evChargerCloudDriver extends evChargerDriver.Driver {
  onInit() {
    this.log('[Driver] - init', this.id);
    this.log('[Driver] - version', this.homey.app.manifest.version);
  }

  async onPair(session) {
    let username = "";
    let password = "";

    session.setHandler("login", async (data) => {
      username = data.username;
      password = data.password;

      const credentialsAreValid = await goeChargerAPI.testCredentials({
        username,
        password,
      });

      // return true to continue adding the device if the login succeeded
      // return false to indicate to the user the login attempt failed
      // thrown errors will also be shown to the user
      return credentialsAreValid;
    });

    session.setHandler("list_devices", async () => {
      const api = await goeChargerAPI.login({ username, password });
      const myDevices = await api.getDevices();

      const devices = myDevices.map((myDevice) => {
        return {
          name: myDevice.name,
          data: {
            id: myDevice.id,
          },
          settings: {
            // Store username & password in settings
            // so the user can change them later
            username,
            password,
          },
        };
      });

      return devices;
    });
  }
}

module.exports = evChargerCloudDriver;
