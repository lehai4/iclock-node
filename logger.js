// logger.js - Ghi log ra file, dung chung cho ca app (khong phu thuoc route nao).
const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');
const LOG_TO_FILE = process.env.LOG_TO_FILE !== 'false';

// "YYYY-MM-DD HH:mm:ss" theo gio Viet Nam
function vnTimeString(date = new Date()) {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

// Ghi them 1 dong vao file trong LOG_DIR. Khong bao gio throw - loi ghi log
// khong duoc lam sap request dang xu ly cho may cham cong.
function appendLog(file, line) {
  if (!LOG_TO_FILE) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFile(path.join(LOG_DIR, file), line + '\n', (err) => {
      if (err) console.error(`[LOG] Khong ghi duoc ${file}:`, err.message);
    });
  } catch (err) {
    console.error('[LOG] Loi tao thu muc log:', err.message);
  }
}

module.exports = { vnTimeString, appendLog, LOG_DIR };
