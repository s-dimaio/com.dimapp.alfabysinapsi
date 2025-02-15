const config = {
  name: "Alfa",
  type: "tcp",
  port: 502,
  sensors: [
    { id: "measure_power", capability: true, name: "Potenza Attiva Prelevata Istantanea", address: 2, count: 1, type: "uint16", unit: "W" },
    { id: "imm_ist", capability: false, name: "Potenza Attiva Immessa Istantanea", address: 12, count: 1, type: "uint16", unit: "W" },
    { id: "pro_ist", capability: false, name: "Potenza Attiva Prodotta Istantanea", address: 921, count: 1, type: "uint16", unit: "W" },
    { id: "meter_power.imported", capability: true, name: "Energia Attiva Prelevata Totale", address: 5, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exported", capability: true, name: "Energia Attiva Immessa Totale", address: 15, count: 2, type: "uint32", unit: "Wh" },
    { id: "pro_tot", capability: false, name: "Energia Attiva Prodotta Totale", address: 924, count: 2, type: "uint32", unit: "Wh" },
    { id: "pre_med", capability: false, name: "Pot Att Prel Media 15m", address: 9, count: 1, type: "uint16", unit: "W" },
    { id: "imm_med", capability: false, name: "Pot Att Imm Media 15m", address: 19, count: 1, type: "uint16", unit: "W" },
    { id: "meter_power.imp.daily.F1", capability: false, name: "Tot Energ Att Prel Giorno-1 F1", address: 30, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.imp.daily.F2", capability: false, name: "Tot Energ Att Prel Giorno-1 F2", address: 32, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.imp.daily.F3", capability: false, name: "Tot Energ Att Prel Giorno-1 F3", address: 34, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.imp.daily.F4", capability: false, name: "Tot Energ Att Prel Giorno-1 F4", address: 36, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.imp.daily.F5", capability: false, name: "Tot Energ Att Prel Giorno-1 F5", address: 38, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.imp.daily.F6", capability: false, name: "Tot Energ Att Prel Giorno-1 F6", address: 40, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F1", capability: false, name: "Tot Energ Att Imm Giorno-1 F1", address: 54, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F2", capability: false, name: "Tot Energ Att Imm Giorno-1 F2", address: 56, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F3", capability: false, name: "Tot Energ Att Imm Giorno-1 F3", address: 58, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F4", capability: false, name: "Tot Energ Att Imm Giorno-1 F4", address: 60, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F5", capability: false, name: "Tot Energ Att Imm Giorno-1 F5", address: 62, count: 2, type: "uint32", unit: "Wh" },
    { id: "meter_power.exp.daily.F6", capability: false, name: "Tot Energ Att Imm Giorno-1 F6", address: 64, count: 2, type: "uint32", unit: "Wh" },
    { id: "energy_phase", capability: true, name: "Fascia oraria corrente", address: 203, count: 1, type: "uint16" },
    { id: "alarm_generic", capability: true, name: "Data evento", address: 780, count: 2, type: "uint32" },
    { id: "energy_detachment", capability: false, name: "Tempo residuo distacco", address: 782, count: 1, type: "uint16" }
  ]
};

module.exports = config;