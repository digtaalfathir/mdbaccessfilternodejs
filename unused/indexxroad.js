const odbc = require("odbc");
const axios = require("axios");

// ===== CONFIG =====
const DB_PATH = "C:/Users/LENOVO/Program/mdbaccess/result.mdb";
const TABLE = "TestStepsResults";
const INTERVAL = 3000;
const API_URL = "http://172.17.63.39:4545/data";

// timeout VIN dianggap selesai (ms)
const VIN_TIMEOUT = 4000;

// ===== STEP MAPPING =====
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

let lastId = 0;
let isRunning = false;
let db;

// buffer per VIN
let vinBuffer = {};

// ===== CONNECT DB =====
async function connectDB() {
  try {
    db = await odbc.connect(
      `Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=${DB_PATH};`
    );
    console.log("Connected to MDB");
  } catch (err) {
    console.error("Connect error:", err.message);
  }
}

// ===== INIT LAST ID =====
async function initLastId() {
  const result = await db.query(`
    SELECT MAX(ID) as maxId FROM [${TABLE}]
  `);

  lastId = result[0]?.maxId || 0;
  console.log("Start dari ID:", lastId);
}

// ===== GET NEW ROWS =====
async function getNewRows() {
  return await db.query(`
    SELECT *
    FROM [${TABLE}]
    WHERE ID > ${lastId}
    ORDER BY ID ASC
  `);
}

// ===== PROCESS ROW =====
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

// ===== BUILD DATA =====
function buildData(vin, data) {
  return {
    vin,
    type: data.carType,
    timestamp: new Date().toISOString(),
    parameters: data.steps,
    raw_data: data
  };
}

// ===== SEND / OUTPUT =====
async function sendFinalData(vin, data) {
  const mapped = buildData(vin, data);

  console.log("\n====================================");
  console.log("FINAL DATA:");
  console.log(JSON.stringify(mapped, null, 2));

  // 🔥 kalau nanti mau aktifkan API
  // await axios.post(API_URL, mapped);
}

// ===== CHECK VIN COMPLETE =====
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

// ===== PROCESS DATA =====
async function processData(rows) {
  for (const row of rows) {
    processRow(row);
    lastId = row.ID;
  }
}

// ===== LOOP =====
async function loop() {
  if (isRunning) return;
  isRunning = true;

  try {
    const rows = await getNewRows();

    if (rows.length > 0) {
      console.log(`Found ${rows.length} new rows`);
      await processData(rows);
    }

    checkCompletedVINs();

  } catch (err) {
    console.error("Query error:", err.message);

    try {
      await connectDB();
    } catch {}
  }

  isRunning = false;
}

// ===== MAIN =====
async function main() {
  await connectDB();
  await initLastId();

  setInterval(loop, INTERVAL);
}

main();