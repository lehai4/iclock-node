// monthlyCleanup.js - Tu dong don dep du lieu cham cong vao ngay
// MONTHLY_CLEANUP_DAY (mac dinh 15) hang thang.
//
// QUAN TRONG - thang bi xoa la THANG TRUOC THANG TRUOC LIEN KE (lui 2 thang so
// voi hien tai), KHONG PHAI thang truoc lien ke. Vi du hom nay 15/08/2026:
// thang 7 (thang truoc lien ke) duoc GIU LAI nguyen, chi thang 6 bi xoa. Ly do:
// bo phan nhan su co the can du lieu thang truoc lien ke de chot cong ngay ca
// sau ngay 15 (chot tre) - xem defaultCleanupMonth().
//
//   1. Xuat du lieu HRM_AttendanceLog cua thang muc tieu ra file CSV trong
//      MONTHLY_CLEANUP_BACKUP_DIR (mac dinh ./backups) - de phong khi can tra
//      cuu lai hoac lo xoa nham.
//   2. XOA cac ban ghi do khoi SQL Server (DELETE ... WHERE CheckTime trong
//      khoang thang muc tieu).
//   3. Gui lenh yeu cau MOI may cham cong da tung ket noi (xem knownDevices.js)
//      tu xoa du lieu thang do TRONG BO NHO CUA MAY, qua lenh
//      "DATA DELETE ATTLOG StartTime=...\tEndTime=...".
//
// ******************************************************************
// CANH BAO QUAN TRONG ve buoc 3: cu phap lenh "DATA DELETE ATTLOG
// StartTime=...EndTime=..." la suy doan tu tai lieu ADMS/ZKTeco chung, CHUA
// duoc kiem chung tren firmware may Ronald Jack cu the cua ban. May co the:
//   - Bo qua lenh (khong ho tro) - van ACK OK nhung khong xoa gi ca
//   - Bao loi trong Return code (xem logs/devicecmd_log.txt)
//   - Hoac hoat dong dung y muon
// BAT BUOC phai test bang tay 1 lan qua route
// POST /admin/cleanup/test-device-command TRUOC KHI tin tuong lenh nay chay
// tu dong hang thang (xem README). Buoc 1 va 2 (backup + xoa DB) KHONG phu
// thuoc vao buoc 3 co thanh cong hay khong tren may - luon chay day du du sao.
// ******************************************************************
//
// CheckTime trong HRM_AttendanceLog duoc luu dang CHUOI "YYYY-MM-DD HH:mm:ss"
// (xem routes/cdata.js dung sql.VarChar, khong phai kieu DATETIME that), nen
// so sanh khoang thang o day cung dung SO SANH CHUOI (>=, <) - KHONG dung Date
// object de tranh nguy co lech mui gio server (bai hoc tu phan dong bo gio).
const fs = require('fs');
const path = require('path');
const { getPool, sql } = require('./db');
const { vnTimeString, appendLog } = require('./logger');
const { queueCommand } = require('./commandQueue');
const { listSNs } = require('./knownDevices');

const ENABLED = process.env.MONTHLY_CLEANUP_ENABLED !== 'false';
const CLEANUP_DAY = Number(process.env.MONTHLY_CLEANUP_DAY || 15);
const BACKUP_DIR = process.env.MONTHLY_CLEANUP_BACKUP_DIR || path.join(__dirname, 'backups');
const STATE_FILE = path.join(__dirname, 'cleanup_state.json');
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // kiem tra moi 1 gio la du, khong can chinh xac tung phut

// Ep chay ngay khi khoi dong cho 1 thang chi dinh (vd "2026-05"), BO QUA kiem
// tra ngay 15 va bo qua cleanup_state.json - CHI DUNG DE TEST THU CONG qua
// .env, khong ghi de trang thai lich tu dong that (khong writeState). Xoa bien
// nay khoi .env sau khi test xong de quay lai lich binh thuong.
const FORCE_MONTH = process.env.MONTHLY_CLEANUP_FORCE_MONTH || null;
let forcedAlready = false;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Lay ngay/thang/nam HIEN TAI theo dung gio Viet Nam, doc tu vnTimeString()
// (khong dung Date object truc tiep de tranh phu thuoc mui gio he dieu hanh server).
function vnNowParts() {
  const [datePart] = vnTimeString().split(' '); // "YYYY-MM-DD HH:mm:ss" -> "YYYY-MM-DD"
  const [y, m, d] = datePart.split('-').map(Number);
  return { y, m, d }; // m: 1-12
}

// Lui/tien so thang bat ky so voi {y, m} (m: 1-12). offset am = lui ve truoc.
function monthKeyOffset({ y, m }, offset) {
  const total = y * 12 + (m - 1) + offset;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad2(nm)}`;
}

// Thang se bi don dep khi khong truyen ?month= cu the: LUI 2 THANG so voi hien
// tai (bo qua thang truoc lien ke, chi xoa thang truoc do 1 thang nua).
// Vi du: hom nay la 15/08/2026 -> thang 7 (thang truoc lien ke) duoc GIU LAI
// nguyen (HR con can du lieu thang truoc de chot cong sau ngay 15), chi thang
// 6 (thang truoc do 1 thang nua) moi bi xoa. Doi lai theo yeu cau nguoi dung
// ngay 2026-08-29: ly do la bo phan nhan su co the can du lieu thang truoc
// lien ke ngay ca sau ngay 15 (chot cong tre).
function defaultCleanupMonth(parts) {
  return monthKeyOffset(parts, -2);
}

// Khoang [start, end) cua 1 thang "YYYY-MM" -> chuoi "YYYY-MM-DD HH:mm:ss"
function monthRange(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const startStr = `${y}-${pad2(m)}-01 00:00:00`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const endStr = `${ny}-${pad2(nm)}-01 00:00:00`;
  return { startStr, endStr };
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}
function writeState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[cleanup] Khong ghi duoc cleanup_state.json:', e.message);
  }
}

function toCsvValue(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Xuat ra CSV roi xoa khoi DB. Tra ve so dong.
async function exportAndDelete(monthKey) {
  const { startStr, endStr } = monthRange(monthKey);
  const pool = await getPool();

  const selectResult = await pool
    .request()
    .input('start', sql.VarChar(25), startStr)
    .input('end', sql.VarChar(25), endStr)
    .query(`
      SELECT IP, EnrollNumber, CheckTime, AttState, VerifyMethod
      FROM HRM_AttendanceLog
      WHERE CheckTime >= @start AND CheckTime < @end
      ORDER BY CheckTime
    `);

  const rows = selectResult.recordset;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const csvPath = path.join(BACKUP_DIR, `HRM_AttendanceLog_${monthKey}.csv`);
  const header = 'IP,EnrollNumber,CheckTime,AttState,VerifyMethod';
  const lines = rows.map((r) =>
    [r.IP, r.EnrollNumber, r.CheckTime, r.AttState, r.VerifyMethod].map(toCsvValue).join(',')
  );
  fs.writeFileSync(csvPath, [header, ...lines].join('\n') + '\n', 'utf8');

  const deleteResult = await pool
    .request()
    .input('start', sql.VarChar(25), startStr)
    .input('end', sql.VarChar(25), endStr)
    .query(`DELETE FROM HRM_AttendanceLog WHERE CheckTime >= @start AND CheckTime < @end`);

  return {
    rowCount: rows.length,
    deletedCount: (deleteResult.rowsAffected && deleteResult.rowsAffected[0]) || 0,
    csvPath,
    startStr,
    endStr,
  };
}

function randCmdId() {
  return Math.floor(Math.random() * 9000) + 1000;
}

// Xep lenh yeu cau may xoa du lieu noi bo trong khoang [startStr, endStr) cho
// 1 SN. Tach rieng ham nay de dung chung cho ca job tu dong lan route test tay.
function queueDeviceDeleteCommand(sn, startStr, endStr) {
  const cmdId = randCmdId();
  queueCommand(sn, `C:${cmdId}:DATA DELETE ATTLOG StartTime=${startStr}\tEndTime=${endStr}`);
  return cmdId;
}

// Chay day du: backup + xoa DB + xep lenh xoa tren tat ca may da biet (logic
// nguyen goc - da duoc nguoi dung xac nhan bat lai sau khi test rieng lenh
// xoa tren may bang route /admin/cleanup/test-device-command va kiem tra
// User/FP/Face/Card Count truoc/sau khong doi).
//
// LUU Y: cu phap lenh "DATA DELETE ATTLOG StartTime=...EndTime=..." van la
// suy doan theo giao thuc ADMS chung (chua co tai lieu chinh hang doi chieu),
// nhung da duoc chap nhan rui ro sau khi test thu cong. Neu sau nay thay may
// cham cong co dau hieu bat thuong (mat vân tay/nguoi dung), quay lai TAT
// tinh nang nay bang cach comment lai doan queueDeviceDeleteCommand ben duoi.
async function runCleanup(monthKey) {
  const label = `[cleanup] Thang=${monthKey}`;
  try {
    const result = await exportAndDelete(monthKey);
    appendLog(
      'cleanup_log.txt',
      `[${vnTimeString()}] ${label} | backup=${result.csvPath} (${result.rowCount} dong)` +
        ` | da xoa khoi DB: ${result.deletedCount} dong (${result.startStr} -> ${result.endStr})`
    );

    const sns = listSNs();
    if (sns.length === 0) {
      appendLog(
        'cleanup_log.txt',
        `[${vnTimeString()}] ${label} | Chua co may nao duoc ghi nhan (known_devices.json rong), khong gui lenh xoa tren may.`
      );
    }
    for (const sn of sns) {
      const cmdId = queueDeviceDeleteCommand(sn, result.startStr, result.endStr);
      appendLog(
        'cleanup_log.txt',
        `[${vnTimeString()}] ${label} | Da xep lenh xoa tren may SN=${sn} cmd=${cmdId} - xem devicecmd_log.txt sau khi may poll de kiem tra ACK.`
      );
    }

    return { ok: true, ...result, devicesQueued: sns };
  } catch (err) {
    appendLog('cleanup_log.txt', `[${vnTimeString()}] ${label} | LOI: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

function startScheduler() {
  if (!ENABLED) {
    console.log('[cleanup] MONTHLY_CLEANUP_ENABLED=false - tinh nang don dep hang thang dang TAT.');
    return;
  }

  const check = async () => {
    if (FORCE_MONTH && !forcedAlready) {
      forcedAlready = true;
      console.log(
        `[cleanup] MONTHLY_CLEANUP_FORCE_MONTH=${FORCE_MONTH} dang duoc dat - CHAY EP NGAY BAY GIO ` +
          `(bo qua kiem tra ngay ${CLEANUP_DAY} va trang thai da chay). Chi dung de test, nho xoa bien nay khoi .env sau khi xong.`
      );
      await runCleanup(FORCE_MONTH); // khong writeState - khong anh huong lich that
      return;
    }

    const { y, m, d } = vnNowParts();
    if (d < CLEANUP_DAY) return;

    const targetMonth = defaultCleanupMonth({ y, m });
    const state = readState();
    if (state.lastCleanupMonth === targetMonth) return; // da chay cho thang nay roi

    console.log(`[cleanup] Toi ngay ${CLEANUP_DAY}, bat dau don dep du lieu thang ${targetMonth}...`);
    const result = await runCleanup(targetMonth);
    if (result.ok) {
      writeState({ lastCleanupMonth: targetMonth, lastRunAt: vnTimeString() });
    }
  };

  // Kiem tra ngay luc khoi dong (phong truong hop server vua bat lai sau ngay
  // 15 ma chua kip chay), roi kiem tra dinh ky moi gio.
  check();
  setInterval(check, CHECK_INTERVAL_MS);

  console.log(
    `[cleanup] Da bat lich don dep tu dong: ngay ${CLEANUP_DAY} hang thang se xoa du lieu thang truoc (backup vao ${BACKUP_DIR}).`
  );
}

module.exports = {
  startScheduler,
  runCleanup,
  defaultCleanupMonth,
  monthKeyOffset,
  monthRange,
  vnNowParts,
  queueDeviceDeleteCommand,
};
