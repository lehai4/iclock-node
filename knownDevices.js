// knownDevices.js - Ghi nho danh sach SN may cham cong da tung ket noi toi
// server, de cac tac vu tu dong (vd don dep du lieu hang thang) biet phai
// gui lenh cho nhung may nao ma khong can hard-code SN trong code.
// Luu vao file JSON don gian (du dung cho vai chuc may), doc lai khi restart.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'known_devices.json');

let devices = {}; // sn -> { firstSeen, lastSeen }

try {
  devices = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
} catch (e) {
  devices = {};
}

let saving = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(devices, null, 2);
  saving = saving.then(() => fs.promises.writeFile(FILE, snapshot)).catch(() => {});
}

// Goi moi khi nhan duoc request tu 1 SN (bat ky endpoint /iclock/* nao)
function recordSeen(sn) {
  if (!sn || sn === 'Unknown') return;
  const now = new Date().toISOString();
  if (!devices[sn]) {
    devices[sn] = { firstSeen: now, lastSeen: now };
  } else {
    devices[sn].lastSeen = now;
  }
  persist();
}

function listSNs() {
  return Object.keys(devices);
}

function all() {
  return devices;
}

module.exports = { recordSeen, listSNs, all };
