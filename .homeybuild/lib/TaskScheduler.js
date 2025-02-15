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
class TaskScheduler {
    constructor(homey, task, interval = 60 * 60 * 1000, showLog = false) {
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
            return;
        }

        this.isRunning = true;
        this._log("Task execution started.");

        try {
            const result = await this.task();
            this._log("Task execution completed.");
            this.homey.emit('taskCompleted', result);
        } catch (error) {
            console.error("Error during task execution:", error);
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
        this.timer = this.homey.setTimeout(() => this._executeTask(), this.interval);
    }

    stop() {
        if (this.timer) {
            this.homey.clearTimeout(this.timer);
            this.timer = null;
            this.isScheduled = false;
            this._log("Task scheduler stopped.");
        }
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