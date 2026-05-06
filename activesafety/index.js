const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");

// ================= CONFIG =================
const TXT_PATH = "C:/monitor/result.txt";
const XML_FOLDER = "C:/monitor/xml";
const INTERVAL = 2000;

// ================= STATE =================
let lastLineCount = 0;
const processedFiles = new Set();

// ================= UTILS =================
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// ================= FILE READY =================
async function waitFileReady(filePath, retry = 10) {
  for (let i = 0; i < retry; i++) {
    try {
      fs.accessSync(filePath);
      const stat = fs.statSync(filePath);

      if (stat.size > 0) return true;
    } catch {}

    await delay(200);
  }
  return false;
}

// ================= EXTRACT GROUPED =================
function extractGroupedTests(testsRaw) {
  const tests = Array.isArray(testsRaw) ? testsRaw : [testsRaw];
  const grouped = {};

  tests.forEach((t) => {
    const phase = t.Phase;
    const test = t.Test;
    const status = t.Status;
    const finish_time = t.FinishTime;

    if (!grouped[phase]) {
      grouped[phase] = [];
    }

    grouped[phase].push({
      test,
      status,
      finish_time,
    });
  });

  return grouped;
}

// ================= PARSE XML =================
async function parseXML(filePath) {
  try {
    const xml = fs.readFileSync(filePath, "utf-8");

    const result = await xml2js.parseStringPromise(xml, {
      explicitArray: false,
      mergeAttrs: true,
    });

    const unit = result.UNIT_IN_TEST;
    const process = unit.PROCESS;

    const vin = unit.VIN;
    const finish_time = process.FinishTime;
    const status = process.Status === "Pass" ? "OK" : "NG";

    const grouped = extractGroupedTests(process.TESTS.TEST);

    return {
      vin,
      finish_time,
      status,
      grouped,
    };

  } catch (err) {
    log("❌ XML parse error:", err.message);
    return null;
  }
}

// ================= PROCESS FILE =================
async function processFile(fileName) {
  if (processedFiles.has(fileName)) return;

  const xmlPath = path.join(XML_FOLDER, fileName);

  const ready = await waitFileReady(xmlPath);
  if (!ready) {
    log("⏳ File belum siap:", fileName);
    return;
  }

  log("📥 Processing:", fileName);

  const payload = await parseXML(xmlPath);
  if (!payload) return;

  log("📦 RESULT:");
  console.log(JSON.stringify(payload, null, 2));

  // 🔥 tinggal sambungkan ke sistem kamu
  // sendWS(payload)
  // axios.post(...)

  processedFiles.add(fileName);
}

// ================= WATCH TXT =================
async function watchTxt() {
  try {
    if (!fs.existsSync(TXT_PATH)) {
      log("TXT not found");
      return;
    }

    const content = fs.readFileSync(TXT_PATH, "utf-8");

    const lines = content.trim().split(/\r?\n/);

    if (lines.length <= lastLineCount) return;

    const newLines = lines.slice(lastLineCount);

    for (const line of newLines) {
      const fileName = line.trim();

      if (!fileName.endsWith(".xml")) continue;

      await processFile(fileName);
    }

    lastLineCount = lines.length;

  } catch (err) {
    log("❌ Read TXT error:", err.message);
  }
}

// ================= START =================
function start() {
  log("🚀 XML Watcher (Clean Mode) started");
  setInterval(watchTxt, INTERVAL);
}

start();