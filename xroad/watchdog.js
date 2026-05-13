const fs = require("fs");
const path = require("path");
const { default: psList } = require("ps-list");

const TARGET_EXE = "Notepad.exe";
const CHECK_INTERVAL = 2000;
const CONFIG_PATH = path.join(__dirname, "config.json");

let previousState = null;

async function isRunning() {
  const processes = await psList();

  return processes.some(
    (p) => p.name.toLowerCase() === TARGET_EXE.toLowerCase()
  );
}

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function writeEnabled(enabled) {
  const config = readConfig();
  config.enabled = enabled;

  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf8"
  );
}

async function check() {
  try {
    const running = await isRunning();

    if (previousState === null) {
      previousState = running;
      writeEnabled(running);

      console.log(
        running
          ? `[OPEN] ${TARGET_EXE}`
          : `[CLOSE] ${TARGET_EXE}`
      );

      return;
    }

    if (running && !previousState) {
      console.log(`[OPEN] ${TARGET_EXE}`);
      writeEnabled(true);
    }

    if (!running && previousState) {
      console.log(`[CLOSE] ${TARGET_EXE}`);
      writeEnabled(false);
    }

    previousState = running;
  } catch (err) {
    console.log("ERROR:", err.message);
  }
}

console.log("WATCHDOG START");

check();
setInterval(check, CHECK_INTERVAL);