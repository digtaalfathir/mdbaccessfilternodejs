const odbc = require("odbc");

const DB_PATH = "C:/Users/LENOVO/Program/mdbaccess/result.mdb";
const TABLE = "Result_General";

function formatDate(date) {
  return (
    date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" +
    String(date.getDate()).padStart(2, "0") + " " +
    String(date.getHours()).padStart(2, "0") + ":" +
    String(date.getMinutes()).padStart(2, "0") + ":" +
    String(date.getSeconds()).padStart(2, "0")
  );
}

async function insertData() {
  const db = await odbc.connect(
    `Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=${DB_PATH};`
  );

  try {
    // 🔥 ambil ID terakhir
    const res = await db.query(`
      SELECT MAX(ID) as maxId FROM [${TABLE}]
    `);

    let nextId = (res[0].maxId || 0) + 1;

    const now = formatDate(new Date());

    const query = `
      INSERT INTO [${TABLE}] 
      (ID, [TypeName], [Vin_Number], [Machine ID], [DateTime])
      VALUES (
        ${nextId},
        'TEST',
        'VIN${Math.floor(Math.random() * 10000)}',
        'SIMULATOR',
        #${now}#
      )
    `;

    await db.query(query);

    console.log(`✅ INSERT BERHASIL (ID: ${nextId})`);
  } catch (err) {
    console.error("❌ INSERT ERROR:", err);
  }

  await db.close();
}

insertData();