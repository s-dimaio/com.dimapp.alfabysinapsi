'use strict';

const Homey = require('homey');
const SinapsiConnect = require('../../lib/SinapsiConnect');

module.exports = class MyDevice extends Homey.Device {

  _registerAlfaListeners() {
    this.homey.on('taskCompleted', async (sensorDataArray) => {
      const promises = []; // Capture all await promises

      sensorDataArray.forEach(sensor => {
        if (sensor.capability) {
          if (!this.hasCapability(sensor.id)) {
            promises.push(this.addCapability(sensor.id).catch(this.error));
          }

          let value;
          if (sensor.id === 'alarm_generic') {
            value = (sensor.value !== -1);
          } else if (sensor.id === 'energy_phase') {
            value = `F${sensor.value}`;
          } else {
            value = (sensor.unit === 'Wh') ? sensor.value / 1000 : sensor.value;
          }

          // Update value
          if (this.getCapabilityValue(sensor.id) != value) {
            promises.push(this.setCapabilityValue(sensor.id, value).catch(this.error));
          }
        }
      });

      // Execute all promises concurrently using Promise.all()
      await Promise.all(promises);
    });

    this.homey.on('disconnectionWarning', (seconds) => {
      this.log(`disconnectionWarning event: disconnection in ${seconds} seconds`);

      const disconnectionWarningTrigger = this.homey.flow.getTriggerCard("disconnection_warning");

      const tokens = {
        seconds: seconds
      };

      disconnectionWarningTrigger.trigger(tokens)
        .then(this.log)
        .catch(this.error);

    });

    this.homey.on('firstDisconnectionWarning', (seconds) => {
      this.log(`firstDisconnectionWarning event: disconnection in ${seconds} seconds`);

      const firstDisconnectionWarningTrigger = this.homey.flow.getTriggerCard("first_disconnection_warning");

      const tokens = {
        seconds: seconds
      };

      firstDisconnectionWarningTrigger.trigger(tokens)
        .then(this.log)
        .catch(this.error);
    });

    this.homey.on('stopWarning', () => {
      this.log('stopWarning event called!');

      const stopWarningTrigger = this.homey.flow.getTriggerCard("stop_warning");

      stopWarningTrigger.trigger()
        .then(this.log)
        .catch(this.error);
    });
  }

  /**
   * Initializes the SinapsiConnect instance and checks the Modbus connection.
   * @param {string} ip - The IP address of the Modbus server.
   */
  async _initializeSinapsiConnect(ip) {
    if (!ip) {
      this.error('IP address is required');
      this.setUnavailable(this.homey.__("error.ipEmpty")).catch(this.error);
      return;
    }

    try {
      //192.168.178.48
      this.sinapsi = SinapsiConnect.manageInstance(
        this.homey,
        ip,
        10000,
        false
      );

      const isConnected = await this.sinapsi.isModbusConnected();
      if (isConnected) {
        this.log('Modbus device is connected.');

        this.setAvailable().catch(this.error);
      } else {
        this.error('Failed to connect to Modbus device.');

        this.sinapsi.stop(); // Stop Modbus connection and timer
        this.setUnavailable(this.homey.__("error.ipWrong")).catch(this.error);
      }
    } catch (error) {
      this.error('Failed to initialize SinapsiConnect:', error);

      this.sinapsi.stop(); // Stop Modbus connection and timer
      this.setUnavailable(this.homey.__("error.generic")).catch(this.error);
    }
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('MyDevice has been initialized');
    const ip = this.getSettings().ipAddress;
    this._registerAlfaListeners();
    await this._initializeSinapsiConnect(ip);
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('MyDevice has been added');
    const ip = this.getSettings().ipAddress;
    await this._initializeSinapsiConnect(ip);
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
    this.log('MyDevice settings where changed');

    if (changedKeys.includes('ipAddress')) {
      const ipNew = newSettings.ipAddress;
      await this._initializeSinapsiConnect(ipNew);
    }
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('MyDevice was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('MyDevice has been deleted');
    if (this.sinapsi) {
      this.sinapsi.stop(); // Stop Modbus connection and timer
    }
  }

};
