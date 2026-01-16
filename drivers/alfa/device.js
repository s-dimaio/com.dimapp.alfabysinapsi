'use strict';

const Homey = require('homey');
const SinapsiConnect = require('../../lib/SinapsiConnect');
const FileLogger = require('../../lib/FileLogger');

const DEBUG_MODE = false; // Set to true to enable debug logs

module.exports = class AlfaDevice extends Homey.Device {

  _registerAlfaListeners() {
    if (!this.sinapsi) {
      this.error('Cannot register listeners: sinapsi not initialized');
      this._fileLog('error', 'DEVICE', 'Cannot register listeners: sinapsi not initialized');
      return;
    }

    // Remove any existing listeners from SinapsiConnect instance to prevent memory leaks
    this.sinapsi.removeAllListeners('taskCompleted');
    this.sinapsi.removeAllListeners('disconnectionWarning');
    this.sinapsi.removeAllListeners('firstDisconnectionWarning');
    this.sinapsi.removeAllListeners('stopWarning');
    this.sinapsi.removeAllListeners('connectionLost');
    this.sinapsi.removeAllListeners('connectionRestored');
    this.sinapsi.removeAllListeners('maxReconnectAttemptsReached');

    // Store listener references for cleanup
    this.onTaskCompleted = async (sensorDataArray) => {
      // Log warning if sensor data is empty (potential issue)
      if (sensorDataArray.length === 0) {
        this.error('⚠️ Received empty sensor data array');
        this._fileLog('warn', 'DEVICE', 'Received empty sensor data array - possible read failure');
        return;
      }
      
      // Get the energy monitoring preference
      const showEnergyMonitoring = this.getStoreValue('showEnergyMonitoring');
      // Treat undefined (not set) as false: energy exported is disabled by default
      const enableEnergyMonitoring = showEnergyMonitoring === true;
      let updatedCapabilities = 0;
      let failedCapabilities = 0;

      for (const sensor of sensorDataArray) {
        if (!sensor.capability) continue;

        // Skip meter_power.exported if energy monitoring is disabled
        if (!enableEnergyMonitoring && sensor.id === 'meter_power.exported') {
          this.log('Skipping meter_power.exported (energy monitoring disabled)');
          continue;
        }

        let value = sensor.value;

        // Convert value based on data type
        if (sensor.type === 'int16' || sensor.type === 'uint16' || sensor.type === 'uint32') {
          value = Number(value);
        } else if (sensor.type === 'float') {
          value = parseFloat(value);
        }

        // Apply conversion factor
        if (sensor.conversionFactor) {
          value = value * sensor.conversionFactor;
        }

        // Special handling for specific capabilities
        if (sensor.id === 'alarm_generic') {
          value = (sensor.value !== -1);
        } else if (sensor.id === 'energy_phase') {
          value = `F${sensor.value}`;
        } else if (sensor.unit === 'Wh') {
          value = value / 1000; // Convert to kWh
        }

        // Only update value if capability exists
        if (this.hasCapability(sensor.id)) {
          try {
            const currentValue = this.getCapabilityValue(sensor.id);
            if (currentValue !== value) {
              await this.setCapabilityValue(sensor.id, value);
              updatedCapabilities++;
            }
          } catch (error) {
            failedCapabilities++;
            this.error(`Failed to set capability ${sensor.id}:`, error);
            
            // Log capability errors to file
            if (this.fileLogger) {
              this.fileLogger.logCapabilityError(sensor.id, error);
            }
          }
        } else {
          this.log(`Capability ${sensor.id} not found on device, skipping`);
        }
      }
      
      // Log if there were failures
      if (failedCapabilities > 0) {
        this._fileLog('warn', 'DEVICE', `Capability update: ${updatedCapabilities} success, ${failedCapabilities} failed`);
      }
    };

    this.onDisconnectionWarning = (seconds) => {
      this.log(`disconnectionWarning event: disconnection in ${seconds} seconds`);
      this._fileLog('info', 'DEVICE', `Disconnection warning: ${seconds} seconds`);

      const disconnectionWarningTrigger = this.homey.flow.getDeviceTriggerCard("disconnection_warning");

      const tokens = {
        seconds: seconds
      };

      disconnectionWarningTrigger.trigger(this, tokens)
        .catch(this.error);

    };

    this.onFirstDisconnectionWarning = (seconds) => {
      this.log(`firstDisconnectionWarning event: disconnection in ${seconds} seconds`);
      this._fileLog('info', 'DEVICE', `First disconnection warning: ${seconds} seconds`);

      const firstDisconnectionWarningTrigger = this.homey.flow.getDeviceTriggerCard("first_disconnection_warning");

      const tokens = {
        seconds: seconds
      };

      firstDisconnectionWarningTrigger.trigger(this, tokens)
        .catch(this.error);
    };

    this.onStopWarning = () => {
      this.log('stopWarning event called!');
      this._fileLog('info', 'DEVICE', 'Disconnection warning ended');

      const stopWarningTrigger = this.homey.flow.getDeviceTriggerCard("stop_warning");

      stopWarningTrigger.trigger(this)
        .catch(this.error);
    };

    this.onConnectionLost = (reason) => {
      this.error(`Modbus connection lost: ${reason}`);
      this._fileLog('error', 'DEVICE', `Modbus connection lost: ${reason}`);
      this.setUnavailable(this.homey.__('error.connectionLost')).catch(this.error);
    };

    this.onConnectionRestored = () => {
      this.log('Modbus connection restored');
      this._fileLog('info', 'DEVICE', 'Modbus connection restored');
      this.setAvailable().catch(this.error);
    };

    this.onMaxReconnectAttemptsReached = () => {
      this.error('Maximum reconnection attempts reached. App restart required.');
      this._fileLog('error', 'DEVICE', 'Maximum reconnection attempts reached. App restart required.');
      this.setUnavailable(this.homey.__('error.maxReconnectAttempts')).catch(this.error);
    };

    // Register all listeners on SinapsiConnect instance
    this.sinapsi.on('taskCompleted', this.onTaskCompleted);
    this.sinapsi.on('disconnectionWarning', this.onDisconnectionWarning);
    this.sinapsi.on('firstDisconnectionWarning', this.onFirstDisconnectionWarning);
    this.sinapsi.on('stopWarning', this.onStopWarning);
    this.sinapsi.on('connectionLost', this.onConnectionLost);
    this.sinapsi.on('connectionRestored', this.onConnectionRestored);
    this.sinapsi.on('maxReconnectAttemptsReached', this.onMaxReconnectAttemptsReached);
    
    this._fileLog('info', 'DEVICE', 'All listeners registered successfully');
  }

  /**
   * Helper for logging to file
   */
  _fileLog(level, component, message, details = null) {
    if (!this.fileLogger) return;
    
    switch (level) {
      case 'error':
        this.fileLogger.error(component, message, details);
        break;
      case 'warn':
        this.fileLogger.warn(component, message, details);
        break;
      case 'info':
        this.fileLogger.info(component, message, details);
        break;
      default:
        this.fileLogger.debug(component, message);
    }
  }

  /**
   * Initializes the SinapsiConnect instance and checks the Modbus connection.
   * @param {string} ip - The IP address of the Modbus server.
   */
  async _initializeSinapsiConnect(ip) {
    if (!ip) {
      this.error('IP address is required');
      this._fileLog('error', 'INIT', 'IP address is required');
      this.setUnavailable(this.homey.__("error.ipEmpty")).catch(this.error);
      return;
    }

    try {
      const showEnergyMonitoring = this.getStoreValue('showEnergyMonitoring');
      // Treat undefined (not set) as false: energy exported is disabled by default
      const enableEnergyMonitoring = showEnergyMonitoring === true;

      this._fileLog('info', 'INIT', `Initializing connection to ${ip}`, {
        energyMonitoring: enableEnergyMonitoring,
        debugMode: DEBUG_MODE
      });

      this.sinapsi = SinapsiConnect.manageInstance(
        this.homey,
        ip,
        15000, // Use 15 seconds for production
        DEBUG_MODE,
        enableEnergyMonitoring,
        this.fileLogger // Pass FileLogger to SinapsiConnect
      );

      // Register listeners AFTER creating instance
      this._registerAlfaListeners();

      // Wait to verify connection
      await this.delay(3000);
      
      if (this.sinapsi.isConnected) {
        this.log('Modbus device is connected.');
        this._fileLog('info', 'INIT', 'Modbus device connected successfully');
        this.setAvailable().catch(this.error);
      } else {
        this.error('Failed to connect to Modbus device.');
        this._fileLog('error', 'INIT', 'Failed to connect to Modbus device');
        this.setUnavailable(this.homey.__("error.ipWrong")).catch(this.error);
      }
    } catch (error) {
      this.error('Failed to initialize SinapsiConnect:', error);
      this._fileLog('error', 'INIT', `Failed to initialize: ${error.message}`);
      if (this.sinapsi) {
        await this.sinapsi.stop();
      }
      this.setUnavailable(this.homey.__("error.generic")).catch(this.error);
    }
  }

  /**
   * Debug method to check memory usage and active listeners.
   * Can be called manually for on-demand debugging.
   * Note: Periodic memory logging is handled by FileLogger automatically (every 6 hours).
   * @returns {Object} Memory usage and listener counts
   */
  async debugMemoryUsage() {
    const usage = process.memoryUsage();
    
    const debugInfo = {
      memory: {
        rss: `${(usage.rss / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        external: `${(usage.external / 1024 / 1024).toFixed(2)} MB`
      },
      listeners: null,
      sinapsiDiagnostics: null
    };
    
    this.log('='.repeat(50));
    this.log('📊 MEMORY DEBUG (on-demand):');
    this.log(`  RSS: ${debugInfo.memory.rss}`);
    this.log(`  Heap Used: ${debugInfo.memory.heapUsed}`);
    this.log(`  Heap Total: ${debugInfo.memory.heapTotal}`);
    this.log(`  External: ${debugInfo.memory.external}`);
    
    if (this.sinapsi) {
      debugInfo.listeners = {
        taskCompleted: this.sinapsi.listenerCount('taskCompleted'),
        disconnection: this.sinapsi.listenerCount('disconnectionWarning'),
        firstDisconnection: this.sinapsi.listenerCount('firstDisconnectionWarning'),
        stopWarning: this.sinapsi.listenerCount('stopWarning')
      };
      
      debugInfo.sinapsiDiagnostics = this.sinapsi.getDiagnostics();
      
      this.log('👂 Active Listeners on SinapsiConnect:', debugInfo.listeners);
      this.log('📈 Sinapsi Diagnostics:', debugInfo.sinapsiDiagnostics);
      
      // Warn if too many listeners
      Object.entries(debugInfo.listeners).forEach(([event, count]) => {
        if (count > 2) {
          this.error(`⚠️ TOO MANY LISTENERS for ${event}: ${count}`);
        }
      });
    }
    
    this.log('='.repeat(50));
    
    // Log to file for later consultation
    this._fileLog('info', 'DEBUG', 'Memory and diagnostics snapshot', debugInfo);
    
    return debugInfo;
  }

  /**
   * Get recent logs from file for remote debugging
   */
  async getRecentLogs(lines = 100) {
    if (!this.fileLogger) {
      return 'FileLogger not initialized';
    }
    return await this.fileLogger.getLastLines(lines);
  }

  /**
   * Delay helper function
   * @param {number} ms - Milliseconds to wait
   */
  delay(ms) {
    return new Promise(resolve => this.homey.setTimeout(resolve, ms));
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('AlfaDevice has been initialized');
    
    // Initialize FileLogger only if enabled in app settings
    // Note: FileLogger handles periodic memory logging automatically (every 6 hours)
    const enableFileLogging = this.homey.settings.get('enableFileLogging') === true;
    if (enableFileLogging) {
      try {
        this.fileLogger = new FileLogger(this.homey, {
          maxFileSize: 500 * 1024, // 500KB
          maxBackups: 2,
          clearOnStart: false
        });
        this._fileLog('info', 'DEVICE', 'Device initialization started (file logging enabled)');
      } catch (error) {
        this.error('Failed to initialize FileLogger:', error);
        // Continue without FileLogger
      }
    } else {
      this.log('File logging disabled (enable in app settings if needed)');
    }
    
    const ip = this.getSettings().ipAddress;
    
    // Get the showEnergyMonitoring preference from device store
    // Treat undefined (not set) as false so exported energy is disabled by default
    const showEnergyMonitoring = this.getStoreValue('showEnergyMonitoring');
    const enableEnergyMonitoring = showEnergyMonitoring === true; // true only if explicitly set to true
    
    this.log('Energy monitoring enabled:', enableEnergyMonitoring);
    this._fileLog('info', 'DEVICE', `Device config: IP=${ip}, energyMonitoring=${enableEnergyMonitoring}`);
    
    // Remove exported energy capability if monitoring is disabled
    if (!enableEnergyMonitoring && this.hasCapability('meter_power.exported')) {
      await this.removeCapability('meter_power.exported').catch(this.error);
      this.log('Removed meter_power.exported capability');
      this._fileLog('info', 'DEVICE', 'Removed meter_power.exported capability');
    }
    
    await this._initializeSinapsiConnect(ip);
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('AlfaDevice has been added');
    this._fileLog('info', 'DEVICE', 'Device added');
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
    this.log('AlfaDevice settings where changed');
    this._fileLog('info', 'DEVICE', 'Settings changed', { changedKeys });

    if (changedKeys.includes('ipAddress')) {
      const ipNew = newSettings.ipAddress;
      this._fileLog('info', 'DEVICE', `IP address changed: ${oldSettings.ipAddress} -> ${ipNew}`);
      
      // Stop old instance
      if (this.sinapsi) {
        await this.sinapsi.stop();
      }
      
      await this._initializeSinapsiConnect(ipNew);
    }
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('AlfaDevice was renamed');
    this._fileLog('info', 'DEVICE', `Device renamed to: ${name}`);
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('AlfaDevice has been deleted');
    this._fileLog('info', 'DEVICE', 'Device deletion started');
    
    // Remove all event listeners from SinapsiConnect instance to prevent memory leaks
    if (this.sinapsi) {
      if (this.onTaskCompleted) {
        this.sinapsi.removeListener('taskCompleted', this.onTaskCompleted);
      }
      if (this.onDisconnectionWarning) {
        this.sinapsi.removeListener('disconnectionWarning', this.onDisconnectionWarning);
      }
      if (this.onFirstDisconnectionWarning) {
        this.sinapsi.removeListener('firstDisconnectionWarning', this.onFirstDisconnectionWarning);
      }
      if (this.onStopWarning) {
        this.sinapsi.removeListener('stopWarning', this.onStopWarning);
      }
      if (this.onConnectionLost) {
        this.sinapsi.removeListener('connectionLost', this.onConnectionLost);
      }
      if (this.onConnectionRestored) {
        this.sinapsi.removeListener('connectionRestored', this.onConnectionRestored);
      }
      if (this.onMaxReconnectAttemptsReached) {
        this.sinapsi.removeListener('maxReconnectAttemptsReached', this.onMaxReconnectAttemptsReached);
      }
      
      await this.sinapsi.stop();
      this.sinapsi = null;
    }
    
    // Cleanup listener references
    this.onTaskCompleted = null;
    this.onDisconnectionWarning = null;
    this.onFirstDisconnectionWarning = null;
    this.onStopWarning = null;
    this.onConnectionLost = null;
    this.onConnectionRestored = null;
    this.onMaxReconnectAttemptsReached = null;
    
    // Cleanup FileLogger
    if (this.fileLogger) {
      this._fileLog('info', 'DEVICE', 'Device deletion completed, cleaning up logger');
      await this.fileLogger.destroy();
      this.fileLogger = null;
    }
    
    this.log('All resources cleaned up successfully');
  }

};
