'use strict';

const fs = require('fs');

const LOG_FILE = '/userdata/alfa_debug.log';
const MAX_BACKUPS = 2;
const APP_PATH_PREFIX = '/app/com.dimapp.alfabysinapsi';

/**
 * Get the file path for a given log file index
 * @param {number} index - 0 for main file, 1+ for backups
 * @returns {string} - Full path to the log file
 */
function getLogFilePath(index) {
  if (index === 0) {
    return LOG_FILE;
  }
  return `/userdata/alfa_debug.${index}.log`;
}

/**
 * Get display name for a log file
 * @param {number} index - 0 for main file, 1+ for backups
 * @returns {string} - Display name
 */
function getLogFileName(index) {
  if (index === 0) {
    return 'alfa_debug.log';
  }
  return `alfa_debug.${index}.log`;
}

module.exports = {
  /**
   * Check if log files exist and return info about all log files (main + backups)
   * GET /api/app/com.dimapp.alfabysinapsi/log/status
   */
  async getLogStatus({ homey }) {
    try {
      const files = [];
      let totalSize = 0;

      // Check main log file (index 0)
      if (fs.existsSync(LOG_FILE)) {
        const stats = fs.statSync(LOG_FILE);
        files.push({
          index: 0,
          name: getLogFileName(0),
          path: LOG_FILE,
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          modified: stats.mtime.toISOString()
        });
        totalSize += stats.size;
      }

      // Check backup files (index 1, 2, ...)
      for (let i = 1; i <= MAX_BACKUPS; i++) {
        const backupFile = getLogFilePath(i);
        if (fs.existsSync(backupFile)) {
          const stats = fs.statSync(backupFile);
          files.push({
            index: i,
            name: getLogFileName(i),
            path: backupFile,
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
            modified: stats.mtime.toISOString()
          });
          totalSize += stats.size;
        }
      }

      if (files.length === 0) {
        return { exists: false };
      }

      return {
        exists: true,
        files: files,
        totalSize: totalSize,
        totalSizeFormatted: formatBytes(totalSize)
      };
    } catch (error) {
      return { exists: false, error: error.message };
    }
  },

  /**
   * Get download URL for a specific log file
   * GET /api/app/com.dimapp.alfabysinapsi/log/download/:index
   * @param {object} params - Route parameters
   * @param {string} params.index - File index (0 = main, 1+ = backups)
   * Returns URL string directly that can be used to download the file
   */
  async getLogDownloadFile({ homey, params }) {
    try {
      const index = parseInt(params.index, 10);
      if (isNaN(index) || index < 0 || index > MAX_BACKUPS) {
        throw new Error('Invalid file index');
      }

      const filePath = getLogFilePath(index);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Log file not found: ${getLogFileName(index)}`);
      }

      // Get Homey's local IP address
      const localAddress = await homey.cloud.getLocalAddress();

      // Build the download URL and return it directly as string
      const downloadUrl = `http://${localAddress}${APP_PATH_PREFIX}${filePath}`;

      console.log('API - getLogDownloadFile - URL:', downloadUrl);
      return downloadUrl;
    } catch (error) {
      console.error('API - getLogDownloadFile - error:', error.message);
      throw error;
    }
  },

  /**
   * Delete a specific log file
   * DELETE /api/app/com.dimapp.alfabysinapsi/log/:index
   * @param {object} params - Route parameters
   * @param {string} params.index - File index (0 = main, 1+ = backups)
   */
  async deleteLogFile({ homey, params }) {
    try {
      const index = parseInt(params.index, 10);
      if (isNaN(index) || index < 0 || index > MAX_BACKUPS) {
        throw new Error('Invalid file index');
      }

      const filePath = getLogFilePath(index);
      const fileName = getLogFileName(index);

      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${fileName}` };
      }

      fs.unlinkSync(filePath);
      return { success: true, deletedFile: fileName };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Delete all log files (main + backups)
   * DELETE /api/app/com.dimapp.alfabysinapsi/log/all
   */
  async deleteAllLogs({ homey }) {
    try {
      let deleted = 0;
      const deletedFiles = [];

      // Delete main file
      if (fs.existsSync(LOG_FILE)) {
        fs.unlinkSync(LOG_FILE);
        deletedFiles.push(getLogFileName(0));
        deleted++;
      }

      // Delete backups
      for (let i = 1; i <= MAX_BACKUPS; i++) {
        const backupFile = getLogFilePath(i);
        if (fs.existsSync(backupFile)) {
          fs.unlinkSync(backupFile);
          deletedFiles.push(getLogFileName(i));
          deleted++;
        }
      }

      return { success: true, deletedCount: deleted, deletedFiles: deletedFiles };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
