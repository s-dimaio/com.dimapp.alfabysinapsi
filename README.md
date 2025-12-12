# Alfa by Sinapsi

Homey app to read data from Alfa by Sinapsi power meters over Modbus TCP and expose measurements and alarms inside Homey.

## Summary

This app connects to Alfa meters using Modbus TCP (default port 502) and periodically reads configured holding registers. It updates Homey capabilities (power, cumulative energy, time-slot), emits disconnection warnings, and exposes Flow triggers for those events.

## Features

- Connect to Alfa devices via Modbus TCP.
- Periodic polling of sensors (15s) using a scheduler.
- Exposes capabilities:
	- `measure_power` (instantaneous power, W)
	- `meter_power.imported` (cumulative imported energy, kWh)
	- `meter_power.exported` (cumulative exported energy, kWh)
	- `energy_phase` (current time slot)
	- `alarm_generic` (power disconnect alarm)
- Emits Flow triggers:
	- `disconnection_warning` (every warning; token: seconds)
	- `first_disconnection_warning` (first warning only; token: seconds)
	- `stop_warning` (warning ended)
- Robust error handling and reconnection attempts on communication errors/timeouts.

## How it works (internals)

- The Modbus connection and periodic reads are handled by the `SinapsiConnect` class (`lib/SinapsiConnect.js`).
- Periodic execution is driven by the `TaskScheduler` (`lib/TaskScheduler.js`) which avoids concurrent reads and counts consecutive errors for retry/stop logic.
- Device-level integration and Flow triggers are wired in the Alfa device driver (see `drivers/alfa/device.js`).

## Installation (development)

1. Clone repository
```sh
git clone https://github.com/yourusername/alfabysinapsi.git
cd com.dimapp.alfabysinapsi
```
2. Install dependencies:
```sh
npm install
```
3. Run in Homey dev environment:
```sh
homey app run
```

## Pairing and Configuration

- During pairing the user provides the device IP/hostname via the pairing UI (`drivers/alfa/pair/alfa_pair.html`). The pairing view also includes a checkbox option to enable or disable monitoring of exported energy (energy input monitoring).
- The IP is stored in device settings (`ipAddress`) and the `showEnergyMonitoring` preference is stored in the device store. When settings change the driver reinitializes the connection.

## Settings

- `ipAddress` — IP or hostname of the Alfa device (required).
- Polling interval is configurable when creating the `SinapsiConnect` instance; default in code is 30000 ms (30s).

## Sensors configuration

Register addresses and sensor definitions are in `lib/config/config.js`. The app reads the configured registers (uint16 / uint32) and maps them to capabilities or internal values.

## Events & Flows

The app emits Homey events for disconnection warnings. These are translated to Flow triggers in the driver so users can build automations.

## Troubleshooting

- If readings stop:
	- Check device IP (`ipAddress`) in device settings.
	- Check Homey logs for Modbus communication errors (timeouts, socket errors).
	- The connector implements reconnection attempts; verify device network availability.
- For pairing/IP errors the pairing UI shows localized messages.

## Development notes

- Dependency: `modbus-serial` (see `package.json`).
- The app protects against concurrent `readData()` calls (flag `isReading`) and prevents the scheduler from overlapping reads.
- On communication errors the connector sets `isConnected = false` and attempts reconnection with backoff and a maximum number of attempts.

## License

This project is released under the GNU GPL v3. See LICENSE for details.

