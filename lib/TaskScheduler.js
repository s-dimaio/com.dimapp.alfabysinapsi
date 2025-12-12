const EventEmitter = require('events');

class SchedulerError extends Error {
    constructor(code, text) {
        super(text);
        this.name = 'SchedulerError';
        this.code = code;
    }
}

/**
 * A class for scheduling asynchronous tasks to run at a fixed interval.
 */
class TaskScheduler extends EventEmitter {
    constructor(homey, task, interval = 60 * 60 * 1000, showLog = false) {
        super();
        if (typeof task !== 'function') {
            throw new Error('The task must be a function.');
        }
        this.homey = homey;
        this.task = task;
        this.interval = interval;
        this.timer = null;
        this.isRunning = false;
        this.isScheduled = false;
        this.showLog = showLog;
        this.consecutiveErrors = 0;
        this.maxConsecutiveErrors = 3;
    }

    _log(...args) {
        if (this.showLog) {
            const timestamp = new Date().toISOString();
            const message = args.join(' ');
            console.log(`%c${timestamp}`, 'color: green', `[TASK-SCHEDULER] - ${message}`);
        }
    }

    async _executeTask() {
        if (this.isRunning) {
            console.warn("Task is still running, skipping this iteration.");
            this.consecutiveErrors++;
            if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                console.error(`Task stuck after ${this.maxConsecutiveErrors} iterations. Stopping scheduler.`);
                this.stop();
            }
            return;
        }

        this.isRunning = true;
        this._log("Task execution started.");

        try {
            const result = await this.task();
            this._log("Task execution completed.");
            this.consecutiveErrors = 0; // Reset counter on success
            
            // ✅ EMIT on EventEmitter (this), not this.homey
            this.emit('taskCompleted', result);
        } catch (error) {
            console.error("Error during task execution:", error);
            this.consecutiveErrors++;
            
            if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                console.error(`${this.maxConsecutiveErrors} consecutive errors. Consider investigating.`);
                
                // ✅ EMIT on EventEmitter (this), not this.homey
                this.emit('taskError', error);
            }
        } finally {
            this.isRunning = false;
            if (this.isScheduled) {
                this.timer = this.homey.setTimeout(() => this._executeTask(), this.interval);
            }
        }
    }

    start() {
        if (this.isScheduled) {
            console.warn("Task scheduler is already running.");
            return;
        }
        this._log("Task scheduler started.");
        this.isScheduled = true;
        // Execute first run immediately, subsequent runs are scheduled from _executeTask
        this._executeTask();
    }

    stop() {
        this._log("Stopping task scheduler...");
        
        // Set flag first to prevent new timers
        this.isScheduled = false;
        
        // Cancel pending timer
        if (this.timer) {
            this.homey.clearTimeout(this.timer);
            this.timer = null;
        }
        
        // Remove all EventEmitter listeners
        this.removeAllListeners();
        
        // Reset state
        this.isRunning = false;
        this.consecutiveErrors = 0;
        
        this._log("Task scheduler stopped.");
    }

    setInterval(newInterval) {
        if (typeof newInterval !== 'number' || newInterval <= 0) {
            throw new SchedulerError('ERROR_SET_INTERVAL', 'The interval must be a positive number.');
        }
        this.interval = newInterval;
        this._log(`Task interval updated to ${newInterval} milliseconds.`);
        if (this.isScheduled) {
            this.stop();
            this.start();
        }
    }
}

module.exports = {
    TaskScheduler,
    SchedulerError
};