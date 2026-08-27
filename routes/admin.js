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

module.exports = router;
