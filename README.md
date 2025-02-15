# Alfa by Sinapsi

Homey app for Alfa by Sinapsi

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)

## Overview

Alfa by Sinapsi is a Homey app designed to connect and interact with Modbus of Alfa power meters. It allows you to read data from Modbus holding registers and process it within the Homey environment. The app can handle various sensors and emit events based on the data received.

## Features

- Connect to Alfa by Sinapsi using TCP.
- Read data from Modbus holding registers.
- Emit events for disconnection warnings.
- Emit a special event for the first disconnection warning.
- Log data and events for debugging purposes.
- Manage a single instance of the connection.

## Installation

To get started with Alfa by Sinapsi, follow these steps:

### Prerequisites

- Ensure you have Node.js and npm (Node Package Manager) installed on your system. You can download them from [Node.js official website](https://nodejs.org/).

### Steps

1. Clone the repository:
```sh
git clone https://github.com/yourusername/alfabysinapsi.git
cd alfabysinapsi
```

2. Install the dependencies:
```sh
npm install
```

3. Start the app in Homey Pro:
```sh
homey app run
```

## Usage

After installation, you can add your Echo devices to Homey:

1. Go to 'Devices' in the Homey app
2. Click the '+' button to add a new device
3. Select 'Alfa by Sinapsi' from the list of apps
4. Follow the setup wizard to connect your Alfa power meter

## Contributing

If you would like to contribute to this project, please follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bugfix.
3. Commit your changes and push the branch to your fork.
4. Create a pull request with a description of your changes.

## License

This project is released under the GNU License. For full details, please see the [LICENSE](LICENSE) file.