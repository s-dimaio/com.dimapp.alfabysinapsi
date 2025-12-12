'use strict';

const Homey = require('homey');
const SinapsiConnect = require('../../lib/SinapsiConnect');

module.exports = class AlfaDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('AlfaDriver has been initialized');
  }

  onPair(session) {
    let ip;
    let showEnergyMonitoring = false; // Default value changed to false

    // Handles the IP address and energy monitoring checkbox
    session.setHandler("getIpAddress", async (data) => {
      // Support both old format (string) and new format (object)
      const ipAddress = typeof data === 'string' ? data : data.ip;
      const energyMonitoring = typeof data === 'string' ? false : Boolean(data.showEnergyMonitoring);
      
      this.log('getIpAddress called - IP:', ipAddress, 'Energy Monitoring:', energyMonitoring);

      // Pass energyMonitoring flag to SinapsiConnect for connection test
      const sinapsi = new SinapsiConnect(
        this.homey,
        ipAddress,
        30000,
        false,
        energyMonitoring
      );

      sinapsi.isModbusConnected().then(async (isConnected) => {
        if (isConnected) {
          ip = ipAddress;
          showEnergyMonitoring = energyMonitoring;
          session.showView('list_alfa_devices');
        } else {
          await session.emit("ipError");
        }
      });
    });

    session.setHandler("list_devices", async () => {
      this.log('onPair - ListDevices called - IP:', ip, 'Energy Monitoring:', showEnergyMonitoring);

      return [
        // Example device data, note that `store` is optional
        {
          name: 'Alfa by Sinapsi',
          data: {
            id: `alfa_${ip}`,
          },
          settings: {
            ipAddress: ip,
          },
          store: {
            showEnergyMonitoring: showEnergyMonitoring,
          },
        },
      ];
    });
  }
};
