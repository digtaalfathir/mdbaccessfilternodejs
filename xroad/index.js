const odbc = require("odbc");
const axios = require("axios");
const CONFIG = require("./config.json");

// ================= CONFIG =================
const DB_PATH = CONFIG.db_path;
const TABLE = CONFIG.table;
const INTERVAL = CONFIG.interval;
const API_URL = CONFIG.api_url;
const VIN_TIMEOUT = CONFIG.vin_timeout;
const API_TIMEOUT = CONFIG.api_timeout;

// ================= STEP MAPPING =================
const STEP_MAP = {
  4001: "total_force_fa",
  5001: "total_force_ra",
  5004: "total_car_force_ratio",
  6601: "force_fl_abs",
  6602: "force_fr_abs",
  6603: "force_rl_abs",
  6604: "force_rr_abs",
  7501: "hand_brake_force",
  12004: "m3_d3",
  12003: "m2_m3",
  12002: "m1_m2",
  12001: "m1",
  12401: "drive_40kph",
  12801: "rear_gear_10kph"
};

// ================= STATE =================
let lastId = 0;
let isRunning = false;
let db;

// buffer per VIN
const vinBuffer = {};

// ================= LOGGER =================
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function logError(...args) {
  console.error(new Date().toISOString(), ...args);
}

// ================= CONNECT DB =================
async function connectDB() {
  try {
    db = await odbc.connect(
      `Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=${DB_PATH};`
    );
    log("Connected to MDB");
  } catch (err) {
    logError("DB Connect error:", err.message);
  }
}

// ================= INIT =================
async function initLastId() {
  try {
    const result = await db.query(`
      SELECT MAX(ID) as maxId FROM [${TABLE}]
    `);

    lastId = result[0]?.maxId || 0;
    log("Start from ID:", lastId);

  } catch (err) {
    logError("Init error:", err.message);
  }
}

// ================= GET DATA =================
async function getNewRows() {
  return db.query(`
    SELECT *
    FROM [${TABLE}]
    WHERE ID > ${lastId}
    ORDER BY ID ASC
  `);
}

// ================= PROCESS ROW =================
function processRow(row) {
  const vin = row.VIN;
  const step = parseInt(row.StepNr);
  const actual = parseFloat(row.Actual) || 0;

  if (!vin || !STEP_MAP[step]) return;

  if (!vinBuffer[vin]) {
    vinBuffer[vin] = {
      lastUpdate: Date.now(),
      steps: {},
      carType: row.CarType || ""
    };
  }

  vinBuffer[vin].steps[STEP_MAP[step]] = actual;
  vinBuffer[vin].lastUpdate = Date.now();
}

// ================= BUILD DATA =================
function buildData(vin, data) {
  const result = {
    vin,
    type: data.carType,
    timestamp: new Date().toISOString(),
  };

  // pastikan semua key ada (default null)
  Object.values(STEP_MAP).forEach((key) => {
    result[key] = data.steps[key] ?? null;
  });

  return result;
}

// ================= SEND =================
async function sendFinalData(vin, data) {
  const mapped = buildData(vin, data);

  log("====================================");
  log("FINAL DATA:", vin);
  console.log(JSON.stringify(mapped, null, 2));

  try {
    // aktifkan kalau siap kirim
    await axios.post(API_URL, mapped, { timeout: API_TIMEOUT });

    return true;
  } catch (err) {
    logError("API error:", vin, err.message);
    return false;
  }
}

// ================= CHECK COMPLETE =================
function checkCompletedVINs() {
  const now = Date.now();

  for (const vin in vinBuffer) {
    const data = vinBuffer[vin];

    if (now - data.lastUpdate > VIN_TIMEOUT) {
      sendFinalData(vin, data);
      delete vinBuffer[vin];
    }
  }
}

// ================= PROCESS DATA =================
async function processData(rows) {
  for (const row of rows) {
    processRow(row);
    lastId = row.ID;
  }
}

// ================= LOOP =================
async function loop() {
  if (isRunning) return;
  isRunning = true;

  try {
    const rows = await getNewRows();

    if (rows.length > 0) {
      log(`Found ${rows.length} new rows`);
      await processData(rows);
    }

    checkCompletedVINs();

  } catch (err) {
    logError("Query error:", err.message);

    try {
      await connectDB();
    } catch {}
  }

  isRunning = false;
}

// ================= MAIN =================
async function main() {
  log("Step-based MDB Service Started");

  await connectDB();
  await initLastId();

  setInterval(loop, INTERVAL);
}

main();