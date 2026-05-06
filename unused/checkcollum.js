const odbc = require("odbc");

const DB_PATH = "C:/Users/LENOVO/Program/mdbaccess/result.mdb";
const TABLE = "Result_General";

async function checkColumns() {
  const db = await odbc.connect(
    `Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=${DB_PATH};`
  );

  try {
    const result = await db.columns(null, null, TABLE, null);

    console.log("=== STRUKTUR KOLOM ===");
    result.forEach(col => {
      console.log({
        name: col.COLUMN_NAME,
        type: col.TYPE_NAME,
        nullable: col.NULLABLE,
        size: col.COLUMN_SIZE
      });
    });
  } catch (err) {
    console.error("❌ ERROR:", err);
  }

  await db.close();
}

checkColumns();