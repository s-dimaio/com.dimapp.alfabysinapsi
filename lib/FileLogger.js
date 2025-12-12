'use strict';

const fs = require('fs');

/**
 * FileLogger - Persistent logging system for debugging
 * Saves logs to /userdata/alfa_debug.log with automatic rotation
 */
class FileLogger {
  constructor(homey, options = {}) {
    this.homey = homey;
    this.logFile = '/userdata/alfa_debug.log';
    this.maxFileSize = options.maxFileSize || 500 * 1024; // 500KB default
    this.maxBackups = options.maxBackups || 2;
    this.writeQueue = [];
    this.isWriting = false;
    this.flushInterval = null;

    // Statistics for aggregated logging
    this.stats = {
      successfulReads: 0,
      failedReads: 0,
      reconnections: 0,
      lastSuccessfulRead: null,
      lastFailedRead: null,
      lastPowerValue: null,
      sessionStart: new Date().toISOString()
    };

    // Start periodic flush every 5 minutes
    this.flushInterval = homey.setInterval(() => this._flushQueue(), 5 * 60 * 1000);

    // Log hourly statistics
    this.statsInterval = homey.setInterval(() => this._logHourlyStats(), 60 * 60 * 1000);

    // If requested, delete existing log files before starting a new session
    this.clearOnStart = !!options.clearOnStart;;
    if (this.clearOnStart) {
      // deleteLog performs synchronous file deletions and enqueues a message;
      // it returns a Promise but the actual deletions are sync so it's safe
      // to call from the constructor. Handle any rejection for safety.
      this.deleteLog().catch(err => {
        console.error('FileLogger clearOnStart error:', err);
      });
    }

    this._initLogFile();

    // Log memory IMMEDIATELY at startup (baseline)
    this._logMemoryUsage();

    // Memory monitoring every hour
    this.memoryInterval = homey.setInterval(() => this._logMemoryUsage(), 60 * 60 * 1000);
  }

  /**
   * Initialize the log file with a session header
   */
  _initLogFile() {
    const header = [
      '',
      '='.repeat(60),
      `SESSION START: ${new Date().toISOString()}`,
      `Homey Version: ${this.homey.version || 'unknown'}`,
      `App Version: ${this.homey.manifest?.version || 'unknown'}`,
      '='.repeat(60),
      ''
    ].join('\n');

    this._appendToFile(header);
  }

  /**
   * Format timestamp in a readable format
   */
  _timestamp() {
    return new Date().toISOString();
  }

  /**
   * Add a message to the write queue
   */
  _queueWrite(message) {
    this.writeQueue.push(message);

    // Immediate flush if the queue gets large
    if (this.writeQueue.length > 50) {
      this._flushQueue();
    }
  }

  /**
   * Write queued messages to the file
   */
  async _flushQueue() {
    if (this.isWriting || this.writeQueue.length === 0) return;

    this.isWriting = true;
    const messages = this.writeQueue.splice(0, this.writeQueue.length);

    try {
      await this._appendToFile(messages.join('\n') + '\n');
    } catch (error) {
      console.error('FileLogger flush error:', error);
    } finally {
      this.isWriting = false;
    }
  }

  /**
   * Append text to the file with rotation handling
   */
  async _appendToFile(text) {
    try {
      // Controlla dimensione file e ruota se necessario
      await this._rotateIfNeeded();

      // Scrivi su file
      fs.appendFileSync(this.logFile, text);
    } catch (error) {
      console.error('FileLogger write error:', error);
    }
  }

  /**
   * Rotate log files if they exceed the maximum size
   */
  async _rotateIfNeeded() {
    try {
      if (!fs.existsSync(this.logFile)) return;

      const stats = fs.statSync(this.logFile);
      if (stats.size < this.maxFileSize) return;

      // Ruota i backup
      for (let i = this.maxBackups - 1; i >= 1; i--) {
        const oldFile = `${this.logFile}.${i}`;
        const newFile = `${this.logFile}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
          if (i === this.maxBackups - 1) {
            fs.unlinkSync(oldFile); // Elimina il più vecchio
          } else {
            fs.renameSync(oldFile, newFile);
          }
        }
      }

      // Rinomina il file corrente
      fs.renameSync(this.logFile, `${this.logFile}.1`);

      this._queueWrite(`[${this._timestamp()}] [SYSTEM] Log rotated - new file started`);
    } catch (error) {
      console.error('FileLogger rotation error:', error);
    }
  }

  /**
   * Log hourly statistics (reduces log volume)
   */
  _logHourlyStats() {
    const uptime = Math.round((Date.now() - new Date(this.stats.sessionStart).getTime()) / 1000 / 60);
    const successRate = this.stats.successfulReads + this.stats.failedReads > 0
      ? ((this.stats.successfulReads / (this.stats.successfulReads + this.stats.failedReads)) * 100).toFixed(1)
      : 0;

    const statsMsg = [
      `[${this._timestamp()}] [STATS] Hourly Report:`,
      `  - Uptime: ${uptime} minutes`,
      `  - Successful reads: ${this.stats.successfulReads}`,
      `  - Failed reads: ${this.stats.failedReads}`,
      `  - Success rate: ${successRate}%`,
      `  - Reconnections: ${this.stats.reconnections}`,
      `  - Last power value: ${this.stats.lastPowerValue}W`,
      `  - Last successful: ${this.stats.lastSuccessfulRead || 'never'}`,
      `  - Last failed: ${this.stats.lastFailedRead || 'never'}`
    ].join('\n');

    this._queueWrite(statsMsg);

    // Reset contatori (mantieni last values)
    this.stats.successfulReads = 0;
    this.stats.failedReads = 0;
    this.stats.reconnections = 0;
  }

  /**
   * Log memory usage (every 6 hours)
   */
  _logMemoryUsage() {
    try {
      this.info('MEMORY-DEBUG', 'Memory check triggered');
      
      // Homey doesn't support full process.memoryUsage()
      // Use only heap statistics which are available
      const v8 = require('v8');
      const heapStats = v8.getHeapStatistics();
      const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

      const memMsg = [
        `[${this._timestamp()}] [MEMORY] Heap Usage Report:`,
        `  - Total Heap Size: ${formatMB(heapStats.total_heap_size)} MB`,
        `  - Used Heap Size: ${formatMB(heapStats.used_heap_size)} MB`,
        `  - Heap Size Limit: ${formatMB(heapStats.heap_size_limit)} MB`,
        `  - Available Heap: ${formatMB(heapStats.heap_size_limit - heapStats.used_heap_size)} MB`,
        `  - Usage: ${((heapStats.used_heap_size / heapStats.heap_size_limit) * 100).toFixed(1)}%`
      ].join('\n');

      this._queueWrite(memMsg);

      // Force immediate flush to ensure it is written
      this._flushQueue();

      // Warn if heap used exceeds 70% of the limit
      const usagePercent = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;
      if (usagePercent > 70) {
        this.warn('MEMORY', `High heap usage: ${usagePercent.toFixed(1)}% (${formatMB(heapStats.used_heap_size)} MB / ${formatMB(heapStats.heap_size_limit)} MB)`);
      }

    } catch (error) {
      this.error('MEMORY', `Failed to check memory: ${error.message}`);
      console.error('FileLogger memory check error:', error);
    }
  }

  // ==================== PUBLIC LOGGING METHODS ====================

  /**
   * Log critical event (always persisted)
   */
  error(component, message, details = null) {
    const logMsg = `[${this._timestamp()}] [ERROR] [${component}] ${message}${details ? ' | ' + JSON.stringify(details) : ''}`;
    this._queueWrite(logMsg);
    console.error(logMsg);
  }

  /**
   * Log warning (always persisted)
   */
  warn(component, message, details = null) {
    const logMsg = `[${this._timestamp()}] [WARN] [${component}] ${message}${details ? ' | ' + JSON.stringify(details) : ''}`;
    this._queueWrite(logMsg);
    console.warn(logMsg);
  }

  /**
   * Log important info (state events)
   */
  info(component, message, details = null) {
    const logMsg = `[${this._timestamp()}] [INFO] [${component}] ${message}${details ? ' | ' + JSON.stringify(details) : ''}`;
    this._queueWrite(logMsg);
    console.log(logMsg);
  }

  /**
   * Debug log (console only, not persisted to save space)
   */
  debug(component, message) {
    console.log(`[${this._timestamp()}] [DEBUG] [${component}] ${message}`);
  }

  /**
   * Record successful read (statistics only, not a single log entry)
   */
  recordSuccessfulRead(powerValue) {
    this.stats.successfulReads++;
    this.stats.lastSuccessfulRead = this._timestamp();
    this.stats.lastPowerValue = powerValue;
  }

  /**
   * Record failed read (log + statistics)
   */
  recordFailedRead(reason) {
    this.stats.failedReads++;
    this.stats.lastFailedRead = this._timestamp();
    this.warn('MODBUS', `Read failed: ${reason}`);
  }

  /**
   * Record reconnection
   */
  recordReconnection(attempt, maxAttempts, reason) {
    this.stats.reconnections++;
    this.warn('MODBUS', `Reconnection attempt ${attempt}/${maxAttempts}`, { reason });
  }

  /**
   * Log connection state change
   */
  logConnectionStateChange(oldState, newState, reason = '') {
    this.info('CONNECTION', `State changed: ${oldState} -> ${newState}`, { reason });
  }

  /**
   * Log performance issue
   */
  logPerformanceIssue(operation, durationMs, threshold) {
    if (durationMs > threshold) {
      this.warn('PERFORMANCE', `${operation} took ${durationMs}ms (threshold: ${threshold}ms)`);
    }
  }

  /**
   * Log when scheduler gets stuck
   */
  logSchedulerStuck(iterations) {
    this.error('SCHEDULER', `Task appears stuck after ${iterations} iterations`);
  }

  /**
   * Log capability update failure
   */
  logCapabilityError(capability, error) {
    this.error('CAPABILITY', `Failed to update ${capability}`, { error: error.message });
  }

  /**
   * Write an important custom event message
   */
  logEvent(eventName, data = {}) {
    this.info('EVENT', eventName, data);
  }

  /**
   * Force immediate flush (useful before crash/stop)
   */
  async flush() {
    await this._flushQueue();
  }

  /**
   * Cleanup resources
   */
  async destroy() {
    // Log finale
    this._logHourlyStats();
    this._queueWrite(`[${this._timestamp()}] [SYSTEM] Logger shutting down`);

    // Flush finale
    await this._flushQueue();

    // Clear intervals
    if (this.flushInterval) {
      this.homey.clearInterval(this.flushInterval);
    }
    if (this.statsInterval) {
      this.homey.clearInterval(this.statsInterval);
    }
    if (this.memoryInterval) {
      this.homey.clearInterval(this.memoryInterval);
    }
  }

  /**
   * Read the last N lines of the log (for remote debugging)
   */
  async getLastLines(n = 100) {
    try {
      if (!fs.existsSync(this.logFile)) {
        return 'Log file not found';
      }

      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.split('\n');
      return lines.slice(-n).join('\n');
    } catch (error) {
      return `Error reading log: ${error.message}`;
    }
  }

  /**
   * Delete the main log file and backups
   */
  async deleteLog() {
    try {
      // Delete main log file
      if (fs.existsSync(this.logFile)) {
        fs.unlinkSync(this.logFile);
      }
      // Delete backups
      for (let i = 1; i <= this.maxBackups; i++) {
        const backupFile = `${this.logFile}.${i}`;
        if (fs.existsSync(backupFile)) {
          fs.unlinkSync(backupFile);
        }
      }
      this._queueWrite(`[${this._timestamp()}] [SYSTEM] Log file deleted`);
    } catch (error) {
      this._queueWrite(`[${this._timestamp()}] [ERROR] Failed to delete log file: ${error.message}`);
    }
  }
}

module.exports = FileLogger;
