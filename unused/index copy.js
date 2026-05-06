const odbc = require("odbc");
const axios = require("axios");

// ===== CONFIG =====
const DB_PATH = "C:/Users/LENOVO/Program/mdbaccess/result.mdb";
const TABLE = "Result_Camber";
const INTERVAL = 3000;
const API_URL = "http://172.17.63.39:4545/data"; // GANTI sesuai server

let lastId = 0;
let isRunning = false;
let db;

// ===== CONNECT =====
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

// ===== INIT =====
async function initLastId() {
  const result = await db.query(
    `SELECT MAX(ID) as maxId FROM [${TABLE}]`
  );

  lastId = result[0].maxId || 0;
  console.log("Start dari ID:", lastId);
}

// ===== GET DATA =====
async function getNewRows() {
  return await db.query(`
    SELECT * FROM [${TABLE}]
    WHERE ID > ${lastId}
    ORDER BY ID ASC
  `);
}

// ===== KIRIM KE API =====
async function sendToAPI(row) {
  try {
    await axios.post(API_URL, row);
    console.log("Terkirim:", row.ID);
    return true;
  } catch (err) {
    console.error("Gagal kirim:", row.ID, err.message);
    return false;
  }
}

// ===== PROCESS =====
async function processData(rows) {
  for (const row of rows) {
    const id = row.ID;

    console.log("Trigger ID:", id);

    const fullData = await getFullDataById(id);

    if (!fullData) return;

    // VALIDASI DATA HARUS LENGKAP
    if (!fullData.camber || !fullData.headlamp || !fullData.toe) {
      console.log("Data belum lengkap, retry nanti...");
      return; // jangan update lastId
    }

    console.log("FULL DATA:", fullData);

    const success = await sendToAPI(fullData);

    if (!success) {
      console.log("Stop processing, retry nanti...");
      return;
    }

    lastId = id;
  }
}

async function getFullDataById(id) {
  try {
    const [camber, headlamp, toe] = await Promise.all([
      db.query(`SELECT * FROM [Result_Camber] WHERE ID = ${id}`),
      db.query(`SELECT * FROM [Result_Headlamp] WHERE ID = ${id}`),
      db.query(`SELECT * FROM [Result_Toe] WHERE ID = ${id}`)
    ]);

    return {
      camber: camber[0] || null,
      headlamp: headlamp[0] || null,
      toe: toe[0] || null
    };
  } catch (err) {
    console.error("Error ambil multi table:", err.message);
    return null;
  }
}

// ===== LOOP =====
async function loop() {
  if (isRunning) return;
  isRunning = true;

  try {
    const rows = await getNewRows();

    if (rows.length > 0) {
      await processData(rows);
    }
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