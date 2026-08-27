// routes/_getrequest.js - Ban day du chuc nang hon (dong bo gio + yeu cau may bu du lieu).
// KHONG duoc mount vao server.js, giu nguyen trang thai "chua active" giong _getrequest.php
// ben ban PHP goc (khong co rewrite rule nao tro toi no). De lai day de tham khao / kich hoat sau.
//
// Neu muon dung: sua server.js, doi dong
//   app.use('/iclock/getrequest', require('./routes/getrequest'));
// thanh
//   app.use('/iclock/getrequest', require('./routes/_getrequest'));
//
// LUU Y: ban PHP goc co bug lech gio - $currentTime (dung trong lenh CONTROL DEVICE) bi
// tru 2 tieng, trong khi header Date chi bi tru 1 tieng. Ban duoi day sua lai cho dong nhat
// (dung cung mot HOUR_OFFSET cho ca hai cho) - nho kiem tra lai gia tri nay truoc khi bat.
const express = require('express');
const router = express.Router();

const HOUR_OFFSET = 3600; // giay - chinh lai cho khop voi do lech gio thuc te cua may

router.all('/', (req, res) => {
  // const sn = req.query.SN || '';

  // Thoi gian dung de dong bo xuong may (da bu tru)
  const currentTime = formatVN(new Date(Date.now() - HOUR_OFFSET * 1000));

  const needToSyncTime = true; // Co bao can dong bo gio
  const needToPullBackup = true; // Co bao can lay bu du lieu

  const commands = [];

  // 1. Neu can dong bo gio
  if (needToSyncTime) {
    const id3 = randInt(5000, 6999);
    commands.push(`C:${id3}:CONTROL DEVICE 0104\tTime=${currentTime}`);
  }

  // 2. Neu can lay bu du lieu
  if (needToPullBackup) {
    const cmdIdData = randInt(5000, 9999);
    const startTime = '2026-08-01 00:00:00';
    const endTime = '2026-08-26 23:59:59';
    commands.push(`C:${cmdIdData}:DATA QUERY ATTLOG StartTime=${startTime}\tEndTime=${endTime}`);
  }

  // Ghi de header Date tra ve cho may (bu tru cung HOUR_OFFSET)
  res.setHeader('Date', new Date(Date.now() - HOUR_OFFSET * 1000).toUTCString());
  res.type('text/plain');

  if (commands.length > 0) {
    res.send(commands.join('\n'));
  } else {
    res.send('OK');
  }
});

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatVN(date) {
  // 'YYYY-MM-DD HH:mm:ss' theo mui gio Asia/Ho_Chi_Minh
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}

module.exports = router;
