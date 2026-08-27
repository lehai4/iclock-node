// server.js - Diem khoi dong. Tuong duong .htaccess (route) + cac file .php gop lai.
require('dotenv').config();
const express = require('express');
const path = require('path');
const { vnTimeString, appendLog } = require('./logger');

const app = express();
app.disable('x-powered-by');

// QUAN TRONG: dung `type: () => true` thay vi '*/*'. May cham cong nay gui POST
// KHONG kem header Content-Type - voi '*/*' thi Express/body-parser doi phai co
// Content-Type de so khop wildcard nen se BO QUA khong doc body (=> req.body rong,
// cdata.js tuong nhu khong nhan duoc gi). `type: () => true` ep parser luon doc
// raw body bat ke Content-Type la gi/co hay khong.
app.use(express.text({ type: () => true, limit: '10mb' }));

// Ghi log MOI request thuc su toi server (method, URL, do dai + xem truoc body)
// vao logs/request_debug_log.txt - day la cach de biet may cham cong co goi
// dung endpoint (vd /iclock/cdata?table=ATTLOG) hay khong, truoc khi di vao
// tung route rieng.
app.use((req, res, next) => {
  const bodyStr = typeof req.body === 'string' ? req.body : '';
  const line =
    `[${vnTimeString()}] ${req.method} ${req.originalUrl}` +
    ` | body_len=${bodyStr.length} | body_preview=${JSON.stringify(bodyStr.slice(0, 200))}`;
  appendLog('request_debug_log.txt', line);
  next();
});

// ----- Route mapping (tuong duong .htaccess) -----
// RewriteRule ^cdata/?$      cdata.php
// RewriteRule ^getrequest/?$ getrequest.php
// RewriteRule ^devicecmd/?$  devicecmd.php
app.use('/iclock/cdata', require('./routes/cdata'));
app.use('/iclock/getrequest', require('./routes/getrequest'));
app.use('/iclock/devicecmd', require('./routes/devicecmd'));

// Endpoint quan tri (nguoi dung goi tay, khong phai may cham cong):
// POST /admin/backfill?SN=...&start=...&end=... de yeu cau may tai bu du lieu cu.
app.use('/admin', require('./routes/admin'));

// Trang UI don gian de bam nut goi /admin/backfill, khong can go curl tay.
// Mo tai http://<ip-server>:<port>/admin/ui/
app.use('/admin/ui', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.type('text/plain').send('iClock Node server dang chay');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`iClock server dang lang nghe tai port ${PORT}`);
});
