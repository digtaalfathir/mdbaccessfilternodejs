const odbc = require("odbc");
const axios = require("axios");

// ===== CONFIG =====
const DB_PATH = "C:/Users/LENOVO/Program/mdbaccess/result.mdb";
const INTERVAL = 3000;
const API_URL = "http://172.17.63.39:4545/data";

const MASTER_TABLE = "Result_General";

let lastId = 0;
let isRunning = false;
let db;

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

async function initLastId() {
  const result = await db.query(`
    SELECT MAX(ID) as maxId FROM [${MASTER_TABLE}]
  `);

  lastId = result[0]?.maxId || 0;
  console.log("Start dari ID:", lastId);
}

async function getNewRows() {
  return await db.query(`
    SELECT *
    FROM [${MASTER_TABLE}]
    WHERE ID > ${lastId}
    AND Complete = 'Y'
    ORDER BY ID ASC
  `);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    console.error("Error ambil multi table:", err.message);
    return null;
  }
}

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

async function sendToAPI(payload) {
  try {
    await axios.post(API_URL, payload, {
      timeout: 5000
    });

    console.log("Terkirim:", payload.vin);
    return true;
  } catch (err) {
    console.error("Gagal kirim:", payload.vin, err.message);
    return false;
  }
}

async function processData(rows) {
  for (const row of rows) {
    const id = row.ID;

    console.log("\n===============================");
    console.log("Trigger ID:", id);

    // delay kecil biar data semua tabel ready
    await delay(200);

    const mapped = await getFullDataById(id);

    if (!mapped) {
      console.log("Data tidak ditemukan");
      continue;
    }

    console.log("MAPPED DATA:");
    console.log(JSON.stringify(mapped, null, 2));

    const payload = buildPayload(mapped);

    // const success = await sendToAPI(mapped);

    if (!success) {
      console.log("Stop processing, retry nanti...");
      return;
    }

    lastId = id;
  }
}

async function loop() {
  if (isRunning) return;
  isRunning = true;

  try {
    const rows = await getNewRows();

    if (rows.length > 0) {
      console.log(`Found ${rows.length} completed data`);
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

async function main() {
  await connectDB();
  await initLastId();

  setInterval(loop, INTERVAL);
}

main();