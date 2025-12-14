const ModbusRTU = require("modbus-serial");
const { TaskScheduler } = require("./TaskScheduler");
const EventEmitter = require('events');
const config = require("./config/config");

class SinapsiConnect extends EventEmitter {
  /**
   * Sentinel value indicating no active disconnection alarm (Alfa standard: 0xFFFFFFFF)
   * @constant {number}
   */
  static DISCONNECT_ALARM_INACTIVE = 4294967295;

  /**
   * Creates an instance of SinapsiConnect.
   * 
   * @constructor
   * @param {Object} homey - The Homey instance.
   * @param {string} ip - The IP address of the Modbus server.
   * @param {number} [updateInterval=30000] - The interval in milliseconds for updating data.
   * @param {boolean} [showLog=false] - Whether to show log messages.
   * @param {boolean} [showEnergyMonitoring=true] - Whether to include energy monitoring sensors.
   * @param {Object} [fileLogger=null] - FileLogger instance for persistent logging.
   * 
   * @example
   * const sinapsiConnect = new SinapsiConnect(homeyInstance, '192.168.1.100', 30000, true, true);
   */
  constructor(homey, ip, updateInterval = 30000, showLog = false, showEnergyMonitoring = true, fileLogger = null) {
    super();
    
    if (!ip) {
      throw new Error("IP address is required");
    }
    
    // Set max listeners to prevent memory leak warnings
    this.setMaxListeners(20);
    
    this.client = new ModbusRTU();
    this.eventDate = undefined;
    this.remainingDisconnectionTime = undefined;
    this.warningTriggered = false;
    
    // Local countdown tracking (independent from Modbus delays)
    this.countdownStartTime = null;
    this.countdownStartValue = null;
    
    config.host = ip;
    this.homey = homey;
    this.showLog = showLog;
    this.fileLogger = fileLogger; // FileLogger for persistent logging
    
    // Freeze sensors array to prevent modifications and optimize memory
    this.sensors = Object.freeze(
      config.sensors.filter(sensor => 
        showEnergyMonitoring || sensor.id !== "meter_power.exported"
      )
    );
    
    // State management flags
    this.isReading = false;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10; // Increased from 5 (HA pattern: more resilient)
    this.reconnectDelay = 5000; // Reduced from 10s to 5s for faster recovery
    this.reconnectTimeouts = []; // Track reconnection timeouts for cleanup
    this.connectionCheckInterval = null; // Periodic connection health check
    
    // Diagnostic counters for debugging
    this.diagnostics = {
      totalReadCycles: 0,
      successfulReadCycles: 0,
      failedReadCycles: 0,
      lastSuccessTime: null,
      lastFailTime: null,
      lastError: null,
      consecutiveFailures: 0,
      socketResets: 0,
      schedulerRestarts: 0
    };
    
    // Create scheduler after initializing everything
    this.scheduler = new TaskScheduler(homey, this.readData.bind(this), updateInterval, showLog);

    this.client.on('error', err => {
      const errorMsg = err.message || String(err);
      this._logError('CLIENT', `Communication error: ${errorMsg}`);
      this.diagnostics.lastError = errorMsg;
      this.isConnected = false;
      this.client.close(() => {
        this._logInfo('CLIENT', 'Connection closed after error. Attempting to reconnect...');
        this._scheduleReconnect('client error');
      });
    });
    // NOTE: socket handlers are attached after a successful connect in connectModbus()
  }

  /**
   * Schedules a reconnection attempt with deduplication
   * @param {string} reason - The reason for reconnection
   */
  _scheduleReconnect(reason) {
    // Avoid scheduling multiple reconnections
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._logError('RECONNECT', `Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`, this.getDiagnostics());
      return;
    }
    
    // Check if reconnection is already scheduled
    if (this.reconnectTimeouts.length > 0) {
      this._logInfo('RECONNECT', 'Reconnection already scheduled, skipping duplicate');
      return;
    }
    
    this.reconnectAttempts++;
    this._logInfo('RECONNECT', `Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} (reason: ${reason})`);
    
    if (this.fileLogger) {
      this.fileLogger.recordReconnection(this.reconnectAttempts, this.maxReconnectAttempts, reason);
    }
    
    const timeoutId = this.homey.setTimeout(() => {
      // Remove this timeout from the array
      const index = this.reconnectTimeouts.indexOf(timeoutId);
      if (index > -1) {
        this.reconnectTimeouts.splice(index, 1);
      }
      this.connectModbus();
    }, this.reconnectDelay);
    
    this.reconnectTimeouts.push(timeoutId);
  }

  _log(...args) {
    if (this.showLog) {
      const timestamp = new Date().toISOString();
      const message = args.join(' ');
      console.log(`%c${timestamp}`, 'color: green', `[SINAPSI-CONNECT] - ${message}`);
    }
  }

  _logError(component, message, details = null) {
    console.error(`[SINAPSI-CONNECT] [${component}] ${message}`);
    if (this.fileLogger) {
      this.fileLogger.error(`SINAPSI-${component}`, message, details);
    }
  }

  _logWarn(component, message, details = null) {
    console.warn(`[SINAPSI-CONNECT] [${component}] ${message}`);
    if (this.fileLogger) {
      this.fileLogger.warn(`SINAPSI-${component}`, message, details);
    }
  }

  _logInfo(component, message, details = null) {
    this._log(message);
    if (this.fileLogger) {
      this.fileLogger.info(`SINAPSI-${component}`, message, details);
    }
  }

  /**
   * Returns diagnostic information for debugging
   */
  getDiagnostics() {
    return {
      ...this.diagnostics,
      isConnected: this.isConnected,
      isReading: this.isReading,
      reconnectAttempts: this.reconnectAttempts,
      schedulerRunning: this.scheduler?.isScheduled || false,
      pendingTimeouts: this.reconnectTimeouts.length,
      socketHealthy: this._isConnectionHealthy()
    };
  }

  /**
   * Checks if the TCP socket connection is truly healthy (HA pattern)
   * Less aggressive check: socket.readable/writable can be false during idle
   * without meaning the connection is actually broken.
   * @returns {boolean} - True if connection appears healthy
   */
  _isConnectionHealthy() {
    if (!this.client) return false;
    if (!this.isConnected) return false;
    
    // Check if client reports open
    if (!this.client.isOpen) return false;
    
    // Only check socket.destroyed - readable/writable are unreliable during idle
    const socket = this.client._socket;
    if (socket && socket.destroyed) return false;
    
    return true;
  }

  /**
   * Ensures connection is established before operations (HA pattern: lazy reconnection)
   * @returns {Promise<boolean>} - True if connected, false otherwise
   */
  async ensureConnected() {
    // Check if connection is truly healthy
    if (this.isConnected && this._isConnectionHealthy()) {
      return true;
    }
    
    // Connection not healthy, mark as disconnected (only log if was previously connected)
    if (this.isConnected && !this._isConnectionHealthy()) {
      const reason = !this.client ? 'no client' : 
                     !this.client.isOpen ? 'client not open' : 
                     (this.client._socket?.destroyed ? 'socket destroyed' : 'unknown');
      this._logWarn('CONNECTION', `Connection unhealthy (${reason}), will attempt reconnection`);
      this.isConnected = false;
      
      if (this.fileLogger) {
        this.fileLogger.logConnectionStateChange('connected', 'disconnected', `unhealthy: ${reason}`);
      }
    }
    
    // Try to reconnect if not connected
    if (!this.isConnected) {
      this._logInfo('CONNECTION', 'ensureConnected: attempting to establish connection...');
      
      try {
        // Close existing client if any
        if (this.client && this.client.isOpen) {
          try {
            this.client.close(() => {});
          } catch (e) { /* ignore */ }
        }
        
        // Create fresh client
        this.client = new (require("modbus-serial"))();
        
        await this.client.connectTCP(config.host, { port: config.port });
        
        this.client.setTimeout(5000);
        this.client.setID(1);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.diagnostics.consecutiveFailures = 0;
        
        // Setup socket handlers
        this._setupSocketHandlers();
        
        this._logInfo('CONNECTION', 'ensureConnected: connection established successfully');
        
        if (this.fileLogger) {
          this.fileLogger.logConnectionStateChange('disconnected', 'connected', 'ensureConnected success');
        }
        
        return true;
      } catch (err) {
        this._logError('CONNECTION', `ensureConnected failed: ${err.message}`);
        this.isConnected = false;
        this.diagnostics.lastError = err.message;
        return false;
      }
    }
    
    return this.isConnected;
  }

  /**
   * Setup socket event handlers with TCP keep-alive (extracted for reuse)
   */
  _setupSocketHandlers() {
    const socket = this.client._socket;
    if (!socket) return;
    
    // Remove all previous listeners to prevent duplicates
    socket.removeAllListeners('timeout');
    socket.removeAllListeners('close');
    socket.removeAllListeners('error');
    
    // Enable TCP Keep-Alive to detect dead connections (HA pattern)
    socket.setKeepAlive(true, 30000); // Ping every 30 seconds
    
    // Attach new handlers
    socket.on('timeout', () => {
      this._logWarn('SOCKET', 'Socket timeout detected');
      this.diagnostics.socketResets++;
      const wasConnected = this.isConnected;
      this.isConnected = false;
      
      if (wasConnected && this.fileLogger) {
        this.fileLogger.logConnectionStateChange('connected', 'disconnected', 'socket timeout');
      }
      
      try { socket.end(); } catch (e) { /* ignore */ }
    });
    
    socket.on('close', () => {
      this._logWarn('SOCKET', 'Socket closed');
      this.diagnostics.socketResets++;
      const wasConnected = this.isConnected;
      this.isConnected = false;
      
      if (wasConnected && this.fileLogger) {
        this.fileLogger.logConnectionStateChange('connected', 'disconnected', 'socket closed');
      }
    });
    
    socket.on('error', (err) => {
      this._logError('SOCKET', `Socket error: ${err.message}`);
      this.diagnostics.lastError = err.message;
      this.isConnected = false;
    });
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
      this._logError('CONNECT', 'Modbus server IP address is not set');
      throw new Error("Modbus server IP address is not set");
    }

    this._logInfo('CONNECT', `Attempting connection to ${config.host}:${config.port}`);

    this.client.connectTCP(config.host, { port: config.port })
      .then(() => {
        const oldState = this.isConnected;
        this._logInfo('CONNECT', `Connected to device ${config.name}`);
        
        // Set Modbus timeout to prevent indefinite hangs
        this.client.setTimeout(5000);
        this.client.setID(1);
        this.isConnected = true;
        
        // Log state change if was disconnected
        if (!oldState && this.fileLogger) {
          this.fileLogger.logConnectionStateChange('disconnected', 'connected', 'TCP connection established');
        }
        
        // Reset reconnection counters
        if (this.reconnectAttempts > 0) {
          this._logInfo('CONNECT', `Reconnected after ${this.reconnectAttempts} attempts`);
        }
        this.reconnectAttempts = 0;
        this.diagnostics.consecutiveFailures = 0;

        // Setup socket handlers with TCP keep-alive
        this._setupSocketHandlers();

        // Ensure the scheduler is running once connected (start it if it was not started)
        if (this.scheduler && !this.scheduler.isScheduled) {
          this._logInfo('SCHEDULER', 'Connection established, starting scheduler.');
          this.diagnostics.schedulerRestarts++;
          this.scheduler.start();
        }

        return true;
      })
      .catch(err => {
        this._logError('CONNECT', `Connection error: ${err.message}`);
        this.diagnostics.lastError = err.message;
        this.isConnected = false;
        
        this._scheduleReconnect('connection failed');
        
        return false;
      });
  }


  /**
   * Reads data from Modbus holding registers and processes it.
   * Emits 'disconnectionWarning' and 'firstDisconnectionWarning' events when appropriate.
   * @returns {Promise<Array>} A promise that resolves with the sensor data array.
   */
  async readData() {
    this.diagnostics.totalReadCycles++;
    
    // Protection against concurrent calls
    if (this.isReading) {
      this._logWarn('READ', '⚠️ Read operation already in progress, skipping');
      return [];
    }

    this.isReading = true;
    
    // HA Pattern: Ensure connection before every read cycle
    const connected = await this.ensureConnected();
    if (!connected) {
      this._logWarn('READ', 'Could not establish connection, skipping read cycle');
      this.diagnostics.failedReadCycles++;
      this.diagnostics.consecutiveFailures++;
      this.isReading = false;
      
      // Log if too many consecutive failures
      if (this.diagnostics.consecutiveFailures === 5) {
        this._logError('READ', 'WARNING: 5 consecutive read failures', this.getDiagnostics());
      } else if (this.diagnostics.consecutiveFailures === 20) {
        this._logError('READ', 'CRITICAL: 20 consecutive read failures', this.getDiagnostics());
      }
      
      return [];
    }

    const startTime = Date.now();
    const sensorDataArray = [];
    let readErrors = 0;
    let powerValue = null;

    try {
      // HA Pattern: Read each sensor, continue on individual errors
      for (const sensor of this.sensors) {
        const result = await this._readSingleSensor(sensor);
        
        if (result === null) {
          readErrors++;
          // HA Pattern: Skip failed sensor, try next one
          // Connection state is already handled by _readSingleSensor
          // ensureConnected() at the start of next cycle will handle reconnection if needed
          continue;
        }
        
        // Track power value for diagnostics
        if (sensor.id === "measure_power") {
          powerValue = result.value;
        }

        if (sensor.id === "alarm_generic") {
          // Robust sentinel value handling:
          // Device can return -1 (int16), 65535 (uint16), or 4294967295 (uint32) for "no alarm"
          // Normalize all to -1 for consistency
          const rawValue = result.value;
          this.eventDate = (rawValue === -1 || rawValue === 65535 || rawValue === SinapsiConnect.DISCONNECT_ALARM_INACTIVE) ? -1 : rawValue;
          
          // Debug log for alarm state tracking
          if (this.fileLogger) {
            this.fileLogger.info('ALARM-DEBUG', `Event Date raw: ${rawValue} → normalized: ${this.eventDate}`);
          }
        } else if (sensor.id === "energy_detachment") {
          this.remainingDisconnectionTime = result.value;
          
          // Debug log for countdown tracking
          if (this.fileLogger) {
            this.fileLogger.info('COUNTDOWN-DEBUG', `Remaining time from sensor: ${result.value} seconds`);
          }
        }

        this._log(`${sensor.id} - ${sensor.name}: ${result.value} ${sensor.unit || ''}`);
        sensorDataArray.push(result);
      }
      
      const duration = Date.now() - startTime;
      
      // Determine if this was a successful cycle
      const wasSuccessful = sensorDataArray.length > 0;
      
      if (wasSuccessful) {
        // Update diagnostics for successful read
        this.diagnostics.successfulReadCycles++;
        this.diagnostics.lastSuccessTime = new Date().toISOString();
        this.diagnostics.consecutiveFailures = 0;
        
        // Log performance issue
        if (duration > 5000) {
          this._logWarn('PERFORMANCE', `Read cycle took ${duration}ms - potential performance issue`);
          if (this.fileLogger) {
            this.fileLogger.logPerformanceIssue('readData', duration, 5000);
          }
        }
        
        // Log success to FileLogger (statistics only, not every single read)
        if (this.fileLogger && powerValue !== null) {
          this.fileLogger.recordSuccessfulRead(powerValue);
        }
        
        // Log warning if there were partial errors
        if (readErrors > 0) {
          this._logWarn('READ', `Read cycle completed with ${readErrors}/${this.sensors.length} sensor errors`);
        }

        // Emit taskCompleted event
        this.emit('taskCompleted', sensorDataArray);

        // Handle disconnection warning with local countdown tracking
        if (this.eventDate !== undefined && this.remainingDisconnectionTime !== undefined) {
          const now = Math.floor(Date.now() / 1000); // Current Unix timestamp in seconds
          const disconnectionWarning = this.calculateDisconnectionWarning(
            this.eventDate,
            this.remainingDisconnectionTime
          );
          
          // Comprehensive debug logging
          if (this.fileLogger) {
            this.fileLogger.info('DISCONNECT-DEBUG', 
              `Current time: ${now} (${new Date().toISOString()}) | ` +
              `Event Date: ${this.eventDate} | ` +
              `Remaining: ${this.remainingDisconnectionTime}s | ` +
              `Warning: ${disconnectionWarning}`);
          }
          
          this._log(`Event Date: ${this.eventDate} - Disconnection warning: ${disconnectionWarning}`);

          // Check if alarm is active (not using sentinel values)
          if (this.eventDate !== -1 && 
              this.eventDate !== 65535 && 
              this.eventDate !== SinapsiConnect.DISCONNECT_ALARM_INACTIVE) {
            
            const sensorValue = this.remainingDisconnectionTime;
            
            // Scenario 1: First reading - initialize countdown
            if (this.countdownStartTime === null) {
              this.countdownStartTime = now;
              this.countdownStartValue = sensorValue;
              if (this.fileLogger) {
                this.fileLogger.info('COUNTDOWN-INIT', `Starting countdown from ${sensorValue}s`);
              }
            }
            
            // Calculate elapsed time and remaining seconds
            const elapsed = now - this.countdownStartTime;
            const calculatedRemaining = Math.max(0, this.countdownStartValue - elapsed);
            
            // Scenario 3: Modbus updates with lower value - reset countdown (conservative approach)
            if (sensorValue < calculatedRemaining) {
              this.countdownStartTime = now;
              this.countdownStartValue = sensorValue;
              if (this.fileLogger) {
                this.fileLogger.info('COUNTDOWN-RESET', 
                  `Modbus updated: ${sensorValue}s < calculated ${Math.floor(calculatedRemaining)}s - resetting timer (conservative estimate)`);
              }
            }
            
            // Recalculate after potential reset
            const finalElapsed = now - this.countdownStartTime;
            const secondsRemaining = Math.max(0, Math.floor(this.countdownStartValue - finalElapsed));
            
            // Log comparison for debugging
            if (this.fileLogger) {
              this.fileLogger.info('COUNTDOWN-COMPARE', 
                `Sensor: ${sensorValue}s | ` +
                `Calculated: ${secondsRemaining}s | ` +
                `Elapsed: ${finalElapsed}s`);
            }
            
            // Scenario 2: Emit calculated countdown
            this.emit('disconnectionWarning', secondsRemaining);
            
            if (!this.warningTriggered) {
              this.warningTriggered = true;
              if (this.fileLogger) {
                this.fileLogger.warn('ALARM-STATE', `First disconnection warning triggered: ${secondsRemaining}s remaining`);
              }
              this.emit('firstDisconnectionWarning', secondsRemaining);
            }
          } else {
            // No alarm active - reset countdown
            if (this.warningTriggered) {
              this.warningTriggered = false;
              this.countdownStartTime = null;
              this.countdownStartValue = null;
              if (this.fileLogger) {
                this.fileLogger.info('ALARM-STATE', 'Disconnection warning stopped - alarm cleared');
              }
              this.emit('stopWarning');
            }
          }
        }
      } else {
        // All sensors failed
        this.diagnostics.failedReadCycles++;
        this.diagnostics.consecutiveFailures++;
        this._logError('READ', `Read cycle failed - all ${this.sensors.length} sensors returned errors`, this.getDiagnostics());
        
        if (this.fileLogger) {
          this.fileLogger.recordFailedRead(`All ${this.sensors.length} sensors failed`);
        }
      }
      
      return sensorDataArray;
      
    } catch (err) {
      // Unexpected error
      this.diagnostics.failedReadCycles++;
      this.diagnostics.lastFailTime = new Date().toISOString();
      this.diagnostics.consecutiveFailures++;
      this.diagnostics.lastError = err.message;
      
      this._logError('READ', `Unexpected error in readData: ${err.message}`, this.getDiagnostics());
      
      if (this.fileLogger) {
        this.fileLogger.recordFailedRead(err.message);
      }
      
      this.isConnected = false;
      return sensorDataArray;
      
    } finally {
      // Always reset isReading flag
      this.isReading = false;
    }
  }

  /**
   * Reads a single sensor with timeout handling (HA pattern: isolated reads)
   * @param {Object} sensor - The sensor configuration
   * @returns {Promise<Object|null>} - Sensor data or null on error
   */
  async _readSingleSensor(sensor) {
    let timeoutId = null;
    
    try {
      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = this.homey.setTimeout(() => {
          reject(new Error('Modbus read timeout'));
        }, 3000);
      });
      
      // Race between read and timeout
      const data = await Promise.race([
        this.client.readHoldingRegisters(sensor.address, sensor.count),
        timeoutPromise
      ]);
      
      // Cancel timeout on success
      if (timeoutId !== null) {
        this.homey.clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      // Parse value
      let value;
      if (sensor.type === "uint32") {
        value = (data.data[0] << 16) | data.data[1];
      } else {
        value = data.data[0];
      }
      
      return {
        id: sensor.id,
        capability: sensor.capability,
        name: sensor.name,
        value: value,
        unit: sensor.unit || '',
        type: sensor.type,
        conversionFactor: sensor.conversionFactor
      };
      
    } catch (err) {
      // Cancel timeout if still active
      if (timeoutId !== null) {
        this.homey.clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      if (err.message === 'Modbus read timeout') {
        this._logWarn('READ', `Timeout reading ${sensor.name} (address: ${sensor.address})`);
      } else {
        this._logError('READ', `Error reading ${sensor.name}: ${err.message}`);
        this.diagnostics.lastError = err.message;
        
        // HA Pattern: Mark connection as potentially lost, but don't throw
        // Next ensureConnected() will handle reconnection
        this.isConnected = false;
        
        if (this.fileLogger) {
          this.fileLogger.logConnectionStateChange('connected', 'disconnected', `read error: ${err.message}`);
        }
      }
      
      return null; // HA Pattern: Return null on error, don't throw
    }
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
    this._logInfo('LIFECYCLE', 'Starting SinapsiConnect...');
    // Start connection process; scheduler will be started by connectModbus() once connected
    this.connectModbus();
    if (this.scheduler.isScheduled) {
      this.scheduler.stop();
    }
  }

  /**
   * Stops the Modbus connection and the task scheduler.
   * @returns {Promise<void>}
   */
  async stop() {
    this._logInfo('LIFECYCLE', 'Stopping SinapsiConnect...', this.getDiagnostics());
    
    // Cancel connection health check interval
    if (this.connectionCheckInterval) {
      this.homey.clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
    
    // Cancel all pending reconnection timeouts
    this.reconnectTimeouts.forEach(id => this.homey.clearTimeout(id));
    this.reconnectTimeouts = [];
    
    // Stop scheduler first
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null; // Dereference for garbage collection
    }
    
    // Remove all EventEmitter listeners to prevent memory leaks
    this.removeAllListeners();
    
    // Close Modbus connection
    if (this.client) {
      try {
        if (this.client.isOpen) {
          await new Promise((resolve, reject) => {
            this.client.close((err) => {
              if (err) {
                console.error('Error closing Modbus connection:', err);
                reject(err);
              } else {
                this._log('Modbus connection closed successfully');
                resolve();
              }
            });
          });
        }
      } catch (error) {
        console.error('Failed to close Modbus connection:', error);
      } finally {
        // Force cleanup of Modbus client
        if (this.client.destroy) {
          try {
            this.client.destroy();
          } catch (e) {
            // Ignore destroy errors
          }
        }
        this.client = null; // Dereference for garbage collection
      }
    }
    
    this.isConnected = false;
    this.isReading = false;
  }

  /**
   * Static method to manage a single instance of SinapsiConnect.
   * Stops the existing timer and starts a new one with the given IP.
   * @param {Object} homey - The Homey instance.
   * @param {string} ip - The IP address of the Modbus server.
   * @param {number} [updateInterval=30000] - The interval in milliseconds for updating data.
   * @param {boolean} [showLog=false] - Whether to show log messages.
   * @param {boolean} [showEnergyMonitoring=true] - Whether to include energy monitoring sensors.
   * @param {Object} [fileLogger=null] - FileLogger instance for persistent logging.
   * @returns {SinapsiConnect} The SinapsiConnect instance.
   */
  static manageInstance(homey, ip, updateInterval = 30000, showLog = false, showEnergyMonitoring = true, fileLogger = null) {
    if (SinapsiConnect.instance) {
      SinapsiConnect.instance.stop();
    }
    SinapsiConnect.instance = new SinapsiConnect(homey, ip, updateInterval, showLog, showEnergyMonitoring, fileLogger);
    SinapsiConnect.instance.start();
    return SinapsiConnect.instance;
  }
}

module.exports = SinapsiConnect;