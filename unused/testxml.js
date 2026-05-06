const fs = require("fs");
const xml2js = require("xml2js");

// ================= CONFIG =================
const XML_FILE = "/home/baymax/Program/Git/Github/mdbaccess/MHMWV1234TC000001_20260430_080255.xml";
const OUTPUT_JSON = "/home/baymax/Program/Git/Github/mdbaccess/output.json";

// ================= UTILS =================
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ================= EXTRACT TESTS =================
function extractGroupedTests(testsRaw) {
  const tests = Array.isArray(testsRaw) ? testsRaw : [testsRaw];
  const grouped = {};

  tests.forEach((t) => {
    const phase = t.Phase;
    const test = t.Test;
    const status = t.Status;
    const finish_time = t.FinishTime; // 🔥 tambahin ini

    if (!grouped[phase]) {
      grouped[phase] = [];
    }

    grouped[phase].push({
      test,
      status,
      finish_time // 🔥 simpan disini
    });
  });

  return grouped;
}

// ================= PARSE XML =================
async function parseXML(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error("File XML tidak ditemukan");
    }

    const xml = fs.readFileSync(filePath, "utf-8");

    const result = await xml2js.parseStringPromise(xml, {
      explicitArray: false,
      mergeAttrs: true,
    });

    const unit = result.UNIT_IN_TEST;
    const process = unit.PROCESS;

    const vin = unit.VIN;
    const finishTime = process.FinishTime;
    const status = process.Status;

    const grouped = extractGroupedTests(process.TESTS.TEST);

    return {
      vin,
      finish_time: finishTime,
      status: status === "Pass" ? "OK" : "NG",
      grouped
    };

  } catch (err) {
    log("❌ Parse error:", err.message);
    return null;
  }
}

// ================= MAIN =================
async function main() {
  log("🚀 Parsing XML → JSON");

  const payload = await parseXML(XML_FILE);
  if (!payload) return;

  try {
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(payload, null, 2));
    log("✅ JSON berhasil dibuat:", OUTPUT_JSON);
  } catch (err) {
    log("❌ Gagal write JSON:", err.message);
  }
}

main();