// routes/admin.js - Endpoint quan tri de nguoi dung chu dong yeu cau may cham cong
// tai bu du lieu ATTLOG cu (tuong duong phan $needToPullBackup trong _getrequest.php
// goc, nhung kich hoat theo yeu cau thay vi hardcode true moi lan may poll).
//
// Luong hoat dong:
//   1. Ban goi POST /admin/backfill?SN=...&start=...&end=... o day
//   2. Lenh duoc xep vao hang doi (commandQueue.js) theo dung SN
//   3. Lan /iclock/getrequest ke tiep cua CHINH may do se nhan lenh
//      "C:id:DATA QUERY ATTLOG StartTime=...\tEndTime=..." va lenh bi xoa khoi hang doi
//   4. May tu truy van log noi bo trong khoang thoi gian do, roi POST len
//      /iclock/cdata?table=ATTLOG nhu du lieu cham cong binh thuong
//      (xem logs/attendance_log.txt de biet bao nhieu ban ghi moi/trung)
const express = require('express');
const router = express.Router();
const { queueCommand, peekAll } = require('../commandQueue');
const { listSNs, all: allKnownDevices } = require('../knownDevices');
const {
  runCleanup,
  defaultCleanupMonth,
  monthRange,
  vnNowParts,
  queueDeviceDeleteCommand,
} = require('../monthlyCleanup');
const fs = require('fs');
const path = require('path');

const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function randCmdId() {
  return Math.floor(Math.random() * 9000) + 1000;
}

// Vi du (tham so truyen qua query string - server chi doc raw text o body
// nen KHONG dung duoc dang form-urlencoded/JSON o day):
//   curl -X POST "http://may-chu:PORT/admin/backfill?SN=2017173760763&start=2026-08-01%2000:00:00&end=2026-08-26%2023:59:59"
router.post('/backfill', (req, res) => {
  const sn = req.query.SN;
  const start = req.query.start;
  const end = req.query.end;

  if (!sn || !start || !end) {
    return res
      .status(400)
      .type('text/plain')
      .send('Thieu tham so. Can: SN, start, end (dinh dang "YYYY-MM-DD HH:mm:ss")');
  }
  if (!DATETIME_RE.test(start) || !DATETIME_RE.test(end)) {
    return res
      .status(400)
      .type('text/plain')
      .send('start/end phai dung dinh dang "YYYY-MM-DD HH:mm:ss", vi du "2026-08-01 00:00:00"');
  }

  const cmdId = randCmdId();
  queueCommand(sn, `C:${cmdId}:DATA QUERY ATTLOG StartTime=${start}\tEndTime=${end}`);

  res
    .type('text/plain')
    .send(`Da xep lenh backfill (id=${cmdId}) cho SN=${sn}. Se gui vao lan /iclock/getrequest ke tiep cua may (thuong trong vong vai chuc giay).`);
});

// Xem nhanh hang doi lenh hien tai (debug) - vd may chua kip poll de nhan lenh
router.get('/backfill/pending', (req, res) => {
  res.json(peekAll());
});


// ---------------------------------------------------------------------------
// Don dep du lieu ATTLOG thang truoc (xem monthlyCleanup.js de biet chi tiet
// va CANH BAO ve do tin cay cua lenh xoa tren may).
// ---------------------------------------------------------------------------

// Goi bang tay de CHAY THU luon (khong doi den ngay 15), dung de kiem tra
// truoc khi tin tuong lich tu dong. Vi day la thao tac XOA DU LIEU (co backup
// CSV truoc khi xoa nhung van la xoa that khoi DB) nen bat buoc phai truyen
// ?confirm=yes va ?month=YYYY-MM (thang muon don, vd "2026-07") de tranh bam
// nham. Neu khong truyen month, mac dinh la "thang truoc thang hien tai".
//   POST /admin/cleanup/run?confirm=yes&month=2026-07
router.post('/cleanup/run', async (req, res) => {
  if (req.query.confirm !== 'yes') {
    return res
      .status(400)
      .type('text/plain')
      .send(
        'Day la thao tac XOA DU LIEU that (co backup CSV truoc khi xoa). ' +
          'Goi lai voi ?confirm=yes&month=YYYY-MM (vd &month=2026-07) de xac nhan.'
      );
  }
  const monthKey = req.query.month || defaultCleanupMonth(vnNowParts());
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return res.status(400).type('text/plain').send('month phai dang "YYYY-MM", vi du "2026-07"');
  }

  const result = await runCleanup(monthKey);
  res.type('application/json').json(result);
});

// Test RIENG lenh xoa tren may (KHONG dung den DB, KHONG xoa gi trong DB ca) -
// dung lenh nay truoc khi tin tuong /cleanup/run se lam dung tren thiet bi that.
// Sau khi goi, doi may poll /iclock/getrequest ke tiep roi xem
// logs/devicecmd_log.txt de biet may co ACK Return=0 hay bao loi/bo qua.
//   POST /admin/cleanup/test-device-command?SN=xxx&month=2026-07
router.post('/cleanup/test-device-command', (req, res) => {
  const sn = req.query.SN;
  const monthKey = req.query.month;
  if (!sn || !monthKey) {
    return res
      .status(400)
      .type('text/plain')
      .send('Can truyen SN va month (vd ?SN=2017173760763&month=2026-07)');
  }
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return res.status(400).type('text/plain').send('month phai dang "YYYY-MM"');
  }

  const { startStr, endStr } = monthRange(monthKey);
  const cmdId = queueDeviceDeleteCommand(sn, startStr, endStr);
  res
    .type('text/plain')
    .send(
      `Da xep lenh xoa (id=${cmdId}) tren may SN=${sn} cho khoang ${startStr} -> ${endStr}. ` +
        `KHONG dung DB. Doi may poll xong roi xem logs/devicecmd_log.txt de kiem tra ACK.`
    );
});

// Xem danh sach may da tung ket noi (de biet SN can truyen o cac lenh tren)
router.get('/cleanup/known-devices', (req, res) => {
  res.json(allKnownDevices());
});

// Xem trang thai lan don dep gan nhat (doc truc tiep cleanup_state.json)
router.get('/cleanup/status', (req, res) => {
  const statePath = path.join(__dirname, '..', 'cleanup_state.json');
  try {
    res.json(JSON.parse(fs.readFileSync(statePath, 'utf8')));
  } catch (e) {
    res.json({ lastCleanupMonth: null, note: 'Chua chay lan nao' });
  }
});


// ---------------------------------------------------------------------------
// Pull toan bo thong tin nguoi dung + van tay dang co tren may (KHONG xoa gi
// ca - day la lenh TRUY VAN, an toan). Dung de tu backup du lieu dang ky truoc
// khi thu nghiem bat ky lenh xoa nao, vi day la loai du lieu DUY NHAT KHONG CO
// BAN SAO o dau khac (khac voi log cham cong da duoc dong bo lien tuc vao DB).
//
// Cu phap lenh (DATA QUERY USERINFO / DATA QUERY FINGERTMP) la suy doan theo
// giao thuc ADMS chung, CHUA kiem chung tren firmware Ronald Jack. Neu may
// khong ho tro, no se ACK loi hoac im lang - khong gay hai gi vi day khong
// phai lenh xoa. Du lieu may tra ve (neu co) duoc ghi NGUYEN VAN vao
// logs/rawdata.log (xem routes/cdata.js) de xem dinh dang that.
//   POST /admin/pull-fingerprints?SN=xxx
router.post('/pull-fingerprints', (req, res) => {
  const sn = req.query.SN;
  if (!sn) {
    return res.status(400).type('text/plain').send('Can truyen SN, vi du ?SN=2017173760763');
  }

  const idUser = randCmdId();
  const idFp = randCmdId();
  queueCommand(sn, `C:${idUser}:DATA QUERY USERINFO`);
  queueCommand(sn, `C:${idFp}:DATA QUERY FINGERTMP`);

  res
    .type('text/plain')
    .send(
      `Da xep 2 lenh TRUY VAN (khong xoa gi) cho SN=${sn}: ` +
        `id=${idUser} DATA QUERY USERINFO, id=${idFp} DATA QUERY FINGERTMP. ` +
        `Doi may poll xong (vai chuc giay), xem logs/devicecmd_log.txt de biet may co ` +
        `ACK/hieu lenh khong, va logs/rawdata.log de xem du lieu may gui ve (neu co).`
    );
});

module.exports = router;
