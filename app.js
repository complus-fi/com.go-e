'use strict';

const Homey = require('homey');
const flowActions = require('./lib/flows/actions');

module.exports = class GoEApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    await flowActions.init(this.homey);
    this.log('Go-e App has been initialized');
  }
};
