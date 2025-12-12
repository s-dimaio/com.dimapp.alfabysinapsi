'use strict';

const Homey = require('homey');


module.exports = class AlfaApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('AlfaApp has been initialized');

  }

};
