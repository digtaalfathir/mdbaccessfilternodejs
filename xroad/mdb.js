const odbc = require("odbc");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { status } = require("express/lib/response");

const CONFIG_PATH = path.join(__dirname, "config.json");

function readConfig() {
  delete require.cache[require.resolve("./config.json")];
  return require("./config.json");
}

// ================= CONFIG =================
const CONFIG = readConfig();

const DB_PATH = CONFIG.db_path;
const TABLE = CONFIG.table;
const INTERVAL = CONFIG.interval;
const API_URL = CONFIG.api_url;
const VIN_TIMEOUT = CONFIG.vin_timeout;
const API_TIMEOUT = CONFIG.api_timeout;
const START_STEP = CONFIG.start_step;
const COMPLETE_STEP = CONFIG.complete_step;

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
  12801: "rear_gear_10kph",
};

// ================= STATE =================
let lastId = 0;
let isRunning = false;
let db;
let started = false;
let startTimer = null;
let lastEnabled = null;

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

async function disconnectDB() {
  try {
    if (db) {
      await db.close();
      db = null;
      log("MDB closed");
    }
  } catch (err) {
    logError("DB close error:", err.message);
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

// ================= BUFFER HELPERS =================
function createVinBuffer(row, attemptNo = 1) {
  return {
    lastUpdate: Date.now(),
    steps: {},
    carType: row.CarType || "",
    started: false,
    completed: false,
    attemptNo,
  };
}

function ensureVinBuffer(vin, row) {
  if (!vinBuffer[vin]) {
    vinBuffer[vin] = createVinBuffer(row);
  }

  if (!vinBuffer[vin].carType && row.CarType) {
    vinBuffer[vin].carType = row.CarType;
  }
}

function buildData(vin, data, status) {
  const result = {
    vin,
    type: data.carType,
    timestamp: new Date().toISOString(),
    status,
  };

  Object.values(STEP_MAP).forEach((key) => {
    result[key] = data.steps[key] ?? null;
  });

  return result;
}

// ================= SEND =================
async function sendFinalData(vin, data, status = "partial") {
  const mapped = buildData(vin, data, status);

  log("====================================");
  log(`FINAL DATA [${status}]`, vin, `attempt=${data.attemptNo || 1}`);
  console.log(JSON.stringify(mapped, null, 2));

  try {
    await axios.post(API_URL, mapped, { timeout: API_TIMEOUT });
    return true;
  } catch (err) {
    logError("API error:", vin, err.message);
    return false;
  }
}

// ================= PROCESS ROW =================
async function processRow(row) {
  const vin = row.VIN;
  const step = Number.parseInt(row.StepNr, 10);
  const actual = Number.parseFloat(row.Actual);

  if (!vin || Number.isNaN(step)) return;

  ensureVinBuffer(vin, row);
  const data = vinBuffer[vin];

  // step 0 = penanda mulai attempt baru
  if (step === START_STEP) {
    if (data.started && Object.keys(data.steps).length > 0) {
      await sendFinalData(vin, data, data.completed ? "complete" : "partial");

      vinBuffer[vin] = createVinBuffer(row, (data.attemptNo || 1) + 1);
      vinBuffer[vin].started = true;
      vinBuffer[vin].lastUpdate = Date.now();
      return;
    }

    data.started = true;
    data.lastUpdate = Date.now();
    return;
  }

  const mappedKey = STEP_MAP[step];
  if (!mappedKey) return;

  if (!data.started) {
    data.started = true;
  }

  data.steps[mappedKey] = Number.isFinite(actual) ? actual : 0;
  data.lastUpdate = Date.now();

  // step 13000 = complete
  if (step === COMPLETE_STEP) {
    data.completed = true;
    await sendFinalData(vin, data, "complete");
    delete vinBuffer[vin];
  }
}

// ================= PROCESS DATA =================
async function processData(rows) {
  for (const row of rows) {
    await processRow(row);
    lastId = row.ID;
  }
}

// ================= CHECK COMPLETE =================
async function checkCompletedVINs() {
  const now = Date.now();
  const toFinalize = [];

  for (const vin in vinBuffer) {
    const data = vinBuffer[vin];

    if (data.completed) continue;

    if (
      data.started &&
      Object.keys(data.steps).length > 0 &&
      now - data.lastUpdate > VIN_TIMEOUT
    ) {
      toFinalize.push({ vin, data });
    }
  }

  for (const item of toFinalize) {
    await sendFinalData(item.vin, item.data, "partial");
    delete vinBuffer[item.vin];
  }
}

// ================= TRIGGER =================
async function startAfterDelay() {
  const config = readConfig();

  if (!config.enabled) return;

  log("Trigger ON, waiting 1 minute before start...");

  if (startTimer) clearTimeout(startTimer);

  startTimer = setTimeout(async () => {
    const latest = readConfig();

    if (!latest.enabled) {
      log("Trigger OFF before delay finished");
      return;
    }

    if (started) return;

    await connectDB();
    await initLastId();

    started = true;
    log("MDB Activated");
  }, 60_000);
}

async function stopNow() {
  if (startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }

  if (started) {
    await disconnectDB();

    started = false;
    isRunning = false;
    lastId = 0;

    for (const key of Object.keys(vinBuffer)) {
      delete vinBuffer[key];
    }

    log("MDB Deactivated");
  }
}

async function monitorTrigger() {
  try {
    const config = readConfig();

    if (config.enabled && lastEnabled !== true) {
      lastEnabled = true;
      await startAfterDelay();
    }

    if (!config.enabled && lastEnabled !== false) {
      lastEnabled = false;
      await stopNow();
    }
  } catch (err) {
    logError("Monitor error:", err.message);
  }
}

// ================= LOOP =================
async function loop() {
  if (!started || !db) return;

  if (isRunning) return;

  isRunning = true;

  try {
    const rows = await getNewRows();

    if (rows.length > 0) {
      log(`Found ${rows.length} new rows`);
      await processData(rows);
    }

    await checkCompletedVINs();
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

  setInterval(monitorTrigger, 1000);
  setInterval(loop, INTERVAL);
}

main();