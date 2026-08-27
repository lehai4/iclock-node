// routes/getrequest.js - May cham cong poll dinh ky de hoi "co lenh gi can chay khong"
// (tuong duong getrequest.php). Moi lan may poll, server co the gui xuong 2 loai lenh:
//   1) Dong bo gio - lenh "SET OPTIONS DateTime=..." gui dinh ky (co cooldown per-SN,
//      TIME_SYNC_INTERVAL_MINUTES) de may tu chinh lai dong ho noi bo.
//   2) Bu du lieu - lenh dang cho trong hang doi (xep qua POST /admin/backfill).
// Neu khong co lenh nao ca thi tra "OK" nhu binh thuong.
const express = require('express');
const router = express.Router();
const { vnTimeString, appendLog } = require('../logger');
const { drainCommands } = require('../commandQueue');

// Tat/bat dong bo gio tu dong bang bien moi truong (mac dinh: bat)
const TIME_SYNC_ENABLED = process.env.TIME_SYNC_ENABLED !== 'false';
// Chi gui lenh dong bo gio moi X phut/may (mac dinh 10p), tranh spam lam
// dong ho may "nhay loan" khi may poll getrequest lien tuc (vai giay/lan).
const TIME_SYNC_INTERVAL_MS = Number(process.env.TIME_SYNC_INTERVAL_MINUTES || 10) * 60 * 1000;
// Mot so may cham cong co firmware quirk rieng: sau khi nhan dung gio that qua
// lenh SET OPTIONS DateTime, no lai tu chay nhanh/cham di vai chuc phut. Bu tru
// bang cach cong them so phut nay (co the am) TRUOC KHI format gio gui xuong may.
// Header Date HTTP (ben duoi) khong bi anh huong boi so nay.
const DEVICE_TIME_OFFSET_MS = Number(process.env.DEVICE_TIME_OFFSET_MINUTES || 0) * 60 * 1000;

// Lan dong bo gio gan nhat cho tung SN - luu trong bo nho, mat khi restart server
// (khong sao, lan poll dau tien sau restart se dong bo lai ngay, khong hai gi).
const lastTimeSyncAt = new Map(); // sn -> timestamp (ms)

function randCmdId() {
  return Math.floor(Math.random() * 9000) + 1000;
}

/**
 * Tra ve chuoi HTTP Date (GMT) da bi lui lai `offsetSeconds` giay.
 * Giu nguyen "meo" bu tru gio tu ban PHP goc: tru bot 1 tieng truoc khi
 * format theo chuan HTTP Date, vi may co xu huong tu cong them gio khi doc header nay.
 */
function adjustedHttpDate(offsetSeconds) {
  const adjusted = new Date(Date.now() - offsetSeconds * 1000);
  return adjusted.toUTCString(); // vd: "Thu, 27 Aug 2026 09:00:00 GMT"
}

router.all('/', (req, res) => {
  const sn = req.query.SN || 'Unknown';
  const now = Date.now();

  // Ghi de header Date de tra ve cho may cham cong (bu tru 1 tieng nhu ban PHP)
  res.setHeader('Date', adjustedHttpDate(3600));
  res.type('text/plain');

  const commands = [];

  // 1) Dong bo gio - chi gui neu da qua cooldown cho dung SN nay
  if (TIME_SYNC_ENABLED) {
    const lastSync = lastTimeSyncAt.get(sn) || 0;
    if (now - lastSync >= TIME_SYNC_INTERVAL_MS) {
      const deviceTime = new Date(now + DEVICE_TIME_OFFSET_MS);
      commands.push(`C:${randCmdId()}:SET OPTIONS DateTime=${vnTimeString(deviceTime)}`);
      lastTimeSyncAt.set(sn, now);
    }
  }

  // 2) Bu du lieu - lay het lenh dang cho cua dung SN nay (da tu xoa khoi hang doi)
  commands.push(...drainCommands(sn));

  if (commands.length > 0) {
    appendLog('sent_commands_log.txt', `[${vnTimeString()}] SN=${sn} -> ${commands.join(' | ')}`);
    res.send(commands.join('\n'));
  } else {
    res.send('OK');
  }
});

module.exports = router;
