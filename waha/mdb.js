const fs = require("fs");
const path = require("path");
const odbc = require("odbc");
const axios = require("axios");

const CONFIG_PATH = path.join(__dirname, "config.json");

function readConfig() {
  delete require.cache[require.resolve("./config.json")];
  return require("./config.json");
}

// ================= CONFIG =================
const CONFIG = readConfig();

const DB_PATH = CONFIG.db_path;
const API_URL = CONFIG.api_url;
const INTERVAL = CONFIG.interval;
const MASTER_TABLE = CONFIG.master_table;
const DELAY = CONFIG.delay_after_trigger;
const API_TIMEOUT = CONFIG.api_timeout;

// ================= STATE =================
let lastId = 0;
let isRunning = false;
let db;
let started = false;
let startTimer = null;
let lastEnabled = null;

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
      SELECT MAX(ID) as maxId FROM [${MASTER_TABLE}]
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
    FROM [${MASTER_TABLE}]
    WHERE ID > ${lastId}
    AND Complete = 'Y'
    ORDER BY ID ASC
  `);
}

// ================= UTILS =================
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ================= MAPPING =================
function mapData(general, camber, headlamp, toe) {
  return {
    vin: general?.Vin_Number || "",
    type: general?.TypeName || "",

    camber: {
      fl: camber?.CamberFL ?? null,
      fr: camber?.CamberFR ?? null,
      rl: camber?.CamberRL ?? null,
      rr: camber?.CamberRR ?? null,
    },

    toe: {
      fl: toe?.ToeFL ?? null,
      fr: toe?.ToeFR ?? null,
      rl: toe?.ToeRL ?? null,
      rr: toe?.ToeRR ?? null,
    },

    headlamp: {
      low_beam: {
        left: {
          y: headlamp?.LowBeam_Left_Y ?? null,
          z: headlamp?.LowBeam_Left_Z ?? null,
        },
        right: {
          y: headlamp?.LowBeam_Right_Y ?? null,
          z: headlamp?.LowBeam_Right_Z ?? null,
        },
      },
      high_beam: {
        left: {
          y: headlamp?.HighBeam_Left_Y ?? null,
          z: headlamp?.HighBeam_Left_Z ?? null,
          intensity: headlamp?.LightIntensity_HighBeam_Left ?? null,
        },
        right: {
          y: headlamp?.HighBeam_Right_Y ?? null,
          z: headlamp?.HighBeam_Right_Z ?? null,
          intensity: headlamp?.LightIntensity_HighBeam_Right ?? null,
        },
      },
    },
  };
}

// ================= GET FULL DATA =================
async function getFullDataById(id) {
  try {
    const [general, camber, headlamp, toe] = await Promise.all([
      db.query(`SELECT * FROM [Result_General] WHERE ID = ${id}`),
      db.query(`SELECT * FROM [Result_Camber] WHERE ID = ${id}`),
      db.query(`SELECT * FROM [Result_Headlamp] WHERE ID = ${id}`),
      db.query(`SELECT * FROM [Result_Toe] WHERE ID = ${id}`)
    ]);

    if (!general[0]) return null;

    return mapData(
      general[0],
      camber[0],
      headlamp[0],
      toe[0]
    );

  } catch (err) {
    logError("Multi-table error:", err.message);
    return null;
  }
}

// ================= BUILD PAYLOAD =================
function buildPayload(data) {
  return {
    vin: data.vin,
    type: data.type,
    result_status: "OK",
    result_value: data.camber?.fl ?? 0,
    parameters: data,
    raw_data: data
  };
}

// ================= SEND API =================
async function sendToAPI(payload) {
  try {
    await axios.post(API_URL, payload, {
      timeout: API_TIMEOUT
    });

    log("Sent:", payload.vin);
    return true;

  } catch (err) {
    logError("API error:", payload.vin, err.message);
    return false;
  }
}

// ================= PROCESS =================
async function processData(rows) {
  for (const row of rows) {
    const id = row.ID;

    log("=================================");
    log("Trigger ID:", id);

    await delay(DELAY);

    const mapped = await getFullDataById(id);

    if (!mapped) {
      log("Data tidak ditemukan");
      continue;
    }

    log("MAPPED DATA:");
    console.log(JSON.stringify(mapped, null, 2));

    // const payload = buildPayload(mapped);

    // aktifkan kalau sudah siap kirim
    const success = await sendToAPI(mapped);

    // const success = true; // sementara biar flow aman

    if (!success) {
      log("Stop processing, retry nanti...");
      return;
    }

    lastId = id;
  }
}

async function startAfterDelay() {
  const config = readConfig();

  if (!config.enabled) return;

  log("Trigger ON, waiting 1 minute before start...");

  if (startTimer) clearTimeout(startTimer);

  startTimer = setTimeout(async () => {
    const latest = readConfig();

    if (!latest.enabled) {
      log("Trigger OFF before delay finished, start canceled");
      return;
    }

    if (started) return;

    await connectDB();
    await initLastId();
    started = true;

    log("Index activated");
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
  }

  log("Index deactivated");
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
      log(`Found ${rows.length} completed data`);
      await processData(rows);
    }

  } catch (err) {
    logError("Query error:", err.message);

  } finally {
    isRunning = false;
  }
}

// ================= MAIN =================
async function main() {
  log("MDB Service WAHA Started");

  setInterval(monitorTrigger, 1000);
  setInterval(loop, INTERVAL);
}

main();