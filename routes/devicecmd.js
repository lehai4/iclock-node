// routes/devicecmd.js - May cham cong bao ket qua thuc thi lenh ve day.
// Ghi log lai de biet lenh (vd SET OPTIONS DateTime) co thanh cong hay khong
// (Return=0 la OK, khac 0 la loi / khong ho tro lenh). Tuong duong devicecmd.php
const express = require('express');
const router = express.Router();
const { vnTimeString, appendLog } = require('../logger');

router.all('/', (req, res) => {
  const sn = req.query.SN || '';
  const body = typeof req.body === 'string' ? req.body : '';
  const qs = req.originalUrl.split('?')[1] || '';

  const ack = body.trim().replace(/\r\n|\r|\n/g, ' ~ ');
  appendLog('devicecmd_log.txt', `[${vnTimeString()}] SN=${sn} | QS=${qs} | ACK=${ack}`);

  res.type('text/plain');
  res.send('OK');
});

module.exports = router;
