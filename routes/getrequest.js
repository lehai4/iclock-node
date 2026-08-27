// routes/getrequest.js - May cham cong poll dinh ky de hoi "co lenh gi can chay khong"
// (tuong duong getrequest.php). Moi lan may poll, server co the gui xuong 3 loai lenh:
//   1) Dong bo gio - lenh "SET OPTIONS DateTime=..." gui dinh ky (co cooldown per-SN,
//      TIME_SYNC_INTERVAL_MINUTES) de may tu chinh lai dong ho noi bo.
//   2) Tu dong bu du lieu gan day - lenh "DATA QUERY ATTLOG" cho N ngay gan nhat,
//      gui dinh ky (co cooldown per-SN, AUTO_BACKFILL_INTERVAL_MINUTES) de tu
//      "vet" lai nhung ban ghi bi lo neu server bi down/mat ket noi mot luc.
//   3) Bu du lieu thu cong - lenh dang cho trong hang doi (xep qua POST /admin/backfill),
//      dung cho khoang thoi gian tuy chinh (vd bu du lieu tu rat lau, ngoai pham vi tu dong).
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

// Tat/bat tu dong bu du lieu gan day (mac dinh: bat)
const AUTO_BACKFILL_ENABLED = process.env.AUTO_BACKFILL_ENABLED !== 'false';
// So ngay gan nhat se yeu cau may gui lai moi lan tu dong bu (mac dinh 30 ngay,
// dung nhu ban yeu cau).
const AUTO_BACKFILL_DAYS = Number(process.env.AUTO_BACKFILL_DAYS || 30);
// QUAN TRONG: khong nen dat qua ngan. Moi lan lenh nay duoc gui, may se doc lai
// TOAN BO log noi bo trong AUTO_BACKFILL_DAYS ngay va day het len server - voi
// cong ty dong nguoi co the la hang chuc nghin dong. Du DB da chan trung (unique
// constraint) nen KHONG tao ban ghi trung, nhung van ton bang thong + CPU may
// cham cong + hang chuc nghin luot INSERT-that-bai lien tuc tren SQL Server neu
// lap lai qua thuong xuyen. Mac dinh 1 lan/ngay la du de "tu vet" lai du lieu
// neu server bi down mot luc, ma khong lam qua tai he thong.
const AUTO_BACKFILL_INTERVAL_MS = Number(process.env.AUTO_BACKFILL_INTERVAL_MINUTES || 720) * 60 * 1000;

// Lan gan nhat da lam cho tung SN - luu trong bo nho, mat khi restart server.
// Day la CHU Y: vi Map rong sau khi restart, lan poll DAU TIEN cua moi may sau
// khi server vua khoi dong lai SE LUON duoc dong bo gio + tu dong bu du lieu
// ngay lap tuc (khong doi du cooldown) - dung y, vi day thuong la luc can "vet"
// lai du lieu nhat (server vua downtime xong).
const lastTimeSyncAt = new Map(); // sn -> timestamp (ms)
const lastAutoBackfillAt = new Map(); // sn -> timestamp (ms)

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

  // 2) Tu dong bu du lieu gan day - chi gui neu da qua cooldown cho dung SN nay
  if (AUTO_BACKFILL_ENABLED) {
    const lastBackfill = lastAutoBackfillAt.get(sn) || 0;
    if (now - lastBackfill >= AUTO_BACKFILL_INTERVAL_MS) {
      const end = new Date(now);
      const start = new Date(now - AUTO_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
      commands.push(
        `C:${randCmdId()}:DATA QUERY ATTLOG StartTime=${vnTimeString(start)}\tEndTime=${vnTimeString(end)}`
      );
      lastAutoBackfillAt.set(sn, now);
    }
  }

  // 3) Bu du lieu thu cong (khoang tuy chinh) - lay het lenh dang cho cua dung SN nay
  commands.push(...drainCommands(sn));

  if (commands.length > 0) {
    appendLog('sent_commands_log.txt', `[${vnTimeString()}] SN=${sn} -> ${commands.join(' | ')}`);
    res.send(commands.join('\n'));
  } else {
    res.send('OK');
  }
});

module.exports = router;
