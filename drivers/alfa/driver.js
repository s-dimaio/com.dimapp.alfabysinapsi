'use strict';

const Homey = require('homey');
const SinapsiConnect = require('../../lib/SinapsiConnect');

module.exports = class MyDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('MyDriver has been initialized');
  }

  onPair(session) {
    let ip;

    // Manages the AmazonPage radio button changes
    session.setHandler("getIpAddress", async (ipAddress) => {
      this.log('getIpAddress called: ', ipAddress);

      //192.168.178.48
      const sinapsi = new SinapsiConnect(
        this.homey,
        ipAddress
      );

      sinapsi.isModbusConnected().then(async (isConnected) => {
        if (isConnected) {
          ip = ipAddress;
          session.showView('list_alfa_devices');
        } else {
          await session.emit("ipError");
        }
      });
    });

    session.setHandler("list_devices", async () => {
      this.log('onPair - ListDevices called - ip: ', ip);

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
        },
      ];
    });
  }
};
