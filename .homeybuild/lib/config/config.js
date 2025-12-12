const config = {
  name: "Alfa",
  type: "tcp",
  port: 502,
  sensors: [
    { id: "measure_power", capability: true, name: "Instant Active Power (imported)", address: 2, count: 1, type: "uint16", unit: "W" },
    { id: "imm_ist", capability: false, name: "Instant Active Power (exported)", address: 12, count: 1, type: "uint16", unit: "W" },
    { id: "pro_ist", capability: false, name: "Instant Active Power Produced", address: 921, count: 1, type: "uint16", unit: "W" },
    { id: "meter_power.imported", capability: true, name: "Total Active Energy Imported", address: 5, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exported", capability: true, name: "Total Active Energy Exported", address: 15, count: 2, type: "uint32", unit: "Wh" },
    { id: "pro_tot", capability: false, name: "Total Active Energy Produced", address: 924, count: 2, type: "uint32", unit: "Wh" },
    { id: "pre_med", capability: false, name: "15min Avg Imported Active Power", address: 9, count: 1, type: "uint16", unit: "W" },
    { id: "imm_med", capability: false, name: "15min Avg Exported Active Power", address: 19, count: 1, type: "uint16", unit: "W" },
    { id: "meter_power.imp.daily.F1", capability: false, name: "Total Active Energy Imported (Day-1) F1", address: 30, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.imp.daily.F2", capability: false, name: "Total Active Energy Imported (Day-1) F2", address: 32, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.imp.daily.F3", capability: false, name: "Total Active Energy Imported (Day-1) F3", address: 34, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.imp.daily.F4", capability: false, name: "Total Active Energy Imported (Day-1) F4", address: 36, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.imp.daily.F5", capability: false, name: "Total Active Energy Imported (Day-1) F5", address: 38, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.imp.daily.F6", capability: false, name: "Total Active Energy Imported (Day-1) F6", address: 40, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F1", capability: false, name: "Total Active Energy Exported (Day-1) F1", address: 54, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F2", capability: false, name: "Total Active Energy Exported (Day-1) F2", address: 56, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F3", capability: false, name: "Total Active Energy Exported (Day-1) F3", address: 58, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F4", capability: false, name: "Total Active Energy Exported (Day-1) F4", address: 60, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F5", capability: false, name: "Total Active Energy Exported (Day-1) F5", address: 62, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F6", capability: false, name: "Total Active Energy Exported (Day-1) F6", address: 64, count: 2, type: "uint32", unit: "Wh" },
    { id: "energy_phase", capability: true, name: "Current Tariff Period", address: 203, count: 1, type: "uint16" },
    { id: "alarm_generic", capability: true, name: "Event Timestamp", address: 780, count: 2, type: "uint32" },
    { id: "energy_detachment", capability: false, name: "Remaining Disconnection Time", address: 782, count: 1, type: "uint16" }
  ]
};

module.exports = config;