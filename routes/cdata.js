// routes/cdata.js - Nhan du lieu cham cong (ATTLOG) may day len (tuong duong cdata.php)
const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../db');
const { vnTimeString, appendLog } = require('../logger');

// SQL Server bao loi nay khi vi pham UNIQUE constraint / UNIQUE index
// (tuong duong SQLSTATE 23000 ma PDO tra ve)
const UNIQUE_VIOLATION_CODES = new Set([2627, 2601]);

router.all('/', async (req, res) => {
  const sn = req.query.SN || 'Unknown';
  const table = req.query.table || '';

  // May cham cong day du lieu dang text/plain (tab-separated), khong phai JSON
  const postData = typeof req.body === 'string' ? req.body : '';

  // Lay IP cua may cham cong (dung lam cot IP - khoa Unique trong thiet ke bang)
  const clientIP =
    (req.ip || req.socket.remoteAddress || '').replace('::ffff:', '') || '';

  res.type('text/plain');

  if (table === 'ATTLOG' && postData.trim() !== '') {
    // Tach du lieu thanh tung dong (moi lan may gui co the chua hang chuc luot quet the)
    const lines = postData.trim().split('\n').filter((l) => l.trim() !== '');

    let receivedCount = 0; // tong so dong hop le nhan duoc
    let successCount = 0; // so dong insert thanh cong (ban ghi moi)
    let duplicateCount = 0; // so dong bi trung (may gui lai du lieu cu)
    let errorCount = 0; // so dong loi that su (DB tu choi vi ly do khac)
    let dbConnectFailed = false;

    try {
      const pool = await getPool();

      for (const rawLine of lines) {
        const line = rawLine.trim();

        // Cac truong du lieu cua ZKTeco thuong ngan cach bang dau Tab
        const parts = line.split('\t');

        // Dam bao dong du lieu hop le (co it nhat Ma NV va Thoi gian)
        if (parts.length < 2) continue;
        receivedCount++;

        const enrollNumber = parts[0];
        const checkTime = parts[1];
        // Cac truong phia sau co the khong co tuy dong may, mac dinh la 0
        const attState = parts[2] !== undefined ? parseInt(parts[2], 10) || 0 : 0;
        const verifyMethod = parts[3] !== undefined ? parseInt(parts[3], 10) || 0 : 0;

        try {
          await pool
            .request()
            .input('ip', sql.VarChar(45), clientIP)
            .input('enrollNumber', sql.VarChar(50), enrollNumber)
            .input('checkTime', sql.VarChar(25), checkTime)
            .input('attState', sql.Int, attState)
            .input('verifyMethod', sql.Int, verifyMethod).query(`
              INSERT INTO HRM_AttendanceLog (IP, EnrollNumber, CheckTime, AttState, VerifyMethod)
              VALUES (@ip, @enrollNumber, @checkTime, @attState, @verifyMethod)
            `);
          successCount++;
        } catch (err) {
          if (UNIQUE_VIOLATION_CODES.has(err.number)) {
            // May cham cong gui lai du lieu cu, bo qua
            duplicateCount++;
            continue;
          }
          // Loi nghiem trong khac (rot mang db, sai kieu du lieu...)
          errorCount++;
          console.error('[cdata] DB Insert Error:', err.message);
        }
      }
    } catch (err) {
      dbConnectFailed = true;
      console.error('[cdata] Loi ket noi DB:', err.message);
    }

    // Ghi log tom tat MOI lan nhan ATTLOG - day la cho de biet "co ghi nhan
    // hay khong": nhan=so dong hop le, moi=da luu vao DB, trung=may gui lai
    // du lieu cu (binh thuong), loi=that su co van de can xem console.error o tren.
    const summary =
      `[${vnTimeString()}] SN=${sn} IP=${clientIP}` +
      ` | nhan=${receivedCount} moi=${successCount} trung=${duplicateCount} loi=${errorCount}` +
      (dbConnectFailed ? ' | KHONG KET NOI DUOC SQL SERVER' : '');
    appendLog('attendance_log.txt', summary);
  } else if (table && table !== 'ATTLOG' && postData.trim() !== '') {
    // Bat ky bang nao khac ATTLOG may gui len (vd USERINFO, FP/FINGERTMP,
    // OPERLOG...) - ghi NGUYEN VAN (khong cat bot) vao logs/rawdata.log de
    // sau nay xem dinh dang that va dung lam backup. request_debug_log.txt
    // chi luu 200 ky tu dau nen khong du de backup du lieu that (vd van tay).
    const raw =
      `[${vnTimeString()}] SN=${sn} ip=${clientIP} table=${table} len=${postData.length}\n` +
      postData +
      '\n---';
    appendLog('rawdata.log', raw);
  }

  // Quan trong: luon tra ve chu OK de may cham cong biet server da xu ly xong
  res.send('OK');
});

module.exports = router;
