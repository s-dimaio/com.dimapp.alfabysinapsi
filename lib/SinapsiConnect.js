const ModbusRTU = require("modbus-serial");
const { TaskScheduler } = require("./TaskScheduler");
const config = require("./config/config");

class SinapsiConnect {
  /**
   * Creates an instance of SinapsiConnect.
   * 
   * @constructor
   * @param {Object} homey - The Homey instance.
   * @param {string} ip - The IP address of the Modbus server.
   * @param {number} [updateInterval=60000] - The interval in milliseconds for updating data.
   * @param {boolean} [showLog=false] - Whether to show log messages.
   * 
   * @example
   * const sinapsiConnect = new SinapsiConnect(homeyInstance, '192.168.1.100', 60000, true);
   */
  constructor(homey, ip, updateInterval = 60000, showLog = false) {
    if (!ip) {
      throw new Error("IP address is required");
    }
    
    this.client = new ModbusRTU();
    this.scheduler = new TaskScheduler(homey, this.readData.bind(this), updateInterval, showLog);
    this.eventDate = undefined;
    this.remainingDisconnectionTime = undefined;
    this.warningTriggered = false;
    config.host = ip;
    this.homey = homey;
    this.showLog = showLog;

    this.client.on('error', err => {
      console.error("Communication error:", err);
      this.client.close(() => {
        this._log("Connection closed. Attempting to reconnect...");
        this.connectModbus();
      });
    });
  }

  _log(...args) {
    if (this.showLog) {
      const timestamp = new Date().toISOString();
      const message = args.join(' ');
      console.log(`%c${timestamp}`, 'color: green', `[SINAPSI-CONNECT] - ${message}`);
    }
  }


  /**
   * Checks if the Modbus device can be connected to without errors.
   * @returns {Promise<boolean>} - Returns true if the connectModbus promise resolves, false if it rejects.
   * @example
   * const sinapsiConnect = new SinapsiConnect();
   * sinapsiConnect.isModbusConnected().then(isConnected => {
   *   if (isConnected) {
   *     console.log('Modbus device is connected.');
   *   } else {
   *     console.log('Failed to connect to Modbus device.');
   *   }
   * });
   */
  isModbusConnected() {
    return this.client.connectTCP(config.host, { port: config.port })
      .then(() => {
        //this.client.setID(1);
        return true;
      })
      .catch(err => {
        return false;
      });
  }


  /**
   * Connects to the Modbus device using TCP.
   */
  connectModbus() {
    if (!config.host) {
      throw new Error("Modbus server IP address is not set");
    }

    this.client.connectTCP(config.host, { port: config.port })
      .then(() => {
        this._log(`Connected to device ${config.name}`);
        this.client.setID(1);
        this.readData();

        return true;
      })
      .catch(err => {
        console.error("Connection error:", err);
        //this.homey.setTimeout(this.connectModbus.bind(this), 5000);

        return false;
      });
  }


  /**
   * Reads data from Modbus holding registers and processes it.
   * Emits 'disconnectionWarning' and 'firstDisconnectionWarning' events when appropriate.
   * @returns {Promise<Array>} A promise that resolves with the sensor data array.
   */
  readData() {
    const sensorDataArray = [];
    const promises = [];

    config.sensors.forEach(sensor => {
      const promise = this.client.readHoldingRegisters(sensor.address, sensor.count)
        .then(data => {
          let value;
          if (sensor.type === "uint32") {
            value = (data.data[0] << 16) | data.data[1];
          } else {
            value = data.data[0];
          }

          if (sensor.id === "alarm_generic") {
            this.eventDate = value;
          } else if (sensor.id === "energy_detachment") {
            this.remainingDisconnectionTime = value;
          }

          this._log(`${sensor.id} - ${sensor.name}: ${value} ${sensor.unit || ''}`);

          sensorDataArray.push({
            id: sensor.id,
            capability: sensor.capability,
            name: sensor.name,
            value: value,
            unit: sensor.unit || ''
          });

          if (this.eventDate !== undefined && this.remainingDisconnectionTime !== undefined) {
            const disconnectionWarning = this.calculateDisconnectionWarning(this.eventDate, this.remainingDisconnectionTime);
            this._log(`Event Date: ${this.eventDate} - Disconnection warning: ${disconnectionWarning}`);

            if (this.eventDate !== -1) {
              this.homey.emit('disconnectionWarning', disconnectionWarning);
              if (!this.warningTriggered) {
                this.warningTriggered = true;
                this.homey.emit('firstDisconnectionWarning', disconnectionWarning);
              }
            } else {
              this.warningTriggered = false;
            }
          } else {
            this.warningTriggered = false;
          }
        })
        .catch(err => {
          console.error(`Error reading ${sensor.name}:`, err);
        });

      promises.push(promise);
    });

    return Promise.all(promises).then(() => {
      return sensorDataArray;
    });
  }


  /**
   * Calculates the disconnection warning based on event date and remaining disconnection time.
   * @param {number} eventDate - The event date in seconds since epoch.
   * @param {number} remainingDisconnectionTime - The remaining disconnection time in seconds.
   * @returns {string} The disconnection warning message.
   */
  calculateDisconnectionWarning(eventDate, remainingDisconnectionTime) {
    if (eventDate === -1) {
      return "No warning";
    } else {
      const disconnectionDate = new Date((eventDate + remainingDisconnectionTime) * 1000);
      return disconnectionDate.toLocaleString();
    }
  }

  /**
   * Starts the Modbus connection and the task scheduler for periodic data reading.
   * @example
   * const SinapsiConnect = require('./SinapsiConnect');
   * const sinapsi = new SinapsiConnect(10000); // Update interval of 10 seconds
   * sinapsi.start();
   */
  start() {
    this.connectModbus();
    if (this.scheduler.isRunning) {
      this.scheduler.stop();
    }
    this.scheduler.start();
  }

  /**
   * Stops the Modbus connection and the task scheduler.
   */
  stop() {
    this._log(`Stopping Modbus connection and task scheduler - client: ${this.client.isOpen} - scheduler: ${this.scheduler.isScheduled}`);
    if (this.client.isOpen) {
      this.client.close(() => {
        this._log("Modbus connection closed.");
      });
    }
    if (this.scheduler.isScheduled) {
      this.scheduler.stop();
    }
  }

  /**
   * Static method to manage a single instance of SinapsiConnect.
   * Stops the existing timer and starts a new one with the given IP.
   * @param {Object} homey - The Homey instance.
   * @param {string} ip - The IP address of the Modbus server.
   * @param {number} [updateInterval=60000] - The interval in milliseconds for updating data.
   * @param {boolean} [showLog=false] - Whether to show log messages.
   * @returns {SinapsiConnect} The SinapsiConnect instance.
   */
  static manageInstance(homey, ip, updateInterval = 60000, showLog = false) {
    if (SinapsiConnect.instance) {
      SinapsiConnect.instance.stop();
    }
    SinapsiConnect.instance = new SinapsiConnect(homey, ip, updateInterval, showLog);
    SinapsiConnect.instance.start();
    return SinapsiConnect.instance;
  }
}

module.exports = SinapsiConnect;